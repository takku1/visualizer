import type { FeatureFrame } from '../types';
import type { TrackContext, WindowedFeatures } from '../director/director';

/** Versioned, model-agnostic input to semantic perception. */
export interface PerceptualState {
  schema: 1;
  track: {
    title: string | null;
    artist: string | null;
    genres: string[];
    artwork: { luminance: number; saturation: number; contrast: number } | null;
  };
  audio: {
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
    spectralCentroid: number;
    spectralFlatness: number;
    spectralRolloff: number;
    harmonicity: number;
    transientness: number;
    dynamicRange: number;
    tempo: number;
    key: number;
    mode: 'major' | 'minor';
    keyConfidence: number;
    rhythmConfidence: number;
    swing: number;
    syncopation: number;
    microtiming: number;
    subdivision: number;
    polyrhythm: number;
    structureKnown: boolean;
  };
  /** Optional learned representation. Never required by the render loop. */
  learned: {
    kind: 'audio-embedding';
    model: string;
    version: string;
    vector: number[];
  } | null;
}

/** Pure adapter from the existing DSP contract into the Phase 1 model input. */
export function buildPerceptualState(
  f: FeatureFrame | WindowedFeatures,
  ctx: TrackContext,
  learned: PerceptualState['learned'] = null,
): PerceptualState {
  return {
    schema: 1,
    track: {
      title: ctx.title ?? null,
      artist: ctx.artist ?? null,
      genres: ctx.genres?.slice(0, 8) ?? [],
      artwork: ctx.artwork
        ? { luminance: r2(ctx.artwork.luminance), saturation: r2(ctx.artwork.saturation), contrast: r2(ctx.artwork.contrast) }
        : null,
    },
    audio: {
      level: r2(f.level), levelRelative: r2(f.levelRelative), bass: r2(f.bass), lowMid: r2(f.lowMid),
      mid: r2(f.mid), highMid: r2(f.highMid), treble: r2(f.treble), flux: r2(f.flux),
      bassFlux: r2(f.bassFlux), trebleFlux: r2(f.trebleFlux), stereoWidth: r2(f.stereoWidth),
      spectralCentroid: r2(f.spectralCentroid), dynamicRange: r2('dynamicRange' in f ? f.dynamicRange : 0),
      spectralFlatness: r2(f.spectralFlatness), spectralRolloff: r2(f.spectralRolloff),
      harmonicity: r2(f.harmonicity), transientness: r2(f.transientness),
      tempo: Math.round(f.tempo), key: f.estimatedKey, mode: f.estimatedMode,
      keyConfidence: r2(f.keyConfidence), rhythmConfidence: r2(f.rhythmConfidence),
      swing: r2(f.swing), syncopation: r2(f.syncopation), microtiming: r2(f.microtiming),
      subdivision: r2(f.subdivision), polyrhythm: r2(f.polyrhythm), structureKnown: f.hasStructure,
    },
    learned,
  };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
