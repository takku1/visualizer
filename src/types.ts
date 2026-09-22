/** Everything the renderer knows about the music at one instant. */
export interface FeatureFrame {
  /** Audio clock, seconds since the visualizer started. */
  t: number;
  /** Seconds since the previous frame, clamped to something sane. */
  dt: number;

  // ---- spectrum, from the loopback source (zeros if unavailable) ----
  /** Five log-spaced band energies, each smoothed and normalized to 0..1. */
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;
  /** Full normalized magnitude spectrum, uploaded to the GPU as a 1D texture. */
  spectrum: Float32Array;
  /** Positive spectral flux — a cheap, reliable onset signal. 0..1. */
  flux: number;
  /** Broadband level, 0..1. */
  level: number;
  /** Spectral centroid — where the energy sits, 0 (all bass) .. 1 (all treble). */
  spectralCentroid: number;
  /** Positive flux within just the bass range - kick/bass-hit onsets specifically. */
  bassFlux: number;
  /** Positive flux within just the treble range - hi-hat/cymbal onsets specifically. */
  trebleFlux: number;
  /** Stereo width, 0 (mono) .. 1 (wide). 0 when the capture has no stereo signal to read. */
  stereoWidth: number;
  /** 12-bin chromagram (pitch-class energy, C=0), summed and normalized. */
  chroma: Float32Array;
  /** Locally estimated key, 0-11 (C=0), from `chroma`. Not Spotify's — a rough correlation match. */
  estimatedKey: number;
  estimatedMode: 'major' | 'minor';
  /** Confidence in `estimatedKey`/`estimatedMode`, 0..1 - the correlation margin, not a probability. */
  keyConfidence: number;
  /**
   * Current level expressed against this track's own running average, not a
   * fixed threshold: roughly a z-score, typically -2..2. A quiet passage in a
   * loud track and a quiet passage in a quiet track should not look
   * identical to a fixed-threshold read, and this is what tells them apart.
   */
  levelRelative: number;

  // ---- structure, from Spotify's analysis (derived from tempo if absent) ----
  /** Position within the current beat, 0..1. */
  beatPhase: number;
  /** Position within the current bar, 0..1. */
  barPhase: number;
  beatIndex: number;
  sectionIndex: number;
  /** BPM. Falls back to an onset-derived estimate when analysis is missing. */
  tempo: number;
  /** True only on the single frame a beat lands. */
  onBeat: boolean;
  /** True only on the single frame a section boundary lands. */
  onSection: boolean;
  /** How much to trust the structure fields, 0..1. */
  confidence: number;
  /** False when structure is synthesized rather than read from analysis. */
  hasStructure: boolean;
}

export function emptyFrame(bins: number): FeatureFrame {
  return {
    t: 0, dt: 0,
    bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0,
    spectrum: new Float32Array(bins),
    flux: 0, level: 0, spectralCentroid: 0,
    bassFlux: 0, trebleFlux: 0, stereoWidth: 0,
    chroma: new Float32Array(12), estimatedKey: 0, estimatedMode: 'major', keyConfidence: 0,
    levelRelative: 0,
    beatPhase: 0, barPhase: 0, beatIndex: 0, sectionIndex: 0,
    tempo: 120, onBeat: false, onSection: false,
    confidence: 0, hasStructure: false,
  };
}

/**
 * A Jev answer kept whole: the argmax plus the full calibrated distribution.
 *
 * Keeping `p` is the point of this project. jev-playground collapses each
 * Choice to a single pick; we carry the distribution into the renderer and
 * blend parameter vectors by it, so a 60/40 answer renders as a 60/40 mix
 * rather than a coin flip.
 */
export interface Weighted<T extends string> {
  top: T;
  p: Partial<Record<T, number>>;
  confidence: number;
}

export function certain<T extends string>(v: T): Weighted<T> {
  return { top: v, p: { [v]: 1 } as Partial<Record<T, number>>, confidence: 1 };
}

/** What the track currently looks like. Every field is blendable. */
export interface VisualPlan {
  motion: Weighted<MotionId>;
  palette: Weighted<PaletteId>;
  texture: Weighted<TextureId>;
  geometry: Weighted<GeometryId>;
  symmetry: Weighted<SymmetryId>;
  feedback: Weighted<FeedbackId>;
  /** 0..4, from a Score question. Drives overall amplitude. */
  intensity: number;
  /** 0..1 probability that this boundary deserves a hard cut, from a Noul. */
  hardCut: number;
  /** Name of the engine that produced this plan, shown in the HUD. */
  origin: string;
  /** Wall-clock ms the Jev round trip took. */
  latencyMs: number;
}

export type MotionId =
  | 'drift' | 'orbit' | 'pulse' | 'shear'
  | 'turbulent' | 'collapse' | 'bloom' | 'lattice';

export type PaletteId =
  | 'ember' | 'ice' | 'ultraviolet' | 'chlorophyll'
  | 'sodium' | 'oxide' | 'monochrome' | 'spectral';

/** The form the rendered material takes: what the image is *made of*. */
export type TextureId =
  | 'filament' | 'plasma' | 'grain'
  | 'cellular' | 'strata' | 'shards';

/**
 * Which SDF primitive family accents the field. The one always-on-if-chosen
 * hard-edged layer in an otherwise all-soft-noise image - crisp rings
 * arranged in a slow orbit, distinct in kind from texture/motion.
 */
export type GeometryId = 'none' | 'circles' | 'hexagons' | 'stars';

export type SymmetryId = 'none' | 'mirror' | 'kaleido3' | 'kaleido6' | 'kaleido12' | 'polar';

export type FeedbackId = 'none' | 'trail' | 'zoom_in' | 'zoom_out' | 'swirl' | 'smear';
