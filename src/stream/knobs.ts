import type { VisualPlan, Weighted } from '../types';
import type { TrackContext } from '../director/director';
import { sceneFromPlan, type Look, type Rgb } from './scenes';

/**
 * Live knob direction (docs/live-knob-direction.md): the director steers
 * knobs inside the running model instead of splicing a new keyframe for every
 * decision.
 *
 * The director's answers are calibrated distributions, and this is where they
 * finally render as mixtures: each anchor scene's blend weight is the joint
 * probability the latest decision gives its labels, so a 60/40 answer is a
 * 60/40 blend of prompts, palettes and forms.
 */
export interface KnobTargets {
  /** Anchor prompts and their target weights (sum to 1). */
  prompts: string[];
  weights: number[];
  /** The procedural look, blended by the same weights. */
  look: Look;
  /** Multipliers on the audio-driven Bender amounts (hue, swell, glass, lurch). */
  bendGain: { hue: number; swell: number; glass: number; lurch: number };
  /** Signed h-space strengths: the scene's mood, applied inside the UNet. */
  hspace: { energy: number; light: number; organic: number };
  /** Glide time constant, seconds. */
  tauSec: number;
  /** True when the director asked for a hard cut: splice a keyframe instead of gliding. */
  cut: boolean;
}

interface Anchor {
  prompt: string;
  labels: Labels;
  look: Look;
  /** Consecutive decisions this anchor has been below the retirement weight. */
  starved: number;
}

type Labels = Pick<Record<keyof AxisPlan, string>, keyof AxisPlan>;
type AxisPlan = Pick<VisualPlan, 'motion' | 'palette' | 'texture' | 'geometry' | 'symmetry'>;
const AXES: (keyof AxisPlan)[] = ['motion', 'palette', 'texture', 'geometry', 'symmetry'];

const labelsOf = (plan: VisualPlan): Labels =>
  Object.fromEntries(AXES.map((a) => [a, plan[a].top])) as Labels;

/** The plan with one axis moved to its runner-up label. */
function runnerUp(plan: VisualPlan, axis: 'palette' | 'texture' | 'motion'): VisualPlan | null {
  const dist = plan[axis] as Weighted<string>;
  const second = Object.entries(dist.p)
    .filter(([k, p]) => k !== dist.top && (p ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  if (!second) return null;
  return { ...plan, [axis]: { ...dist, top: second[0] } } as VisualPlan;
}

const mix3 = (parts: [Rgb, number][]): Rgb =>
  [0, 1, 2].map((i) => parts.reduce((s, [c, w]) => s + c[i]! * w, 0)) as Rgb;

export interface KnobDirectorOptions {
  /** Maximum anchors blended at once. */
  maxAnchors?: number;
  /** Softmax temperature on joint label probabilities; > 1 keeps minority anchors visible. */
  temperature?: number;
  /** An anchor below this weight for `retireAfter` decisions is replaced. */
  retireBelow?: number;
  retireAfter?: number;
  /** Glide time constant, seconds. */
  tauSec?: number;
  /** Hard-cut probability above which a keyframe splice is requested. */
  cutAbove?: number;
}

export class KnobDirector {
  readonly maxAnchors: number;
  readonly temperature: number;
  readonly retireBelow: number;
  readonly retireAfter: number;
  readonly tauSec: number;
  readonly cutAbove: number;
  #anchors: Anchor[] = [];
  #index = 0;
  /**
   * Discrete structure (symmetry fold, field seed) cannot glide,
   * so it is fixed per anchor set: taken from the top anchor when the set is
   * (re)made, and changed only by a cut. Otherwise two anchors trading the
   * top spot near 50/50 would snap the procedural geometry every decision.
   */
  #structure: Pick<Look, 'fold' | 'seed'> | null = null;

  constructor(opts: KnobDirectorOptions = {}) {
    this.maxAnchors = opts.maxAnchors ?? 3;
    this.temperature = opts.temperature ?? 1.5;
    this.retireBelow = opts.retireBelow ?? 0.08;
    this.retireAfter = opts.retireAfter ?? 2;
    this.tauSec = opts.tauSec ?? 4;
    this.cutAbove = opts.cutAbove ?? 0.8;
  }

  get anchors(): readonly { prompt: string }[] {
    return this.#anchors;
  }

  /** One director decision in, knob targets out. */
  decide(plan: VisualPlan, ctx: TrackContext): KnobTargets {
    const cut = plan.hardCut > this.cutAbove;
    const candidates = [plan, runnerUp(plan, 'palette'), runnerUp(plan, 'texture')].filter((p): p is VisualPlan => p !== null);

    if (cut || this.#anchors.length === 0) {
      // Fresh anchor set: a cut, or the first decision of the session.
      this.#anchors = candidates.slice(0, this.maxAnchors).map((p) => this.#anchor(p, ctx));
      const { fold, seed } = this.#anchors[0]!.look;
      this.#structure = { fold, seed };
    } else {
      this.#reanchor(plan, candidates, ctx);
    }

    const weights = this.#weights(plan);
    const lookParts = this.#anchors.map((a, i) => [a.look, weights[i]!] as const);
    const look: Look = {
      palette: [0, 1, 2].map((k) => mix3(lookParts.map(([l, w]) => [l.palette[k]!, w]))) as Look['palette'],
      organic: lookParts.reduce((s, [l, w]) => s + l.organic * w, 0),
      warp: lookParts.reduce((s, [l, w]) => s + l.warp * w, 0),
      ...this.#structure!,
    };
    const drive = plan.intensity / 4;
    // Light from the palette's brightness (its body colour's luminance),
    // organic from the blended look, energy from intensity. Kept under 1:
    // strength 1 is one standard deviation of the bottleneck.
    const body = look.palette[1];
    const luminance = 0.2126 * body[0] + 0.7152 * body[1] + 0.0722 * body[2];
    return {
      hspace: {
        energy: 0.8 * (drive * 2 - 1),
        light: Math.max(-0.8, Math.min(0.8, (luminance - 0.4) * 2)),
        organic: 0.8 * (look.organic * 2 - 1),
      },
      prompts: this.#anchors.map((a) => a.prompt),
      weights,
      look,
      bendGain: { hue: 0.6 + 0.4 * drive, swell: 0.5 + 0.7 * drive, glass: 0.6 + 0.6 * drive, lurch: 0.4 + 0.8 * drive },
      tauSec: cut ? 0.5 : this.tauSec,
      cut,
    };
  }

  #anchor(plan: VisualPlan, ctx: TrackContext): Anchor {
    const scene = sceneFromPlan(plan, ctx, this.#index++);
    return { prompt: scene.prompt, labels: labelsOf(plan), look: scene.look, starved: 0 };
  }

  /** Joint probability of an anchor's labels under the plan, tempered and normalized. */
  #weights(plan: VisualPlan): number[] {
    const raw = this.#anchors.map((a) =>
      AXES.reduce((prod, axis) => prod * Math.max((plan[axis] as Weighted<string>).p[a.labels[axis]] ?? 0, 1e-4), 1) ** (1 / this.temperature));
    const total = raw.reduce((s, x) => s + x, 0);
    return raw.map((x) => x / total);
  }

  /**
   * Keep anchors while the music keeps giving them weight; retire one only
   * after it has starved for several decisions, and only if the new top
   * combination is not already an anchor. New anchors enter the blend at
   * whatever weight the plan gives them, so the sidecar glides them in.
   */
  #reanchor(plan: VisualPlan, candidates: VisualPlan[], ctx: TrackContext): void {
    const weights = this.#weights(plan);
    this.#anchors.forEach((a, i) => { a.starved = weights[i]! < this.retireBelow ? a.starved + 1 : 0; });
    const topLabels = labelsOf(plan);
    const known = this.#anchors.some((a) => AXES.every((axis) => a.labels[axis] === topLabels[axis]));
    if (known) return;
    const starved = this.#anchors.findIndex((a) => a.starved >= this.retireAfter);
    if (this.#anchors.length < this.maxAnchors) this.#anchors.push(this.#anchor(candidates[0]!, ctx));
    else if (starved >= 0) this.#anchors[starved] = this.#anchor(candidates[0]!, ctx);
  }
}
