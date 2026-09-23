import type { VisualPlan, Weighted } from '../types';
import type { TrackContext, WindowedFeatures } from '../director/director';
import { buildPerceptualState, type PerceptualState } from '../perception/state';
import type { WorldProjection, WorldState } from '../world/model';
import { motionFromWorld, type WorldMotion } from '../world/motion';
import type { WorldIdentity } from '../world/identity';
import { identityFromContext } from '../world/identity';
import type { WorldDelta } from '../world/delta';
import { deltaFromDecision } from '../world/delta';

/**
 * One decision, fully instrumented for the real-music validation pass.
 *
 * Deliberately flat and exhaustive rather than nested/compact: this is
 * written once per decision (every several seconds) and read by a human or a
 * notebook later, not hot-path code, so JSONL-friendliness beats brevity.
 */
export interface DecisionRecord {
  t: number;
  track: {
    title: string | null;
    artist: string | null;
    artwork: { colorRgb: [number, number, number]; luminance: number; saturation: number; contrast: number } | null;
  };

  /** The windowed audio System1 and the baseline both saw - identical input. */
  features: {
    level: number;
    levelRelative: number;
    bass: number;
    lowMid: number;
    mid: number;
    highMid: number;
    treble: number;
    flux: number;
    bassFlux: number;
    trebleFlux: number;
    stereoWidth: number;
    tempo: number;
    spectralCentroid: number;
    dynamicRange: number;
    estimatedKey: number;
    estimatedMode: 'major' | 'minor';
    keyConfidence: number;
    rhythmConfidence: number;
    swing: number;
    syncopation: number;
    microtiming: number;
    subdivision: number;
    polyrhythm: number;
    keySource: 'spotify' | 'local_estimate';
  };

  /**
   * Which sources actually supplied this decision. False here means the
   * corresponding numbers above are synthesized (fallback beat clock,
   * zeroed spectrum) rather than measured - the brief's "do not silently
   * substitute synthetic data" made explicit and machine-readable.
   */
  source: { capturing: boolean; hasStructure: boolean };

  /** Versioned Phase 1 perception input; learned is null until an adapter is installed. */
  perception: PerceptualState;

  /** World projection at the moment this semantic decision committed. */
  world: WorldProjection;
  worldState: WorldState;
  worldMotion: WorldMotion;
  identity: WorldIdentity;
  delta: WorldDelta;

  /** Full calibrated distributions, not just the argmax. */
  system1: {
    engine: string;
    latencyMs: number;
    motion: DistOut;
    palette: DistOut;
    texture: DistOut;
    geometry: DistOut;
    symmetry: DistOut;
    feedback: DistOut;
    intensity: number;
    hardCut: number;
  };

  /**
   * Same window, same semantic parameter space, run through the deterministic
   * direct-mapping controller instead. Full distributions on both sides now -
   * a baseline that could only ever report one-hot picks would lose the
   * richness comparison by construction, before either side's actual
   * judgment was even in question.
   */
  baseline: {
    motion: DistOut;
    palette: DistOut;
    texture: DistOut;
    geometry: DistOut;
    symmetry: DistOut;
    feedback: DistOut;
    intensity: number;
    hardCut: number;
  };
}

interface DistOut {
  top: string;
  p: Record<string, number>;
}

const dist = (w: Weighted<string>): DistOut => ({ top: w.top, p: w.p as Record<string, number> });

export function buildRecord(
  system1: VisualPlan,
  baseline: VisualPlan,
  features: WindowedFeatures,
  ctx: TrackContext,
  capturing: boolean,
  world: WorldProjection,
  worldState: WorldState,
  perception?: PerceptualState,
  worldMotion?: WorldMotion,
  identity?: WorldIdentity,
  delta?: WorldDelta,
): DecisionRecord {
  const resolvedMotion = worldMotion ?? motionFromWorld(worldState);
  return {
    t: Math.round(features.t * 100) / 100,
    track: {
      title: ctx.title ?? null,
      artist: ctx.artist ?? null,
      artwork: ctx.artwork
        ? {
            colorRgb: ctx.artwork.color.map((c) => Math.round(c * 255)) as [number, number, number],
            luminance: r2(ctx.artwork.luminance),
            saturation: r2(ctx.artwork.saturation),
            contrast: r2(ctx.artwork.contrast),
          }
        : null,
    },
    features: {
      level: r2(features.level),
      levelRelative: r2(features.levelRelative),
      bass: r2(features.bass),
      lowMid: r2(features.lowMid),
      mid: r2(features.mid),
      highMid: r2(features.highMid),
      treble: r2(features.treble),
      flux: r2(features.flux),
      bassFlux: r2(features.bassFlux),
      trebleFlux: r2(features.trebleFlux),
      stereoWidth: r2(features.stereoWidth),
      tempo: Math.round(features.tempo),
      spectralCentroid: r2(features.spectralCentroid),
      dynamicRange: r2(features.dynamicRange),
      estimatedKey: features.estimatedKey,
      estimatedMode: features.estimatedMode,
      keyConfidence: r2(features.keyConfidence),
      rhythmConfidence: r2(features.rhythmConfidence),
      swing: r2(features.swing),
      syncopation: r2(features.syncopation),
      microtiming: r2(features.microtiming),
      subdivision: r2(features.subdivision),
      polyrhythm: r2(features.polyrhythm),
      keySource: ctx.key != null && ctx.mode != null ? 'spotify' : 'local_estimate',
    },
    source: { capturing, hasStructure: features.hasStructure },
    perception: perception ?? buildPerceptualState(features, ctx),
    world,
    worldState,
    worldMotion: resolvedMotion,
    identity: identity ?? identityFromContext(ctx, worldState),
    delta: delta ?? deltaFromDecision(system1, features, ctx, worldState, resolvedMotion),
    system1: {
      engine: system1.origin,
      latencyMs: Math.round(system1.latencyMs),
      motion: dist(system1.motion),
      palette: dist(system1.palette),
      texture: dist(system1.texture),
      geometry: dist(system1.geometry),
      symmetry: dist(system1.symmetry),
      feedback: dist(system1.feedback),
      intensity: r2(system1.intensity),
      hardCut: r2(system1.hardCut),
    },
    baseline: {
      motion: dist(baseline.motion),
      palette: dist(baseline.palette),
      texture: dist(baseline.texture),
      geometry: dist(baseline.geometry),
      symmetry: dist(baseline.symmetry),
      feedback: dist(baseline.feedback),
      intensity: r2(baseline.intensity),
      hardCut: r2(baseline.hardCut),
    },
  };
}

/** A place to send one JSONL line. Electron wires this to a real file; other hosts can no-op. */
export type LogSink = (line: string) => void;

export function recordLine(
  system1: VisualPlan,
  baseline: VisualPlan,
  features: WindowedFeatures,
  ctx: TrackContext,
  capturing: boolean,
  world: WorldProjection,
  worldState: WorldState,
  perception?: PerceptualState,
  worldMotion?: WorldMotion,
  identity?: WorldIdentity,
  delta?: WorldDelta,
): string {
  return JSON.stringify(buildRecord(system1, baseline, features, ctx, capturing, world, worldState, perception, worldMotion, identity, delta));
}

export function telemetryLine(event: {
  t: number;
  fps?: number;
  frameMs?: number;
  world: WorldProjection;
  motion?: WorldMotion;
  sim?: { meanU: number; meanV: number; hasNaN: boolean } | null;
  renderer?: ReturnType<import('../render/renderer').Renderer['telemetry']>;
  audio?: { onBeat: boolean; onSection: boolean; level: number; flux: number; bassFlux: number };
  beatsSinceLast?: number;
  sectionsSinceLast?: number;
  substrate?: { requests: number; successes: number; failures: number; lastMs: number; lastSource: string; lastContinuity: string };
  perception?: { configured: boolean; requests: number; successes: number; failures: number; lastMs: number; lastModel: string; lastVectorLength: number };
}): string {
  return JSON.stringify({ _telemetry: true, ...event });
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
