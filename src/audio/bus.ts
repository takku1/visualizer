import type { FeatureFrame } from '../types';
import { emptyFrame } from '../types';
import { type AudioSource, BINS } from './source';

/**
 * Merges the audio sources into the single frame the renderer reads.
 *
 * Order matters: loopback writes the spectrum first, then analysis overwrites
 * the structure fields if it has them. When analysis has nothing, the fallback
 * clock below synthesizes a beat grid from onsets so the visuals still have a
 * pulse to lock to.
 */
export class FeatureBus {
  #frame: FeatureFrame = emptyFrame(BINS);
  #sources: AudioSource[] = [];
  #lastT = 0;
  #clock = new FallbackBeatClock();
  #lastSectionAt = 0;
  #trackLevel = new RunningStats();

  add(source: AudioSource): this {
    this.#sources.push(source);
    return this;
  }

  /**
   * Start measuring "relative to the track" fresh. Call this on a track
   * change; without it, `levelRelative` is relative to the whole listening
   * session instead of the current track, which degrades gracefully rather
   * than breaking - a Spicetify build calls this from `songchange`, and a
   * plain browser tab with no track signal just never calls it at all.
   */
  resetTrackStats(): void {
    this.#trackLevel.reset();
  }

  get frame(): FeatureFrame {
    return this.#frame;
  }

  get sources(): readonly AudioSource[] {
    return this.#sources;
  }

  /** Advance one frame. `now` is `performance.now()` in milliseconds. */
  update(now: number): FeatureFrame {
    const f = this.#frame;
    const t = now / 1000;

    f.dt = this.#lastT === 0 ? 1 / 60 : Math.min(t - this.#lastT, 0.1);
    f.t = t;
    this.#lastT = t;

    // Edge flags last exactly one frame.
    f.onBeat = false;
    f.onSection = false;
    f.hasStructure = false;

    for (const s of this.#sources) {
      if (s.ready) s.sample(f, now);
    }

    if (!f.hasStructure) this.#synthesize(f);

    this.#trackLevel.push(f.level);
    f.levelRelative = this.#trackLevel.zScore(f.level);

    return f;
  }

  /**
   * No analysis: build a beat grid from onsets, and call a "section" every 24
   * seconds so the director still gets asked to reconsider periodically.
   */
  #synthesize(f: FeatureFrame): void {
    this.#clock.update(f);
    f.tempo = this.#clock.tempo;
    f.beatPhase = this.#clock.beatPhase;
    f.barPhase = this.#clock.barPhase;
    f.beatIndex = this.#clock.beatIndex;
    f.onBeat = this.#clock.onBeat;
    f.confidence = this.#clock.confidence;

    if (f.t - this.#lastSectionAt > 24) {
      this.#lastSectionAt = f.t;
      f.onSection = true;
      f.sectionIndex++;
    }
  }
}

/**
 * Estimates tempo from the spacing between onsets, then free-runs a phase
 * clock at that rate.
 *
 * A median over recent inter-onset intervals, restricted to 60-200 BPM. Crude
 * next to a real beat tracker, and good enough to drive a pulse: being a few
 * milliseconds off is invisible, and locking to roughly the right rate is what
 * makes the image feel connected to the music.
 */
class FallbackBeatClock {
  #intervals: number[] = [];
  #lastOnsetAt = 0;
  #phase = 0;
  #bar = 0;

  tempo = 120;
  beatPhase = 0;
  barPhase = 0;
  beatIndex = 0;
  onBeat = false;
  confidence = 0;

  update(f: FeatureFrame): void {
    this.onBeat = false;

    // A rising edge through a fixed threshold, rate-limited so one drum hit
    // does not register as several.
    if (f.flux > 0.55 && f.t - this.#lastOnsetAt > 0.22) {
      if (this.#lastOnsetAt > 0) {
        const gap = f.t - this.#lastOnsetAt;
        if (gap > 0.3 && gap < 1.0) {
          this.#intervals.push(gap);
          if (this.#intervals.length > 24) this.#intervals.shift();
        }
      }
      this.#lastOnsetAt = f.t;
    }

    if (this.#intervals.length >= 6) {
      const sorted = [...this.#intervals].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      if (median && median > 0) {
        this.tempo = clamp(60 / median, 60, 200);
        this.confidence = Math.min(this.#intervals.length / 24, 1) * 0.6;
      }
    }

    const beatsPerSec = this.tempo / 60;
    this.#phase += f.dt * beatsPerSec;
    while (this.#phase >= 1) {
      this.#phase -= 1;
      this.beatIndex++;
      this.#bar = (this.#bar + 1) % 4;
      this.onBeat = true;
    }

    this.beatPhase = this.#phase;
    this.barPhase = (this.#bar + this.#phase) / 4;
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Welford's online mean/variance, so "loud for this track" and "loud in
 * general" stop meaning the same thing. A fixed threshold cannot tell a
 * quiet passage in a loud track from a quiet passage in a quiet track;
 * this can, once it has seen enough of the track to have an average.
 */
class RunningStats {
  #n = 0;
  #mean = 0;
  #m2 = 0;

  reset(): void {
    this.#n = 0;
    this.#mean = 0;
    this.#m2 = 0;
  }

  push(x: number): void {
    this.#n++;
    const delta = x - this.#mean;
    this.#mean += delta / this.#n;
    this.#m2 += delta * (x - this.#mean);
  }

  /** Roughly -2..2 in typical use. 0 until enough samples exist to trust it. */
  zScore(x: number): number {
    if (this.#n < 30) return 0;
    const variance = this.#m2 / this.#n;
    const std = Math.sqrt(Math.max(variance, 1e-6));
    return clamp((x - this.#mean) / std, -4, 4);
  }
}
