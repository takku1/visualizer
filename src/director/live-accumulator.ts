import type { LiveLyricHypothesis } from './live';

export interface LiveMeaningState {
  trackId: string | null;
  provisional: LiveLyricHypothesis[];
  committed: LiveLyricHypothesis[];
}

type Candidate = {
  hypothesis: LiveLyricHypothesis;
  observations: number;
  lastRevision: number;
};

/** Turns noisy overlapping ASR windows into reversible semantic evidence. */
export class LiveLyricAccumulator {
  #trackId: string | null = null;
  #revision = -1;
  #candidates = new Map<string, Candidate>();
  #committed = new Map<string, LiveLyricHypothesis>();

  reset(trackId: string | null): void {
    this.#trackId = trackId;
    this.#revision = -1;
    this.#candidates.clear();
    this.#committed.clear();
  }

  update(trackId: string, revision: number, hypotheses: readonly LiveLyricHypothesis[]): LiveMeaningState {
    if (trackId !== this.#trackId) this.reset(trackId);
    if (revision <= this.#revision) return this.state();
    this.#revision = revision;

    const seen = new Set<string>();
    for (const hypothesis of hypotheses) {
      if (hypothesis.source !== 'live-asr' || hypothesis.status === 'expired') continue;
      const key = normalize(hypothesis.text);
      if (!key) continue;
      seen.add(key);
      const prior = this.#candidates.get(key);
      const candidate: Candidate = {
        hypothesis: { ...hypothesis, status: 'provisional' },
        observations: (prior?.observations ?? 0) + 1,
        lastRevision: revision,
      };
      this.#candidates.set(key, candidate);
      if (candidate.observations >= 3 && candidate.hypothesis.confidence >= 0.65 && candidate.hypothesis.stability >= 0.6) {
        this.#committed.set(key, { ...candidate.hypothesis, status: 'committed' });
      }
    }

    for (const [key, candidate] of this.#candidates) {
      if (candidate.lastRevision !== revision && !seen.has(key)) this.#candidates.delete(key);
    }
    return this.state();
  }

  state(): LiveMeaningState {
    return {
      trackId: this.#trackId,
      provisional: [...this.#candidates.values()].map(({ hypothesis }) => hypothesis),
      committed: [...this.#committed.values()],
    };
  }
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
