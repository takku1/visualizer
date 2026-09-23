import type { FeatureFrame, VisualPlan, Weighted } from '../types';

/**
 * Semantic controls shared by the world model and renderer adapter.
 *
 * These are deliberately broad, bounded axes. They are not shader uniforms
 * and should not become one System One question each.
 */
export interface VisualControlState {
  timbre: {
    smoothness: number;
    brightness: number;
    harmonicity: number;
    noisiness: number;
    percussiveness: number;
    stereoWidth: number;
  };
  energy: {
    intensity: number;
    volatility: number;
    momentum: number;
    transience: number;
  };
  density: number;
  motion: { flow: number; turbulence: number; quantization: number };
  space: { radial: number; spread: number; focality: number; depth: number };
  scale: number;
  material: { fluidity: number; crystallinity: number; cellularity: number; grain: number };
  order: { symmetry: number; structure: number; ambiguity: number };
  memory: { persistence: number; accumulation: number; decay: number };
  lifecycle: { growth: number; mutation: number; erosion: number; renewal: number };
  composition: { focus: number; negativeSpace: number; reveal: number };
  light: { emission: number; contrast: number; hueDrift: number; warmth: number };
}

export function initialControls(): VisualControlState {
  return {
    timbre: { smoothness: 0.5, brightness: 0.5, harmonicity: 0.5, noisiness: 0.2, percussiveness: 0.2, stereoWidth: 0 },
    energy: { intensity: 0.35, volatility: 0.2, momentum: 0.35, transience: 0.2 },
    density: 0.35,
    motion: { flow: 0.35, turbulence: 0.2, quantization: 0 },
    space: { radial: 0.35, spread: 0.5, focality: 0.35, depth: 0.5 },
    scale: 0.5,
    material: { fluidity: 0.5, crystallinity: 0.2, cellularity: 0.2, grain: 0.2 },
    order: { symmetry: 0.2, structure: 0.5, ambiguity: 0.35 },
    memory: { persistence: 0.25, accumulation: 0.2, decay: 0.7 },
    lifecycle: { growth: 0.25, mutation: 0.2, erosion: 0.15, renewal: 0.25 },
    composition: { focus: 0.35, negativeSpace: 0.5, reveal: 0.35 },
    light: { emission: 0.35, contrast: 0.5, hueDrift: 0.2, warmth: 0.5 },
  };
}

/** Plan-level priors; frame-level audio is applied separately each update. */
export function controlsFromPlan(plan: VisualPlan): VisualControlState {
  const c = initialControls();
  const plasma = affinity(plan.texture, { plasma: 0.95, filament: 0.7, strata: 0.35 });
  const rough = affinity(plan.texture, { grain: 0.95, shards: 0.9, strata: 0.45 });
  const cellular = affinity(plan.texture, { cellular: 1, neural: 0.75 });
  const turbulent = affinity(plan.motion, { turbulent: 1, shear: 0.7, lattice: 0.45 });
  const flow = affinity(plan.motion, { drift: 0.2, orbit: 0.55, pulse: 0.65, turbulent: 0.9, bloom: 0.65 });
  const symmetry = affinity(plan.symmetry, { mirror: 0.4, kaleido3: 0.65, kaleido6: 0.8, kaleido12: 1, polar: 0.55 });
  const feedback = affinity(plan.feedback, { trail: 0.55, zoom_in: 0.8, zoom_out: 0.8, swirl: 0.75, smear: 0.9 });
  const architectural = affinity(plan.geometry, { circles: 0.35, hexagons: 0.85, stars: 0.7 });
  const energy = clamp(plan.intensity / 4, 0, 1);

  c.timbre.smoothness = clamp(plasma * 0.8 + (1 - rough) * 0.2, 0, 1);
  c.timbre.harmonicity = clamp(0.35 + cellular * 0.35 + symmetry * 0.2, 0, 1);
  c.timbre.noisiness = clamp(rough, 0, 1);
  c.energy = { intensity: energy, volatility: clamp(turbulent * 0.7 + energy * 0.2, 0, 1), momentum: flow, transience: rough * 0.45 };
  c.density = clamp(0.18 + energy * 0.42 + rough * 0.2 + cellular * 0.15, 0, 1);
  c.motion = { flow, turbulence: turbulent, quantization: affinity(plan.motion, { lattice: 1 }) };
  c.space = { radial: affinity(plan.symmetry, { polar: 1, kaleido6: 0.7, kaleido12: 0.8 }), spread: clamp(0.35 + feedback * 0.55, 0, 1), focality: clamp(1 - feedback * 0.5, 0, 1), depth: clamp(0.35 + feedback * 0.5, 0, 1) };
  c.scale = clamp(0.25 + affinity(plan.feedback, { zoom_out: 0.8, smear: 0.6 }) * 0.55, 0, 1);
  c.material = { fluidity: plasma, crystallinity: clamp(rough * 0.7 + architectural * 0.3, 0, 1), cellularity: cellular, grain: rough };
  c.order = { symmetry, structure: clamp(architectural * 0.55 + cellular * 0.25 + 0.2, 0, 1), ambiguity: affinity(plan.texture, { neural: 1, cellular: 0.65, plasma: 0.3 }) };
  c.memory = { persistence: feedback, accumulation: clamp(feedback * 0.8 + energy * 0.1, 0, 1), decay: clamp(1 - feedback, 0, 1) };
  c.lifecycle = { growth: affinity(plan.motion, { bloom: 1, pulse: 0.75, drift: 0.25 }), mutation: clamp(turbulent * 0.7 + c.order.ambiguity * 0.3, 0, 1), erosion: affinity(plan.motion, { collapse: 0.9, drift: 0.25 }), renewal: clamp(0.25 + energy * 0.35, 0, 1) };
  c.composition = { focus: c.space.focality, negativeSpace: clamp(1 - c.density, 0, 1), reveal: c.order.ambiguity };
  c.light = { emission: clamp(0.2 + energy * 0.55, 0, 1), contrast: clamp(0.35 + rough * 0.45 + energy * 0.2, 0, 1), hueDrift: clamp(turbulent * 0.45 + feedback * 0.15, 0, 1), warmth: paletteWarmth(plan) };
  return c;
}

/** Add live audio evidence without replacing the plan's slower semantic priors. */
export function applyAudioControls(base: VisualControlState, f: FeatureFrame): VisualControlState {
  const c = cloneControls(base);
  // These are intentionally named intermediate signals. Keeping the audio
  // vocabulary here makes it auditable which musical evidence drives each
  // broad visual surface instead of hiding the mapping in shader math.
  const brightness = clamp(f.spectralCentroid, 0, 1);
  const noise = clamp(f.spectralFlatness, 0, 1);
  const harmonicity = clamp(f.harmonicity, 0, 1);
  const transient = clamp(f.transientness, 0, 1);
  const onset = clamp(f.flux * 0.45 + f.bassFlux * 0.3 + f.trebleFlux * 0.25, 0, 1);
  const energy = clamp(f.level * 0.65 + clamp(f.levelRelative / 4 + 0.5, 0, 1) * 0.2 + f.bass * 0.15, 0, 1);
  const tempo = clamp((f.tempo - 60) / 140, 0, 1);
  const beat = f.onBeat ? 1 : 0;
  const section = f.onSection ? 1 : 0;
  const width = clamp(f.stereoWidth, 0, 1);
  const low = clamp(f.bass, 0, 1);
  const high = clamp(f.treble, 0, 1);
  const midPresence = clamp(f.lowMid * 0.2 + f.mid * 0.4 + f.highMid * 0.3 + high * 0.1, 0, 1);
  const rolloff = clamp(f.spectralRolloff, 0, 1);
  const pitchFocus = clamp(maxValue(f.chroma) * 1.8, 0, 1) * clamp(f.keyConfidence, 0, 1);
  const tonal = clamp(harmonicity * (1 - noise * 0.35), 0, 1);

  // Timbre: spectral shape, harmonic/noise balance, and onset character.
  c.timbre.smoothness = mix(c.timbre.smoothness, clamp(1 - noise * 0.7 - transient * 0.15, 0, 1), 0.35);
  c.timbre.brightness = mix(c.timbre.brightness, brightness * 0.65 + midPresence * 0.35, 0.4);
  c.timbre.harmonicity = mix(c.timbre.harmonicity, tonal, 0.4);
  c.timbre.noisiness = mix(c.timbre.noisiness, noise, 0.4);
  c.timbre.percussiveness = mix(c.timbre.percussiveness, onset, 0.4);
  c.timbre.stereoWidth = mix(c.timbre.stereoWidth, width, 0.5);

  // Energy and density: loudness, relative loudness, dynamic change, and
  // rhythmic activity all remain separate so a loud sustained pad does not
  // read the same as a loud transient drum passage.
  c.energy.intensity = mix(c.energy.intensity, energy, 0.3);
  c.energy.volatility = mix(c.energy.volatility, clamp(f.flux * 0.5 + f.syncopation * 0.2 + f.microtiming * 0.1 + section * 0.2, 0, 1), 0.35);
  c.energy.momentum = mix(c.energy.momentum, clamp(energy * 0.55 + tempo * 0.25 + low * 0.2, 0, 1), 0.25);
  c.energy.transience = mix(c.energy.transience, transient, 0.4);
  c.density = mix(c.density, clamp(energy * 0.55 + onset * 0.3 + tempo * 0.15, 0, 1), 0.3);

  // Motion and space: faster rhythm and onsets agitate the field; stereo
  // width opens it while low-frequency weight gives it depth and scale.
  c.motion.flow = mix(c.motion.flow, clamp(energy * 0.3 + tempo * 0.25 + f.swing * 0.15 + f.rhythmConfidence * 0.15 + (1 - noise) * 0.15, 0, 1), 0.3);
  c.motion.turbulence = mix(c.motion.turbulence, clamp(onset * 0.65 + noise * 0.2 + transient * 0.15, 0, 1), 0.35);
  c.motion.quantization = mix(c.motion.quantization, clamp(tonal * 0.55 + f.subdivision * 0.25 + (1 - width) * 0.1 + beat * 0.1, 0, 1), 0.35);
  c.space.radial = mix(c.space.radial, clamp(width * 0.5 + f.polyrhythm * 0.25 + high * 0.15 + beat * 0.1, 0, 1), 0.3);
  c.space.spread = mix(c.space.spread, clamp(width * 0.7 + energy * 0.2 + high * 0.1, 0, 1), 0.35);
  c.space.focality = mix(c.space.focality, clamp(1 - width * 0.55 + low * 0.2, 0, 1), 0.3);
  c.space.depth = mix(c.space.depth, clamp(low * 0.35 + (1 - brightness) * 0.2 + rolloff * 0.2 + energy * 0.25, 0, 1), 0.3);
  c.scale = mix(c.scale, clamp(low * 0.4 + midPresence * 0.2 + energy * 0.25 + (1 - tempo) * 0.15, 0, 1), 0.25);

  // Material and order: tonal music stabilizes/structures the material;
  // noisy, bright, transient music roughens and breaks it apart.
  c.material.fluidity = mix(c.material.fluidity, clamp(midPresence * 0.35 + 1 - noise * 0.45 + (1 - tonal) * 0.2, 0, 1), 0.3);
  c.material.crystallinity = mix(c.material.crystallinity, clamp(tonal * 0.5 + pitchFocus * 0.2 + (1 - width) * 0.15 + high * 0.15, 0, 1), 0.3);
  c.material.cellularity = mix(c.material.cellularity, clamp(tonal * 0.45 + low * 0.35 + (1 - transient) * 0.2, 0, 1), 0.4);
  c.material.grain = mix(c.material.grain, clamp(noise * 0.6 + transient * 0.25 + high * 0.15, 0, 1), 0.4);
  c.order.symmetry = mix(c.order.symmetry, clamp(tonal * 0.5 + (1 - width) * 0.3 + (1 - onset) * 0.2, 0, 1), 0.25);
  c.order.structure = mix(c.order.structure, clamp(tonal * 0.45 + pitchFocus * 0.2 + (1 - noise) * 0.2 + (1 - transient) * 0.15, 0, 1), 0.3);
  c.order.ambiguity = mix(c.order.ambiguity, clamp(noise * 0.4 + f.microtiming * 0.2 + f.syncopation * 0.2 + transient * 0.1 + brightness * 0.1, 0, 1), 0.3);

  // Memory/lifecycle/composition/light: sustained low-change audio persists;
  // events renew and mutate the world, while energy reveals and illuminates it.
  c.memory.persistence = mix(c.memory.persistence, clamp((1 - transient) * 0.4 + (1 - onset) * 0.25 + tonal * 0.2 + f.rhythmConfidence * 0.15, 0, 1), 0.25);
  c.memory.accumulation = mix(c.memory.accumulation, clamp(energy * 0.5 + (1 - transient) * 0.3 + (1 - onset) * 0.2, 0, 1), 0.45);
  c.memory.decay = mix(c.memory.decay, clamp(transient * 0.45 + onset * 0.35 + (1 - tonal) * 0.2, 0, 1), 0.3);
  c.lifecycle.growth = mix(c.lifecycle.growth, clamp(energy * 0.55 + low * 0.2 + beat * 0.25, 0, 1), 0.3);
  c.lifecycle.mutation = mix(c.lifecycle.mutation, clamp(onset * 0.45 + noise * 0.2 + f.microtiming * 0.15 + f.polyrhythm * 0.1 + section * 0.1, 0, 1), 0.35);
  c.lifecycle.erosion = mix(c.lifecycle.erosion, clamp(noise * 0.45 + transient * 0.35 + (1 - energy) * 0.2, 0, 1), 0.3);
  c.lifecycle.renewal = mix(c.lifecycle.renewal, clamp(section * 0.5 + beat * 0.2 + energy * 0.3, 0, 1), 0.3);
  c.composition.focus = mix(c.composition.focus, clamp(1 - width * 0.6 + low * 0.2 + (1 - energy) * 0.2, 0, 1), 0.4);
  c.composition.negativeSpace = mix(c.composition.negativeSpace, clamp(1 - energy * 0.6 - onset * 0.25 + (1 - width) * 0.15, 0, 1), 0.3);
  c.composition.reveal = mix(c.composition.reveal, clamp(brightness * 0.25 + pitchFocus * 0.2 + energy * 0.3 + section * 0.25, 0, 1), 0.3);
  c.light.emission = mix(c.light.emission, clamp(energy * 0.65 + high * 0.2 + beat * 0.15, 0, 1), 0.35);
  c.light.contrast = mix(c.light.contrast, clamp((1 - noise) * 0.35 + energy * 0.35 + transient * 0.3, 0, 1), 0.3);
  c.light.hueDrift = mix(c.light.hueDrift, clamp(brightness * 0.35 + rolloff * 0.2 + onset * 0.3 + width * 0.15, 0, 1), 0.3);
  c.light.warmth = mix(c.light.warmth, clamp(low * 0.65 + (1 - brightness) * 0.25 + (1 - high) * 0.1, 0, 1), 0.4);
  return c;
}

function maxValue(values: Float32Array): number {
  let max = 0;
  for (const value of values) max = Math.max(max, value);
  return max;
}

export function cloneControls(c: VisualControlState): VisualControlState {
  return structuredClone(c);
}

function paletteWarmth(plan: VisualPlan): number {
  return clamp(0.5 + affinity(plan.palette, { ember: 0.45, sodium: 0.4, oxide: 0.25, ice: -0.35, ultraviolet: -0.15, chlorophyll: -0.05 }), 0, 1);
}

function affinity<T extends string>(weighted: Weighted<T>, values: Partial<Record<T, number>>): number {
  let total = 0, value = 0;
  for (const [label, raw] of Object.entries(weighted.p) as [string, number][]) { total += raw ?? 0; value += (raw ?? 0) * (values[label as T] ?? 0); }
  return total > 0 ? value / total : values[weighted.top] ?? 0;
}

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
