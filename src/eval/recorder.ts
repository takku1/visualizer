import type { VisualPlan, Weighted } from '../types';
import type { TrackContext, WindowedFeatures } from '../director/director';

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
    keySource: 'spotify' | 'local_estimate';
  };

  /**
   * Which sources actually supplied this decision. False here means the
   * corresponding numbers above are synthesized (fallback beat clock,
   * zeroed spectrum) rather than measured - the brief's "do not silently
   * substitute synthetic data" made explicit and machine-readable.
   */
  source: { capturing: boolean; hasStructure: boolean };

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
): DecisionRecord {
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
      keySource: ctx.key != null && ctx.mode != null ? 'spotify' : 'local_estimate',
    },
    source: { capturing, hasStructure: features.hasStructure },
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
): string {
  return JSON.stringify(buildRecord(system1, baseline, features, ctx, capturing));
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
