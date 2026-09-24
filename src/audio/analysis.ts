import type { FeatureFrame } from '../types';
import type { AudioSource } from './source';
import type { AudioAnalysis, AnalysisSection, TimeInterval } from '../spicetify';

export interface AnalysisTrackInfo {
  tempo?: number;
  key?: number;
  mode?: number;
  loudness?: number;
  sectionLabel?: string;
  sectionIndex?: number;
}

/**
 * Musical structure, read from Spotify's own analysis of the track.
 *
 * This is the half of the signal a spectrum cannot give you: where the bars
 * are, where the sections turn, what key the music is in. It is also the half
 * that may simply not be there - plenty of tracks have no analysis, and the
 * endpoint's long-term availability is not something we control. Every method
 * here is written to degrade to "no structure" rather than throw.
 */
export class AnalysisSource implements AudioSource {
  readonly name = 'analysis';

  #analysis: AudioAnalysis | null = null;
  #uri: string | null = null;
  #loading = false;
  #beatIndex = 0;
  #sectionIndex = -1;
  #lastBeatFired = -1;

  get ready(): boolean {
    return this.#analysis !== null;
  }

  /** True when we asked and Spotify had nothing for this track. */
  get unavailable(): boolean {
    return !this.#loading && this.#uri !== null && this.#analysis === null;
  }

  async start(): Promise<void> {
    await this.load();
  }

  stop(): void {
    this.#analysis = null;
    this.#uri = null;
  }

  /** Call on track change. Safe to call repeatedly; it no-ops on the same URI. */
  async load(): Promise<void> {
    const sp = globalThis.Spicetify;
    const uri = sp?.Player?.data?.item?.uri ?? null;
    if (!sp?.getAudioData || uri === this.#uri) return;

    this.#uri = uri;
    this.#analysis = null;
    this.#beatIndex = 0;
    this.#sectionIndex = -1;
    this.#loading = true;

    try {
      const data = await sp.getAudioData();
      // A response with no beats is as useless to us as no response at all.
      this.#analysis = data?.beats?.length || data?.sections?.length ? data : null;
    } catch {
      this.#analysis = null;
    } finally {
      this.#loading = false;
    }
  }

  /** Track-level facts for the director's state payload. */
  info(positionSec: number): AnalysisTrackInfo {
    const a = this.#analysis;
    if (!a) return {};
    const section = pick(a.sections, positionSec);
    return {
      tempo: section?.tempo ?? a.track?.tempo,
      key: section?.key ?? a.track?.key,
      mode: section?.mode ?? a.track?.mode,
      loudness: section?.loudness ?? a.track?.loudness,
      sectionLabel: this.#sectionIndex >= 0 ? `section_${this.#sectionIndex}` : undefined,
      sectionIndex: this.#sectionIndex >= 0 ? this.#sectionIndex : undefined,
    };
  }

  sample(frame: FeatureFrame, _now: number): void {
    const a = this.#analysis;
    const sp = globalThis.Spicetify;
    if (!a || !sp?.Player) return;

    const pos = sp.Player.getProgress() / 1000;
    if (!Number.isFinite(pos)) return;

    const beats = a.beats ?? [];
    const bars = a.bars ?? [];
    const sections = a.sections ?? [];

    const beat = pickIndexed(beats, pos, this.#beatIndex);
    if (beat.index >= 0) {
      this.#beatIndex = beat.index;
      const b = beats[beat.index];
      if (b) {
        frame.beatPhase = clamp01((pos - b.start) / Math.max(b.duration, 1e-3));
        frame.beatIndex = beat.index;
        frame.confidence = b.confidence;
        if (beat.index !== this.#lastBeatFired) {
          frame.onBeat = true;
          this.#lastBeatFired = beat.index;
        }
      }
    }

    const bar = pick(bars, pos);
    if (bar) frame.barPhase = clamp01((pos - bar.start) / Math.max(bar.duration, 1e-3));

    const sectionIdx = indexAt(sections, pos);
    if (sectionIdx >= 0 && sectionIdx !== this.#sectionIndex) {
      frame.onSection = true;
      this.#sectionIndex = sectionIdx;
    }
    frame.sectionIndex = Math.max(this.#sectionIndex, 0);

    const section = sections[Math.max(this.#sectionIndex, 0)];
    frame.tempo = section?.tempo ?? a.track?.tempo ?? frame.tempo;
    frame.hasStructure = true;
  }
}

/** Binary search for the interval containing `t`. */
function indexAt<T extends TimeInterval>(list: T[] | undefined, t: number): number {
  if (!list?.length) return -1;
  let lo = 0;
  let hi = list.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = list[mid];
    if (!item) break;
    if (item.start <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function pick<T extends TimeInterval>(list: T[] | undefined, t: number): T | undefined {
  const i = indexAt(list, t);
  return i >= 0 ? list?.[i] : undefined;
}

/**
 * Same as `indexAt`, but scans forward from the last hit first.
 *
 * Playback is overwhelmingly sequential, so the answer is almost always the
 * current index or the next one. Falls back to the binary search on a seek.
 */
function pickIndexed<T extends TimeInterval>(list: T[], t: number, hint: number): { index: number } {
  for (let i = hint; i < Math.min(hint + 4, list.length); i++) {
    const item = list[i];
    if (item && item.start <= t && t < item.start + item.duration) return { index: i };
  }
  return { index: indexAt(list, t) };
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export type { AnalysisSection };
