import type { LiveLyricHypothesis } from './live';

export interface LiveMeaningState {
  trackId: string | null;
  provisional: LiveLyricHypothesis[];
  committed: LiveLyricHypothesis[];
  /** Privacy-preserving stabilization diagnostics; transcript text is excluded. */
  candidateCount?: number;
  maxCandidateObservations?: number;
}

type Candidate = {
  hypothesis: LiveLyricHypothesis;
  observations: number;
  lastRevision: number;
  /** Bounded temporal hysteresis for overlapping ASR windows. */
  missedRevisions: number;
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
      const key = this.matchKey(hypothesis);
      if (!key) continue;
      seen.add(key);
      const prior = this.#candidates.get(key);
      const observations = (prior?.observations ?? 0) + 1;
      const candidate: Candidate = {
        hypothesis: {
          ...hypothesis,
          status: 'provisional',
          stability: Math.max(hypothesis.stability, Math.min(1, observations / 3)),
        },
        observations,
        lastRevision: revision,
        missedRevisions: 0,
      };
      this.#candidates.set(key, candidate);
      if (candidate.observations >= 3 && candidate.hypothesis.confidence >= 0.65 && candidate.hypothesis.stability >= 0.6) {
        this.#committed.set(key, { ...candidate.hypothesis, status: 'committed' });
      }
    }

    for (const [key, candidate] of this.#candidates) {
      if (seen.has(key)) continue;
      candidate.missedRevisions++;
      // A phrase can disappear briefly when a singing voice crosses a window
      // boundary or Whisper revises timestamps. Keep only a short evidence
      // horizon; this is tracking hysteresis, not transcript memory.
      if (candidate.missedRevisions > 2) this.#candidates.delete(key);
    }
    return this.state();
  }

  private matchKey(hypothesis: LiveLyricHypothesis): string {
    const normalized = normalize(hypothesis.text);
    if (!normalized) return '';
    if (this.#candidates.has(normalized)) return normalized;
    let best: { key: string; score: number } | null = null;
    for (const [key, candidate] of this.#candidates) {
      const prior = candidate.hypothesis;
      if (prior.language !== hypothesis.language || !overlaps(prior, hypothesis)) continue;
      const score = textSimilarity(key, normalized);
      if (score >= 0.62 && (!best || score > best.score)) best = { key, score };
    }
    return best?.key ?? normalized;
  }

  state(): LiveMeaningState {
    const candidates = [...this.#candidates.values()];
    return {
      trackId: this.#trackId,
      provisional: candidates.map(({ hypothesis }) => hypothesis),
      committed: [...this.#committed.values()],
      candidateCount: candidates.length,
      maxCandidateObservations: candidates.reduce((max, candidate) => Math.max(max, candidate.observations), 0),
    };
  }
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function overlaps(a: LiveLyricHypothesis, b: LiveLyricHypothesis): boolean {
  return Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec) >= -0.25;
}

/** Conservative character n-gram similarity tolerates ASR revisions without
 * merging unrelated phrases that merely occur in the same six-second window. */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const leftChars = Array.from(a);
  const rightChars = Array.from(b);
  // Japanese lyrics often arrive as short kana/kanji chunks without spaces.
  // UTF-16 length and Latin-oriented n-grams incorrectly reject those chunks
  // before temporal evidence can accumulate.
  if (Math.min(leftChars.length, rightChars.length) < 4) {
    return shortScriptSimilarity(leftChars, rightChars);
  }
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const left = new Set(ngrams(leftChars));
  const right = new Set(ngrams(rightChars));
  const intersection = [...left].filter((gram) => right.has(gram)).length;
  const jaccard = intersection / Math.max(1, new Set([...left, ...right]).size);
  return Math.max(jaccard, 1 - editDistance(leftChars, rightChars) / Math.max(leftChars.length, rightChars.length));
}

function shortScriptSimilarity(a: string[], b: string[]): number {
  const shared = a.filter((char) => b.includes(char)).length;
  const overlap = shared / Math.max(1, Math.max(a.length, b.length));
  const edit = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return Math.max(overlap, edit);
}

function ngrams(value: string[]): string[] {
  return value.map((_, index) => value.slice(index, index + 2).join('')).filter((gram) => Array.from(gram).length === 2);
}

function editDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}
