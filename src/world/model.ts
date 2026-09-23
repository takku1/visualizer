import type { FeatureFrame, VisualPlan, Weighted } from '../types';
import { applyAudioControls, cloneControls, controlsFromPlan, initialControls, type VisualControlState } from './controls';
import type { LyricEvent } from '../lyrics/types';

export type SemanticAxis = 'affect' | 'form' | 'space' | 'behavior' | 'coherence' | 'persistence' | 'abstraction';
export type SemanticDistribution = Record<string, number>;

export interface WorldSemantics {
  affect: SemanticDistribution;
  form: SemanticDistribution;
  space: SemanticDistribution;
  behavior: SemanticDistribution;
  coherence: SemanticDistribution;
  persistence: SemanticDistribution;
  abstraction: SemanticDistribution;
}

export interface WorldDynamics {
  age: number;
  memory: number;
  impulse: number;
  seed: number;
}

export interface WorldState {
  semantics: WorldSemantics;
  dynamics: WorldDynamics;
  controls: VisualControlState;
}

/** Scalar projection consumed by the renderer; semantic distributions stay above this seam. */
export interface WorldProjection {
  organic: number;
  architectural: number;
  atmospheric: number;
  vast: number;
  growing: number;
  decaying: number;
  turbulent: number;
  structured: number;
  persistent: number;
  suggestive: number;
  memory: number;
  impulse: number;
  seed: number;
  controls: VisualControlState;
}

const INITIAL: WorldState = {
  semantics: {
    affect: { serene: 0.55, melancholic: 0.2, ominous: 0.1, ecstatic: 0.1, playful: 0.05 },
    form: { organic: 0.5, architectural: 0.25, atmospheric: 0.25 },
    space: { vast: 0.55, intimate: 0.2, enclosed: 0.15, planar: 0.1 },
    behavior: { growing: 0.25, decaying: 0.2, flowing: 0.4, turbulent: 0.15 },
    coherence: { structured: 0.55, ambiguous: 0.3, chaotic: 0.15 },
    persistence: { stable: 0.7, drifting: 0.2, ephemeral: 0.1 },
    abstraction: { suggestive: 0.55, symbolic: 0.3, representational: 0.15 },
  },
  dynamics: { age: 0, memory: 0.2, impulse: 0, seed: 0.37 },
  controls: initialControls(),
};

/** Deep module owning semantic continuity and event response. */
export class WorldModel {
  #state = cloneWorld(INITIAL);
  #target = cloneWorld(INITIAL);
  #plan: VisualPlan | null = null;

  get state(): WorldState { return cloneWorld(this.#state); }

  setPlan(plan: VisualPlan): void {
    this.#plan = plan;
    const next = fromPlan(plan);
    next.dynamics = { ...this.#target.dynamics, age: this.#state.dynamics.age, memory: this.#state.dynamics.memory, impulse: this.#state.dynamics.impulse };
    this.#target = next;
  }

  /** Test seam: intervene on meaning while holding audio and renderer seed fixed. */
  intervene(axis: SemanticAxis, values: SemanticDistribution): void {
    this.#target.semantics[axis] = normalize(values);
  }

  /** Apply a lyric semantic event without changing the world seed or audio clock. */
  applyLyricEvent(event: LyricEvent): void {
    if (event.kind === 'cue-enter') {
      this.#target.semantics.behavior = normalize({ ...this.#target.semantics.behavior, growing: 0.65, flowing: 0.25 });
      this.#target.semantics.abstraction = normalize({ ...this.#target.semantics.abstraction, suggestive: 0.7 });
      this.#state.dynamics.impulse = Math.max(this.#state.dynamics.impulse, clamp(0.35 + event.strength * 0.35, 0, 1));
    } else if (event.kind === 'word-enter') {
      this.#target.semantics.behavior = normalize({ ...this.#target.semantics.behavior, growing: 0.75, flowing: 0.2 });
      this.#state.dynamics.impulse = Math.max(this.#state.dynamics.impulse, clamp(0.25 + event.strength * 0.25, 0, 1));
    } else if (event.kind === 'cue-exit') {
      this.#target.semantics.behavior = normalize({ ...this.#target.semantics.behavior, decaying: 0.55, flowing: 0.25 });
    } else if (event.kind === 'lyric-memory') {
      this.#target.semantics.persistence = normalize({ ...this.#target.semantics.persistence, stable: 0.8, drifting: 0.12, ephemeral: 0.08 });
      this.#state.dynamics.memory = Math.max(this.#state.dynamics.memory, clamp(0.3 + event.strength * 0.4, 0, 0.92));
    }
  }

  update(frame: FeatureFrame): WorldProjection {
    const dt = Math.min(Math.max(frame.dt, 0), 0.05);
    const k = 1 - Math.exp(-dt * 1.8);
    for (const axis of Object.keys(this.#state.semantics) as SemanticAxis[]) {
      this.#state.semantics[axis] = approachDistribution(this.#state.semantics[axis], this.#target.semantics[axis], k);
    }
    const event = frame.onBeat
      ? clamp(0.2 + frame.bassFlux * 0.7 + frame.flux * 0.35 + this.#state.controls.timbre.percussiveness * 0.18, 0, 1)
      : 0;
    const d = this.#state.dynamics;
    if (this.#plan) this.#target.controls = applyAudioControls(controlsFromPlan(this.#plan), frame);
    this.#state.controls = approachControls(this.#state.controls, this.#target.controls, k);
    d.impulse = Math.max(event, d.impulse * Math.exp(-dt * 3.5));
    // Memory follows recent world activity instead of integrating every beat
    // forever. The old accumulator saturated at 1 within seconds, making
    // every later world look maximally persistent.
    const memoryResponse = 1 - Math.exp(-dt * (0.35 + score(this.#state.semantics.persistence, 'stable') * 0.45 + this.#state.controls.memory.accumulation * 0.35));
    d.memory += (d.impulse - d.memory) * memoryResponse;
    d.memory = clamp(d.memory, 0, 0.92);
    d.age += dt;
    return this.projection();
  }

  projection(): WorldProjection {
    const s = this.#state.semantics;
    const form = (label: string) => score(s.form, label);
    const behavior = (label: string) => score(s.behavior, label);
    return {
      organic: form('organic'),
      architectural: form('architectural'),
      atmospheric: form('atmospheric'),
      vast: score(s.space, 'vast'),
      growing: behavior('growing'),
      decaying: behavior('decaying'),
      turbulent: behavior('turbulent'),
      structured: score(s.coherence, 'structured'),
      persistent: score(s.persistence, 'stable'),
      suggestive: score(s.abstraction, 'suggestive'),
      memory: this.#state.dynamics.memory,
      impulse: this.#state.dynamics.impulse,
      seed: this.#state.dynamics.seed,
      controls: cloneControls(this.#state.controls),
    };
  }

  reset(): void { this.#state = cloneWorld(INITIAL); this.#target = cloneWorld(INITIAL); }
}

function fromPlan(plan: VisualPlan): WorldState {
  const organic = affinity(plan.texture, { cellular: 0.8, neural: 0.9, filament: 0.55, plasma: 0.35 });
  const architectural = clamp(affinity(plan.geometry, { hexagons: 0.9, stars: 0.75, circles: 0.45 }) * 0.65 + affinity(plan.symmetry, { kaleido12: 0.9, kaleido6: 0.75, kaleido3: 0.55, mirror: 0.35, polar: 0.45 }) * 0.35, 0, 1);
  const atmospheric = affinity(plan.texture, { plasma: 0.9, filament: 0.75, strata: 0.55 });
  const vast = clamp(0.3 + affinity(plan.feedback, { zoom_out: 0.85, trail: 0.65, smear: 0.6 }) * 0.45, 0, 1);
  const growing = affinity(plan.motion, { bloom: 0.95, pulse: 0.7, drift: 0.25 });
  const decaying = affinity(plan.motion, { collapse: 0.9, drift: 0.35 }) + affinity(plan.feedback, { smear: 0.25 });
  const turbulent = clamp(affinity(plan.motion, { turbulent: 1, shear: 0.65, lattice: 0.5 }) + affinity(plan.texture, { shards: 0.35, grain: 0.3 }), 0, 1);
  const structured = clamp(0.25 + architectural * 0.5 + affinity(plan.texture, { strata: 0.35, cellular: 0.3, neural: 0.4 }), 0, 1);
  const persistent = affinity(plan.feedback, { trail: 0.8, zoom_in: 0.9, zoom_out: 0.9, swirl: 0.85, smear: 0.95 });
  const suggestive = affinity(plan.texture, { neural: 1, cellular: 0.7, filament: 0.45, plasma: 0.3 });
  return {
    semantics: {
      affect: { serene: clamp(1 - turbulent, 0, 1), melancholic: decaying, ominous: affinity(plan.motion, { collapse: 0.8 }), ecstatic: growing, playful: affinity(plan.geometry, { stars: 0.5 }) },
      form: { organic, architectural, atmospheric },
      space: { vast, intimate: 1 - vast, enclosed: clamp(1 - vast - atmospheric * 0.25, 0, 1), planar: architectural * 0.35 },
      behavior: { growing, decaying: clamp(decaying, 0, 1), flowing: clamp(atmospheric * 0.7 + affinity(plan.motion, { orbit: 0.65, drift: 0.4 }), 0, 1), turbulent },
      coherence: { structured, ambiguous: suggestive, chaotic: turbulent },
      persistence: { stable: persistent, drifting: clamp(1 - persistent, 0, 1), ephemeral: clamp(1 - persistent, 0, 1) },
      abstraction: { suggestive, symbolic: architectural * 0.5, representational: 1 - suggestive },
    },
    dynamics: { age: 0, memory: 0, impulse: 0, seed: seedOf(plan) },
    controls: controlsFromPlan(plan),
  };
}

function affinity<T extends string>(weighted: Weighted<T>, values: Partial<Record<T, number>>): number {
  let total = 0, value = 0;
  for (const [label, raw] of Object.entries(weighted.p) as [string, number][]) { total += raw ?? 0; value += (raw ?? 0) * (values[label as T] ?? 0); }
  return total > 0 ? value / total : values[weighted.top] ?? 0;
}
function score(values: SemanticDistribution, key: string): number { return values[key] ?? 0; }
function normalize(values: SemanticDistribution): SemanticDistribution { const total = Object.values(values).reduce((a, b) => a + Math.max(0, b), 0); return total > 0 ? Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Math.max(0, v) / total])) : {}; }
function approachDistribution(a: SemanticDistribution, b: SemanticDistribution, k: number): SemanticDistribution { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); return normalize(Object.fromEntries([...keys].map((key) => [key, (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * k]))); }
function cloneWorld(world: WorldState): WorldState { return { semantics: Object.fromEntries(Object.entries(world.semantics).map(([k, v]) => [k, { ...v}])) as WorldSemantics, dynamics: { ...world.dynamics }, controls: cloneControls(world.controls) }; }
function approachControls(a: VisualControlState, b: VisualControlState, k: number): VisualControlState {
  const out = cloneControls(a);
  const walk = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const key of Object.keys(target)) {
      const av = target[key];
      const bv = source[key];
      if (typeof av === 'number' && typeof bv === 'number') target[key] = av + (bv - av) * k;
      else if (av && bv && typeof av === 'object' && typeof bv === 'object') walk(av as Record<string, unknown>, bv as Record<string, unknown>);
    }
  };
  walk(out as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>);
  return out;
}
function seedOf(plan: VisualPlan): number { const text = `${plan.motion.top}/${plan.palette.top}/${plan.texture.top}/${plan.symmetry.top}`; let hash = 2166136261; for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619); return ((hash >>> 0) % 10000) / 10000; }
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
