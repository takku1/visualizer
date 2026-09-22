import type { MotionId, PaletteId, TextureId, GeometryId, SymmetryId, FeedbackId, Weighted } from '../types';

/**
 * The visual vocabulary.
 *
 * Each enum value carries two things: a human description that Jev reads as
 * `criteria` when it decides, and a numeric parameter vector the renderer
 * consumes. Because every vector in a family lives in the same space, a
 * probability distribution over labels blends into a single valid vector.
 * Add a value here and both the model and the renderer pick it up.
 */

export interface MotionParams {
  /** Curl-noise advection strength. */
  curlAmp: number;
  /** Spatial frequency of the noise field. */
  curlFreq: number;
  /** Rigid rotation about the center, radians/sec. */
  rotate: number;
  /** Radial velocity: negative pulls inward, positive pushes out. */
  radial: number;
  /** Directional shear along x. */
  shear: number;
  /** How fast the field itself evolves. */
  warpSpeed: number;
  /** Fine-detail octave gain. */
  detail: number;
  /** Snaps motion to a grid when high. */
  quantize: number;
}

export const MOTION: Record<MotionId, { desc: string; p: MotionParams }> = {
  drift: {
    desc: 'Slow, wide, unhurried. Almost still. For sparse or ambient passages.',
    p: { curlAmp: 0.18, curlFreq: 1.1, rotate: 0.02, radial: 0.0, shear: 0.0, warpSpeed: 0.08, detail: 0.2, quantize: 0 },
  },
  orbit: {
    desc: 'Steady rotation around a center. Circular, hypnotic, continuous.',
    p: { curlAmp: 0.22, curlFreq: 1.6, rotate: 0.55, radial: 0.0, shear: 0.0, warpSpeed: 0.18, detail: 0.3, quantize: 0 },
  },
  pulse: {
    desc: 'Rhythmic expansion and contraction locked to the beat. Breathing.',
    p: { curlAmp: 0.25, curlFreq: 2.0, rotate: 0.05, radial: 0.42, shear: 0.0, warpSpeed: 0.35, detail: 0.45, quantize: 0 },
  },
  shear: {
    desc: 'Strong directional sliding across the frame. Lateral, unsettled.',
    p: { curlAmp: 0.3, curlFreq: 1.4, rotate: 0.0, radial: 0.0, shear: 0.7, warpSpeed: 0.3, detail: 0.35, quantize: 0 },
  },
  turbulent: {
    desc: 'Chaotic, high-frequency churn. For dense, loud, distorted material.',
    p: { curlAmp: 0.75, curlFreq: 4.5, rotate: 0.12, radial: 0.1, shear: 0.2, warpSpeed: 0.8, detail: 0.9, quantize: 0 },
  },
  collapse: {
    desc: 'Everything drawn inward toward a singularity. Tense, contracting.',
    p: { curlAmp: 0.3, curlFreq: 2.2, rotate: 0.25, radial: -0.75, shear: 0.0, warpSpeed: 0.4, detail: 0.5, quantize: 0 },
  },
  bloom: {
    desc: 'Rapid outward expansion from the center. Release, opening up, a drop.',
    p: { curlAmp: 0.35, curlFreq: 1.8, rotate: -0.15, radial: 0.85, shear: 0.0, warpSpeed: 0.5, detail: 0.55, quantize: 0 },
  },
  lattice: {
    desc: 'Motion snapped to a hard grid. Mechanical, quantized, digital.',
    p: { curlAmp: 0.4, curlFreq: 3.0, rotate: 0.0, radial: 0.0, shear: 0.15, warpSpeed: 0.45, detail: 0.6, quantize: 1 },
  },
};

/** Inigo Quilez cosine palette: color(t) = a + b * cos(2pi * (c*t + d)). */
export interface PaletteParams {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  d: [number, number, number];
}

export const PALETTE: Record<PaletteId, { desc: string; p: PaletteParams }> = {
  ember: {
    desc: 'Deep reds into orange and gold. Warm, burning, organic.',
    p: { a: [0.5, 0.28, 0.18], b: [0.5, 0.35, 0.2], c: [1, 1, 1], d: [0.0, 0.08, 0.16] },
  },
  ice: {
    desc: 'Pale cyan, white, deep blue. Cold, clean, crystalline.',
    p: { a: [0.38, 0.5, 0.6], b: [0.3, 0.35, 0.4], c: [1, 1, 1], d: [0.55, 0.6, 0.68] },
  },
  ultraviolet: {
    desc: 'Violet, magenta, electric blue. Synthetic, nocturnal, neon.',
    p: { a: [0.42, 0.22, 0.55], b: [0.42, 0.25, 0.45], c: [1, 1, 1], d: [0.72, 0.85, 0.28] },
  },
  chlorophyll: {
    desc: 'Greens into yellow-green. Verdant, natural, alive.',
    p: { a: [0.28, 0.48, 0.3], b: [0.3, 0.42, 0.28], c: [1, 1, 1], d: [0.3, 0.22, 0.4] },
  },
  sodium: {
    desc: 'Amber and dirty yellow on near-black. Streetlight, sodium-vapor, lonely.',
    p: { a: [0.45, 0.35, 0.1], b: [0.45, 0.38, 0.12], c: [1, 1, 1], d: [0.1, 0.12, 0.0] },
  },
  oxide: {
    desc: 'Rust, copper, teal patina. Corroded, aged, industrial.',
    p: { a: [0.42, 0.3, 0.26], b: [0.38, 0.28, 0.3], c: [1, 1, 1], d: [0.02, 0.3, 0.55] },
  },
  monochrome: {
    desc: 'Pure greyscale, no hue at all. Stark, severe, graphic.',
    p: { a: [0.5, 0.5, 0.5], b: [0.45, 0.45, 0.45], c: [1, 1, 1], d: [0.0, 0.0, 0.0] },
  },
  spectral: {
    desc: 'Full rainbow sweep across the whole hue circle. Maximal, saturated, psychedelic.',
    p: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0.0, 0.33, 0.67] },
  },
};

/**
 * Texture weights are the mixing weights themselves.
 *
 * Each entry is one-hot, so blending a distribution over labels yields that
 * same distribution as shader mix weights - a 70/30 answer composites 70/30
 * in the fragment shader with no extra machinery.
 */
export interface TextureParams {
  filament: number;
  plasma: number;
  grain: number;
  cellular: number;
  strata: number;
  shards: number;
  /** Edge hardness of whatever the mix produces, 0..1. */
  sharpness: number;
}

const tex = (k: keyof Omit<TextureParams, 'sharpness'>, sharpness: number): TextureParams => ({
  filament: 0, plasma: 0, grain: 0, cellular: 0, strata: 0, shards: 0,
  [k]: 1,
  sharpness,
});

export const TEXTURE: Record<TextureId, { desc: string; p: TextureParams }> = {
  filament: {
    desc: 'Thin bright threads and filaments, like smoke lit from behind. Delicate, linear, wispy.',
    p: tex('filament', 0.6),
  },
  plasma: {
    desc: 'Smooth continuous gradients with no hard edges. Soft, gaseous, flowing, liquid.',
    p: tex('plasma', 0.15),
  },
  grain: {
    desc: 'Dense high-frequency speckle and static. Gritty, noisy, sandy, granular.',
    p: tex('grain', 0.85),
  },
  cellular: {
    desc: 'Rounded cells and bubbles with visible boundaries. Organic, biological, clustered.',
    p: tex('cellular', 0.5),
  },
  strata: {
    desc: 'Layered contour bands, like a topographic map. Stratified, geological, ringed.',
    p: tex('strata', 0.7),
  },
  shards: {
    desc: 'Hard-edged angular fragments. Broken glass, crystalline, faceted, aggressive.',
    p: tex('shards', 0.95),
  },
};

/** One-hot weights that composite directly as shader mix weights, like TEXTURE. */
export interface GeometryParams {
  circles: number;
  hexagons: number;
  stars: number;
}

const geo = (k: keyof GeometryParams): GeometryParams => ({ circles: 0, hexagons: 0, stars: 0, [k]: 1 });

export const GEOMETRY: Record<GeometryId, { desc: string; p: GeometryParams }> = {
  none: {
    desc: 'No geometric accents. Pure noise-derived field, nothing hard-edged laid over it.',
    p: { circles: 0, hexagons: 0, stars: 0 },
  },
  circles: {
    desc: 'Orbiting ring accents. Soft, planetary, continuous - the gentlest of the three.',
    p: geo('circles'),
  },
  hexagons: {
    desc: 'Orbiting hexagon accents. Structured, crystalline, faintly mechanical.',
    p: geo('hexagons'),
  },
  stars: {
    desc: 'Orbiting star accents. Spiky, ornamental, the most ornate of the three.',
    p: geo('stars'),
  },
};

export interface SymmetryParams {
  /** Kaleidoscope fold count; 0 disables folding. */
  fold: number;
  /** Mirror blend across the vertical axis, 0..1. */
  mirror: number;
  /** Polar-coordinate remap amount, 0..1. */
  polar: number;
}

export const SYMMETRY: Record<SymmetryId, { desc: string; p: SymmetryParams }> = {
  none: { desc: 'No symmetry. Free-form, asymmetric, natural.', p: { fold: 0, mirror: 0, polar: 0 } },
  mirror: { desc: 'Mirrored left-to-right. Simple bilateral symmetry.', p: { fold: 0, mirror: 1, polar: 0 } },
  kaleido3: { desc: 'Threefold kaleidoscope. Loose, triangular symmetry.', p: { fold: 3, mirror: 0.5, polar: 0 } },
  kaleido6: { desc: 'Sixfold kaleidoscope. Snowflake, hexagonal, ornate.', p: { fold: 6, mirror: 0.6, polar: 0 } },
  kaleido12: { desc: 'Twelvefold kaleidoscope. Dense mandala, maximal ornament.', p: { fold: 12, mirror: 0.7, polar: 0 } },
  polar: { desc: 'Polar remap - everything wraps around the center as rings and spokes.', p: { fold: 0, mirror: 0, polar: 1 } },
};

export interface FeedbackParams {
  /** How much of the previous frame survives, 0..1. Higher means longer trails. */
  decay: number;
  /** Per-frame scale of the fed-back image. Positive zooms in, negative zooms out. */
  zoom: number;
  /** Per-frame rotation of the fed-back image. */
  rotate: number;
  /** Per-channel offset in the feedback tap, producing chromatic separation. */
  chroma: number;
  /** Directional blur applied to the feedback tap. */
  smear: number;
}

export const FEEDBACK: Record<FeedbackId, { desc: string; p: FeedbackParams }> = {
  none: { desc: 'No frame feedback. Crisp, instantaneous, no history.', p: { decay: 0.0, zoom: 0, rotate: 0, chroma: 0, smear: 0 } },
  trail: { desc: 'Motion leaves fading trails behind it. Persistence of vision.', p: { decay: 0.82, zoom: 0, rotate: 0, chroma: 0.1, smear: 0 } },
  zoom_in: { desc: 'The image tunnels continuously inward. Falling forward.', p: { decay: 0.9, zoom: 0.012, rotate: 0.004, chroma: 0.15, smear: 0 } },
  zoom_out: { desc: 'The image recedes endlessly. Pulling away, receding.', p: { decay: 0.9, zoom: -0.012, rotate: -0.004, chroma: 0.15, smear: 0 } },
  swirl: { desc: 'Feedback spirals around the center. Vortex, whirlpool.', p: { decay: 0.88, zoom: 0.004, rotate: 0.022, chroma: 0.2, smear: 0.1 } },
  smear: { desc: 'Heavy directional blur. Long, painterly, liquid streaks.', p: { decay: 0.93, zoom: 0.002, rotate: 0, chroma: 0.3, smear: 0.8 } },
};

/** Build the `criteria` map for a Choice question: every label with its description. */
export function criteriaOf(table: Record<string, { desc: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(table)) out[k] = v.desc;
  return out;
}

/**
 * Blend a family of parameter vectors by a probability distribution.
 *
 * Unlisted labels contribute nothing, and the weights are renormalized so a
 * truncated distribution still yields a valid vector. This is where Jev's
 * calibration turns into geometry.
 */
export function blend<T extends string, P>(table: Record<T, { p: P }>, w: Weighted<T>): P {
  const entries = Object.entries(w.p) as [T, number][];
  let total = 0;
  for (const [, v] of entries) total += v ?? 0;
  if (total <= 0) return structuredClone(table[w.top].p);

  const out = structuredClone(table[w.top].p) as Record<string, unknown>;
  for (const key of Object.keys(out)) out[key] = zeroLike(out[key]);

  for (const [label, weight] of entries) {
    const row = table[label];
    if (!row || !weight) continue;
    const k = weight / total;
    for (const [key, val] of Object.entries(row.p as Record<string, unknown>)) {
      out[key] = addScaled(out[key], val, k);
    }
  }
  return out as P;
}

function zeroLike(v: unknown): unknown {
  return Array.isArray(v) ? v.map(() => 0) : 0;
}

function addScaled(acc: unknown, val: unknown, k: number): unknown {
  if (Array.isArray(acc) && Array.isArray(val)) {
    return acc.map((a, i) => (a as number) + ((val[i] as number) ?? 0) * k);
  }
  return (acc as number) + (val as number) * k;
}
