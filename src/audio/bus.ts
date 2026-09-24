import type { FeatureFrame } from '../types';
import { emptyFrame } from '../types';
import { type AudioSource, BINS } from './source';
import { RhythmAnalyzer } from '../rhythm';
import type { RhythmicStructure } from '../rhythm';
import { StructureMemory } from '../structure/memory';

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
  #rhythm = new RhythmAnalyzer();
  #structure = new StructureMemory();
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
    this.#clock.reset();
    this.#rhythm.reset();
    this.#structure.reset();
    this.#lastSectionAt = this.#frame.t;
    this.#frame.sectionIndex = 0;
    this.#frame.beatIndex = 0;
  }

  get frame(): FeatureFrame {
    return this.#frame;
  }

  get sources(): readonly AudioSource[] {
    return this.#sources;
  }

  /** The provider-independent interpretation of the current rhythmic state. */
  get rhythm(): RhythmicStructure {
    return this.#rhythm.structure;
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
    resetAudio(f);

    for (const s of this.#sources) {
      if (s.ready) s.sample(f, now);
    }

    if (!f.hasStructure) this.#synthesize(f);

    this.#trackLevel.push(f.level);
    f.levelRelative = this.#trackLevel.zScore(f.level);
    const rhythm = this.#rhythm.update(f);
    f.rhythmConfidence = rhythm.confidence;
    f.swing = Math.min(Math.max((rhythm.feel.swingRatio - 1) / 0.66, 0), 1);
    f.syncopation = rhythm.feel.syncopation;
    f.microtiming = rhythm.feel.microtiming;
    f.subdivision = Math.min((rhythm.subdivisions[0]?.pulsesPerBeat ?? 1) / 8, 1);
    f.polyrhythm = rhythm.layers.some((layer) => layer.kind === 'polyrhythm') ? 1 : 0;
    f.structure = this.#structure.observe(f);

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

/** Sources write a complete contribution each frame; absent sources must
 * not leave the previous track's spectrum driving the world indefinitely. */
function resetAudio(f: FeatureFrame): void {
  f.bass = 0; f.lowMid = 0; f.mid = 0; f.highMid = 0; f.treble = 0;
  f.flux = 0; f.level = 0; f.spectralCentroid = 0; f.spectralFlatness = 0;
  f.spectralRolloff = 0; f.harmonicity = 0; f.transientness = 0;
  f.bassFlux = 0; f.trebleFlux = 0; f.stereoWidth = 0;
  f.chroma.fill(0); f.spectrum.fill(0);
  f.estimatedKey = 0; f.estimatedMode = 'major'; f.keyConfidence = 0;
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

  reset(): void {
    this.#intervals = [];
    this.#lastOnsetAt = 0;
    this.#phase = 0;
    this.#bar = 0;
    this.tempo = 120;
    this.beatPhase = 0;
    this.barPhase = 0;
    this.beatIndex = 0;
    this.onBeat = false;
    this.confidence = 0;
  }

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
      const estimate = estimateTempoFromOnsetGaps(this.#intervals);
      if (estimate) {
        // Avoid tempo flicker from one onset while allowing a genuine change
        // to settle over a few windows.
        this.tempo += (estimate.tempo - this.tempo) * 0.2;
        this.confidence = estimate.confidence * Math.min(this.#intervals.length / 24, 1);
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

/**
 * Estimate a pulse from onset gaps while folding subdivisions and double-time
 * interpretations into the same 60..180 BPM range. A small histogram is more
 * robust than taking the median gap when a track contains both kick and hat
 * onsets.
 */
export function estimateTempoFromOnsetGaps(gaps: readonly number[]): { tempo: number; confidence: number } | null {
  const valid = gaps.filter((gap) => Number.isFinite(gap) && gap > 0.3 && gap < 1.0);
  if (valid.length < 3) return null;
  const bins = new Map<number, number>();
  for (const gap of valid) {
    let bpm = 60 / gap;
    while (bpm < 60) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    const centre = Math.round(bpm * 2) / 2;
    for (let offset = -2; offset <= 2; offset++) {
      const bin = centre + offset * 0.5;
      const distance = Math.abs(bin - bpm);
      bins.set(bin, (bins.get(bin) ?? 0) + Math.exp(-(distance * distance) / 2));
    }
  }
  const ranked = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return null;
  const total = [...bins.values()].reduce((sum, value) => sum + value, 0);
  return { tempo: clamp(top[0], 60, 180), confidence: clamp(top[1] / Math.max(total, 1e-6) * 8, 0, 1) };
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
