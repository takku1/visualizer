import type { FeatureFrame, VisualPlan, Weighted, MotionId, PaletteId, TextureId, GeometryId, SymmetryId, FeedbackId } from '../types';
import { certain } from '../types';
import { MOTION, PALETTE, TEXTURE, GEOMETRY, SYMMETRY, FEEDBACK, criteriaOf } from './vocab';
import { type Answer, type SystemOneRequest } from './jev';
import type { DecisionEngine } from './engine';
import { LocalSystemOne } from './local';

/** Musical context the director reports to Jev alongside the live features. */
export interface TrackContext {
  title?: string;
  artist?: string;
  /** Spotify genre tags, when the client exposes them. */
  genres?: string[];
  tempo?: number;
  /** Spotify analysis key (0-11) and mode (0 minor, 1 major). */
  key?: number;
  mode?: number;
  /** Loudness in dB for the current section, when analysis is available. */
  loudness?: number;
  /** 'intro' | 'verse' | ... when we can infer it; otherwise the index. */
  sectionLabel?: string;
  /** Album-art visual DNA (see src/audio/artwork.ts). Spicetify build only. */
  artwork?: { color: [number, number, number]; luminance: number; saturation: number; contrast: number };
}

export interface DirectorOptions {
  /** Primary decision engine. Jev when a key exists, the local one otherwise. */
  engine: DecisionEngine;
  /**
   * Used when the primary is unconfigured or fails.
   *
   * Defaults to a local System One, so a dead key or a flaky network costs
   * fidelity rather than stopping the visuals.
   */
  fallback?: DecisionEngine;
  /** Never ask more often than this, whatever the music does. */
  minIntervalMs?: number;
  /** Ask at least this often even if no section boundary arrives. */
  maxIntervalMs?: number;
  /**
   * `baseline` is `offlinePlan` run on the exact same windowed features the
   * primary engine just saw - a direct audio-to-parameter mapping with no
   * semantic classification. It exists so callers can log the two side by
   * side and ask whether the engine is doing anything a pile of thresholds
   * would not, rather than assuming it from `plan` alone.
   */
  onPlan?: (plan: VisualPlan, features: WindowedFeatures, ctx: TrackContext, baseline: VisualPlan) => void;
  onError?: (err: Error) => void;
}

/** What a decision was actually made from: the window plus its dynamic range. */
export type WindowedFeatures = FeatureFrame & { dynamicRange: number };

const SCORE_LEVELS = [
  'Dormant. Barely moving. Near silence or a long held pause.',
  'Restrained. Present but understated. Verse-level, leaving room.',
  'Driving. Full-bodied and committed. The main body of the track.',
  'Peaking. Dense and loud. A chorus or a drop.',
  'Overwhelming. Saturated, maximal, the loudest the track ever gets.',
];

/**
 * Decides what the visuals should be doing, and when to reconsider.
 *
 * Asking is asynchronous and always optional: the renderer runs off the last
 * good plan, so a slow or failed decision costs nothing but staleness.
 */
export class Director {
  #engine: DecisionEngine;
  #fallback: DecisionEngine;
  #minInterval: number;
  #maxInterval: number;
  #onPlan?: (plan: VisualPlan, features: WindowedFeatures, ctx: TrackContext, baseline: VisualPlan) => void;
  #onError?: (err: Error) => void;

  #lastAskAt = 0;
  #inFlight = false;
  #consecutiveFailures = 0;
  #plan: VisualPlan;
  #history: string[] = [];
  #window = new FeatureWindow();

  constructor(opts: DirectorOptions) {
    this.#engine = opts.engine;
    this.#fallback = opts.fallback ?? new LocalSystemOne();
    this.#minInterval = opts.minIntervalMs ?? 6000;
    this.#maxInterval = opts.maxIntervalMs ?? 30000;
    this.#onPlan = opts.onPlan;
    this.#onError = opts.onError;
    this.#plan = initialPlan();
  }

  get plan(): VisualPlan {
    return this.#plan;
  }

  /**
   * Call every frame. Cheap unless it decides a decision is due.
   *
   * A section boundary is the natural place to change the visuals, but we also
   * force a refresh on `maxInterval` so tracks without structure data still
   * evolve.
   */
  tick(f: FeatureFrame, ctx: TrackContext): void {
    this.#window.push(f);

    const now = performance.now();
    const since = now - this.#lastAskAt;
    if (this.#inFlight || since < this.#minInterval) return;

    const due = f.onSection || since >= this.#maxInterval;
    if (!due) return;

    // Back off hard after repeated failures rather than hammering a dead key.
    if (this.#consecutiveFailures > 0) {
      const penalty = Math.min(2 ** this.#consecutiveFailures, 32) * 1000;
      if (since < this.#minInterval + penalty) return;
    }

    this.#lastAskAt = now;
    void this.#decide(f, ctx);
  }

  /** Force a decision now, ignoring the interval guards. */
  async refresh(f: FeatureFrame, ctx: TrackContext): Promise<void> {
    this.#lastAskAt = performance.now();
    await this.#decide(f, ctx);
  }

  async #decide(f: FeatureFrame, ctx: TrackContext): Promise<void> {
    // Decide from the averaged window, not this one frame. A single frame is
    // a coin toss on whether it caught a transient: the same passage looks
    // 0.9 percussive on a snare hit and 0.1 fifty milliseconds later.
    const windowed = this.#window.mean(f);
    this.#window.reset();

    // The direct-mapping baseline, computed on the identical window the
    // primary engine is about to see. Always computed, cheap, and the only
    // way to know later whether the engine's answer was doing semantic work
    // or reproducing what a threshold rule already would have.
    const baseline = offlinePlan(windowed, this.#plan);

    const req = buildRequest(windowed, ctx, this.#plan, this.#history);
    const primary = this.#engine.configured ? this.#engine : this.#fallback;

    this.#inFlight = true;
    const started = performance.now();
    try {
      const res = await primary.ask(req);
      this.#consecutiveFailures = 0;
      this.#record(planFromAnswers(res.answers, performance.now() - started, primary.name), windowed, ctx, baseline);
    } catch (err) {
      this.#consecutiveFailures++;
      this.#onError?.(err as Error);
      // Degrade, never stall. The fallback is in-process and cannot fail the
      // same way, but if it somehow does we keep the plan we already had.
      try {
        const res = await this.#fallback.ask(req);
        this.#record(planFromAnswers(res.answers, 0, this.#fallback.name), windowed, ctx, baseline);
      } catch {
        this.#commit(offlinePlan(windowed, this.#plan), windowed, ctx, baseline);
      }
    } finally {
      this.#inFlight = false;
    }
  }

  #record(plan: VisualPlan, features: WindowedFeatures, ctx: TrackContext, baseline: VisualPlan): void {
    this.#history.push(`${plan.motion.top}/${plan.palette.top}`);
    if (this.#history.length > 8) this.#history.shift();
    this.#commit(plan, features, ctx, baseline);
  }

  #commit(plan: VisualPlan, features: WindowedFeatures, ctx: TrackContext, baseline: VisualPlan): void {
    this.#plan = plan;
    this.#onPlan?.(plan, features, ctx, baseline);
  }
}

/**
 * Running mean of the spectral features since the last decision.
 *
 * Only the fields the director actually reports are averaged; structure and
 * timing come from the live frame, where being current matters more than
 * being stable.
 */
class FeatureWindow {
  #n = 0;
  #sum = { level: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, flux: 0, centroid: 0 };
  #levelMin = Infinity;
  #levelMax = -Infinity;

  push(f: FeatureFrame): void {
    this.#n++;
    this.#sum.level += f.level;
    this.#sum.bass += f.bass;
    this.#sum.lowMid += f.lowMid;
    this.#sum.mid += f.mid;
    this.#sum.highMid += f.highMid;
    this.#sum.treble += f.treble;
    this.#sum.flux += f.flux;
    this.#sum.centroid += f.spectralCentroid;
    this.#levelMin = Math.min(this.#levelMin, f.level);
    this.#levelMax = Math.max(this.#levelMax, f.level);
  }

  reset(): void {
    this.#n = 0;
    this.#sum = { level: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, flux: 0, centroid: 0 };
    this.#levelMin = Infinity;
    this.#levelMax = -Infinity;
  }

  /**
   * `live` with its spectral fields replaced by the window average, plus
   * `dynamicRange`: how much the level swung within the window rather than
   * just where it sat on average. A track that is loud-and-flat and one that
   * is loud-with-hard-drops can share the same mean level and nothing else.
   */
  mean(live: FeatureFrame): FeatureFrame & { dynamicRange: number } {
    if (this.#n === 0) return { ...live, dynamicRange: 0 };
    const n = this.#n;
    return {
      ...live,
      level: this.#sum.level / n,
      bass: this.#sum.bass / n,
      lowMid: this.#sum.lowMid / n,
      mid: this.#sum.mid / n,
      highMid: this.#sum.highMid / n,
      treble: this.#sum.treble / n,
      flux: this.#sum.flux / n,
      spectralCentroid: this.#sum.centroid / n,
      dynamicRange: Math.max(0, this.#levelMax - this.#levelMin),
    };
  }
}

function buildRequest(
  f: WindowedFeatures,
  ctx: TrackContext,
  prev: VisualPlan,
  history: string[],
): SystemOneRequest {
  /**
   * State is a structured snapshot rather than prose. System One takes objects
   * directly, and numbers are rounded because the extra precision is noise the
   * model would have to pay tokens to read.
   */
  // Prefer Spotify's own analysis when it exists; fall back to the local
  // chroma-correlation estimate otherwise. Either way the local estimate and
  // its confidence are reported separately below, so which one won is never
  // silently lost - see the recorder's `keySource` field.
  const keyFromCtx = ctx.key != null && ctx.mode != null;
  const state = {
    track: {
      title: ctx.title ?? null,
      artist: ctx.artist ?? null,
      genres: ctx.genres?.slice(0, 5) ?? [],
      tempo: Math.round(ctx.tempo ?? f.tempo),
      key: keyFromCtx ? ctx.key : f.estimatedKey,
      mode: keyFromCtx ? (ctx.mode === 1 ? 'major' : 'minor') : f.estimatedMode,
      key_source: keyFromCtx ? 'spotify' : 'local_estimate',
      artwork: ctx.artwork
        ? {
            color_rgb: ctx.artwork.color.map((c) => Math.round(c * 255)),
            luminance: r2(ctx.artwork.luminance),
            saturation: r2(ctx.artwork.saturation),
            contrast: r2(ctx.artwork.contrast),
          }
        : null,
    },
    section: {
      index: f.sectionIndex,
      label: ctx.sectionLabel ?? null,
      loudness_db: ctx.loudness != null ? Math.round(ctx.loudness) : null,
    },
    /** Live spectrum, 0..1. What the music sounds like right now. */
    audio: {
      level: r2(f.level),
      level_relative: r2(f.levelRelative),
      bass: r2(f.bass),
      low_mid: r2(f.lowMid),
      mid: r2(f.mid),
      high_mid: r2(f.highMid),
      treble: r2(f.treble),
      onset_density: r2(f.flux),
      bass_onset: r2(f.bassFlux),
      treble_onset: r2(f.trebleFlux),
      stereo_width: r2(f.stereoWidth),
      spectral_centroid: r2(f.spectralCentroid),
      dynamic_range: r2(f.dynamicRange),
      key_confidence: r2(f.keyConfidence),
      structure_known: f.hasStructure,
    },
    /** What is on screen now, so the model can choose to continue or break. */
    current_visuals: {
      motion: prev.motion.top,
      palette: prev.palette.top,
      texture: prev.texture.top,
      symmetry: prev.symmetry.top,
      feedback: prev.feedback.top,
      intensity: r2(prev.intensity),
    },
    recent_visuals: history,
  };

  return {
    state,
    questions: {
      motion: {
        type: 'choice',
        instructions:
          'Choose how the image should move during this section. Match the motion to the energy and density of the audio. Prefer continuing the current motion when the music has not meaningfully changed.',
        criteria: criteriaOf(MOTION),
      },
      palette: {
        type: 'choice',
        instructions:
          'Choose the color palette for this section. Match the emotional character of the music. Changing palette every section is exhausting to watch, so hold the current palette unless the music has genuinely turned.',
        criteria: criteriaOf(PALETTE),
      },
      texture: {
        type: 'choice',
        instructions:
          'Choose what the image should be made of. Match the grain of the sound itself: distorted and noisy material wants a rough texture, clean sustained material wants a smooth one, sharp transients want hard edges.',
        criteria: criteriaOf(TEXTURE),
      },
      geometry: {
        type: 'choice',
        instructions:
          'Choose whether crisp geometric accents (circles, hexagons, or stars) orbit over the field, or none at all. This is a distinct, hard-edged layer, not the overall texture - use it for tracks that want a structured, ornamental accent on top of the organic base.',
        criteria: criteriaOf(GEOMETRY),
      },
      symmetry: {
        type: 'choice',
        instructions:
          'Choose the symmetry structure. Higher fold counts read as more ornate and formal; none reads as organic and loose. Dense, busy audio usually wants less symmetry, not more.',
        criteria: criteriaOf(SYMMETRY),
      },
      feedback: {
        type: 'choice',
        instructions:
          'Choose how strongly the previous frame bleeds into this one. Long trails suit sustained, reverberant music; none suits sharp percussive music.',
        criteria: criteriaOf(FEEDBACK),
      },
      intensity: {
        type: 'score',
        instructions: 'How intense should the visuals be right now, judged against this track as a whole rather than against all music?',
        criteria: SCORE_LEVELS,
      },
      hard_cut: {
        type: 'noul',
        instructions:
          'Should the visuals cut instantly to the new look rather than crossfading into it over several seconds?',
        criteria: {
          true: 'The music just changed abruptly - a drop, a key change, a sudden entrance. A hard cut is earned.',
          false: 'The music is evolving continuously. A smooth transition is correct.',
        },
      },
    },
  };
}

function planFromAnswers(answers: Record<string, Answer>, latencyMs: number, engine: string): VisualPlan {
  return {
    motion: weighted<MotionId>(answers['motion'], MOTION, 'drift'),
    palette: weighted<PaletteId>(answers['palette'], PALETTE, 'ember'),
    texture: weighted<TextureId>(answers['texture'], TEXTURE, 'filament'),
    geometry: weighted<GeometryId>(answers['geometry'], GEOMETRY, 'none'),
    symmetry: weighted<SymmetryId>(answers['symmetry'], SYMMETRY, 'none'),
    feedback: weighted<FeedbackId>(answers['feedback'], FEEDBACK, 'trail'),
    intensity: clamp(answers['intensity']?.score ?? 2, 0, SCORE_LEVELS.length - 1),
    hardCut: clamp(answers['hard_cut']?.noul ?? 0, 0, 1),
    origin: engine,
    latencyMs,
  };
}

/**
 * Turn one Answer into a Weighted, dropping labels we do not know about.
 *
 * The API can only return keys we sent as criteria, so an unknown label means
 * our table and the request drifted apart - worth ignoring rather than
 * crashing the render loop over.
 */
function weighted<T extends string>(
  answer: Answer | undefined,
  table: Record<string, unknown>,
  fallback: T,
): Weighted<T> {
  const top = (answer?.choice ?? fallback) as T;
  if (!answer?.probabilities) return certain(top in table ? top : fallback);

  const p: Partial<Record<T, number>> = {};
  for (const [label, prob] of Object.entries(answer.probabilities)) {
    if (label in table && prob > 0.02) p[label as T] = prob;
  }
  if (Object.keys(p).length === 0) return certain(top in table ? top : fallback);

  return {
    top: top in table ? top : fallback,
    p,
    confidence: answer.confidence ?? Math.max(...Object.values(p as Record<string, number>)),
  };
}

/**
 * A deterministic planner: one scalar feature per dimension, mapped through
 * ordered-neighbor interpolation - not profile matching, not multi-feature
 * distance scoring, just a direct feature-to-position lookup. That is the
 * actual distinction from `LocalSystemOne`, and it has to hold now that this
 * also produces distributions: if the mechanism were the same (distance to a
 * profile vector, softmaxed) the "baseline" would just be a second copy of
 * the classifier under review, and the comparison would mean nothing.
 *
 * Two roles, unchanged: it is what runs when every decision engine is
 * unreachable, so the visualizer stays usable with no account at all, and it
 * is the explicit baseline `Director` computes on every decision (see
 * `onPlan`) so a System One answer can be compared against "what would a
 * direct, mechanical audio-to-parameter mapping have done with the identical
 * window." It uses every feature currently on `FeatureFrame` somewhere below
 * - not because each one needs its own dimension, but because a "strong"
 * baseline should not be leaving measured signal unused while claiming to
 * compete fairly.
 */
export function offlinePlan(f: WindowedFeatures, _prev: VisualPlan): VisualPlan {
  const energy = clamp(f.level * 0.6 + f.flux * 0.4 + f.levelRelative * 0.08, 0, 1);
  const brightness = f.spectralCentroid;
  const percussive = clamp(f.bassFlux * 0.5 + f.trebleFlux * 0.5, 0, 1);
  // The same warm/cool nudge System1's local engine gets from mode (see
  // local.ts) - both sides read the same signal, or the comparison is unfair
  // in the other direction.
  const modeBias = f.estimatedMode === 'major' ? 1 : -1;

  const MOTION_ORDER: MotionId[] = ['drift', 'orbit', 'collapse', 'pulse', 'bloom', 'shear', 'lattice', 'turbulent'];
  const PALETTE_ORDER: PaletteId[] = ['ember', 'sodium', 'oxide', 'chlorophyll', 'ice', 'ultraviolet', 'spectral'];
  const TEXTURE_ORDER: TextureId[] = ['plasma', 'filament', 'cellular', 'strata', 'grain', 'shards'];
  const GEOMETRY_ORDER: GeometryId[] = ['none', 'circles', 'hexagons', 'stars'];
  const SYMMETRY_ORDER: SymmetryId[] = ['kaleido12', 'kaleido6', 'kaleido3', 'mirror', 'polar', 'none'];
  const FEEDBACK_ORDER: FeedbackId[] = ['smear', 'trail', 'swirl', 'zoom_out', 'zoom_in', 'none'];

  // Stereo width nudges toward the more open/asymmetric end - wide, decorrelated
  // material reads as less "one thing repeated," narrow/mono as more so.
  const symmetryAxis = clamp(energy * 0.8 + f.stereoWidth * 0.3, 0, 1);
  // Palette position gets a small push from mode, same idea as local.ts's modeBias.
  const paletteAxis = clamp(brightness + modeBias * 0.05, 0, 1);
  const dynamicAxis = clamp(f.dynamicRange * 0.85 + (f.onSection ? 0.15 : 0), 0, 1);

  const motion = weightedFrom(triangularWeights(energy, MOTION_ORDER));
  const palette = weightedFrom(triangularWeights(paletteAxis, PALETTE_ORDER));
  const texture = weightedFrom(triangularWeights(percussive, TEXTURE_ORDER));
  const geometry = weightedFrom(triangularWeights(dynamicAxis, GEOMETRY_ORDER));
  const symmetry = weightedFrom(triangularWeights(symmetryAxis, SYMMETRY_ORDER));
  const feedback = weightedFrom(triangularWeights(f.flux, FEEDBACK_ORDER));

  return {
    motion,
    palette,
    texture,
    geometry,
    symmetry,
    feedback,
    intensity: clamp(energy * 4 + f.levelRelative * 0.3, 0, 4),
    hardCut: f.onSection ? clamp(smoothstep(0.55, 0.9, f.flux), 0, 1) : 0,
    origin: 'offline',
    latencyMs: 0,
  };
}

/**
 * Maps `x` (0..1) onto the two nearest neighbors of an ordered label list by
 * linear interpolation - at most two active labels, weighted by proximity.
 * Deliberately the simplest possible distribution shape: this is the
 * baseline's whole mechanism, direct position-to-weight, with nothing
 * resembling System1's multi-feature profile distance underneath it.
 */
function triangularWeights<T extends string>(x: number, ordered: readonly T[]): Partial<Record<T, number>> {
  const n = ordered.length;
  if (n === 0) return {};
  const first = ordered[0] as T;
  if (n === 1) return { [first]: 1 } as Partial<Record<T, number>>;

  const pos = clamp(x, 0, 1) * (n - 1);
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(pos)));
  const i1 = Math.min(i0 + 1, n - 1);
  const frac = pos - i0;
  const a = ordered[i0] as T;
  const b = ordered[i1] as T;

  if (a === b) return { [a]: 1 } as Partial<Record<T, number>>;
  const out: Partial<Record<T, number>> = {};
  out[a] = r2(1 - frac);
  out[b] = r2(frac);
  return out;
}

function weightedFrom<T extends string>(p: Partial<Record<T, number>>): Weighted<T> {
  let top: T | undefined;
  let best = -Infinity;
  for (const [k, v] of Object.entries(p) as [T, number][]) {
    if ((v ?? 0) > best) {
      best = v ?? 0;
      top = k;
    }
  }
  return { top: top as T, p, confidence: best === -Infinity ? 0 : best };
}

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / Math.max(hi - lo, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

export function initialPlan(): VisualPlan {
  return {
    motion: certain<MotionId>('drift'),
    palette: certain<PaletteId>('ice'),
    texture: certain<TextureId>('filament'),
    geometry: certain<GeometryId>('none'),
    symmetry: certain<SymmetryId>('kaleido6'),
    feedback: certain<FeedbackId>('trail'),
    intensity: 1.5,
    hardCut: 0,
    origin: 'initial',
    latencyMs: 0,
  };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
