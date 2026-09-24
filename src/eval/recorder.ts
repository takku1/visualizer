import type { VisualPlan, Weighted } from '../types';
import type { TrackContext, WindowedFeatures } from '../director/director';
import type { Scene } from '../stream/scenes';
import type { CheckpointRequest } from '../stream/checkpoint';

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
    id: string | null;
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

  /** The realization scene this decision compiled to (what the checkpoint renders). */
  scene: Scene;

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
  scene: Scene,
): DecisionRecord {
  return {
    t: Math.round(features.t * 100) / 100,
    track: {
      id: ctx.trackId ?? null,
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
    scene,
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

/**
 * Envelope version stamped on every JSONL event this module emits.
 * Readers must accept older versions and rows without an envelope: match
 * `kind` first, fall back to the legacy key sniffing (`_checkpoint`,
 * `_telemetry`, `_state`, `scene && system1`) when `kind` is absent.
 */
export const LOG_ENVELOPE_VERSION = 1;

/** Discriminator for the four event shapes below. */
export type LogEventKind = 'decision' | 'checkpoint' | 'telemetry' | 'state';

export function recordLine(
  system1: VisualPlan,
  baseline: VisualPlan,
  features: WindowedFeatures,
  ctx: TrackContext,
  capturing: boolean,
  scene: Scene,
): string {
  return JSON.stringify({ ...buildRecord(system1, baseline, features, ctx, capturing, scene), kind: 'decision', v: LOG_ENVELOPE_VERSION });
}

/** One checkpoint realization request, with why it fired. */
export function checkpointLine(t: number, request: CheckpointRequest): string {
  return JSON.stringify({ _checkpoint: true, t: r2(t), ...request, kind: 'checkpoint', v: LOG_ENVELOPE_VERSION });
}

/** Periodic health: display fps, stream fps/latency, splice activity, audio. */
export function telemetryLine(event: { t: number } & Record<string, unknown>): string {
  return JSON.stringify({ _telemetry: true, ...event, kind: 'telemetry', v: LOG_ENVELOPE_VERSION });
}

/** Compact one-hertz state sample for phrase-scale analysis. */
export function stateLine(t: number, state: Record<string, unknown>): string {
  return JSON.stringify({ _state: true, t: r2(t), ...state, kind: 'state', v: LOG_ENVELOPE_VERSION });
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
