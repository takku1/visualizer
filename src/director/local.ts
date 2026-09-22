import type { DecisionEngine } from './engine';
import type { SystemOneRequest, SystemOneResponse, Answer, Question, ChoiceQuestion } from './jev';

/**
 * A System One model that runs in-process.
 *
 * Jev is a hosted, waitlisted model, so this is the engine that actually runs
 * today. It is not a placeholder: it implements the same contract - closed
 * enumerations in, typed answers with a calibrated distribution out - using a
 * scoring function instead of learned weights.
 *
 * How it decides: each label in a family carries an ideal audio profile. We
 * measure the current audio against every profile, turn the distances into
 * utilities, and softmax them. Two labels that fit the music about equally
 * well come back at about 50/50, which is exactly what the blending renderer
 * needs and what a one-hot heuristic could never give it.
 *
 * What it is not: learned or empirically calibrated. The probabilities are
 * well-formed and behave sensibly, but nothing has fit them against outcomes,
 * because "the right visual for this music" has no ground truth to fit to.
 * Treat them as principled preferences, not measured frequencies.
 */
export class LocalSystemOne implements DecisionEngine {
  readonly name = 'local';
  readonly configured = true;

  /** Softmax temperature. Lower is more decisive, higher blends more. */
  #temperature: number;
  /** Utility bonus for whatever is already on screen, to resist thrashing. */
  #hysteresis: number;

  constructor(opts: { temperature?: number; hysteresis?: number } = {}) {
    this.#temperature = opts.temperature ?? 0.08;
    // Must stay small relative to the temperature. These combine as
    // exp(bonus / T), so 0.3 at T=0.055 is a 233x thumb on the scale and the
    // current look wins regardless of the audio. At 0.03 it is a ~1.5x nudge:
    // enough to break ties and stop thrashing, not enough to ignore evidence.
    this.#hysteresis = opts.hysteresis ?? 0.03;
  }

  async ask(req: SystemOneRequest): Promise<SystemOneResponse> {
    const s = readState(req.state);
    const answers: Record<string, Answer> = {};

    for (const [id, q] of Object.entries(req.questions)) {
      answers[id] = this.#answer(id, q, s);
    }

    return { model: 'local-systemone-0.1', answers, usage: { input_tokens: 0, output_tokens: 0 } };
  }

  #answer(id: string, q: Question, s: AudioState): Answer {
    if (q.type === 'score') {
      // Intensity tracks perceived energy across the score's level count.
      const levels = q.criteria.length;
      const raw = clamp01(s.energy * 0.75 + s.percussive * 0.25) * (levels - 1);
      return { type: 'score', score: round2(raw), confidence: 0.6 + 0.3 * s.evidence };
    }

    if (q.type === 'noul') {
      // A hard cut is earned by a sharp change, not by the clock.
      const p = clamp01(s.onsetDensity * 0.7 + Math.max(0, s.energy - 0.65) * 0.9);
      return { type: 'noul', noul: round2(p), probabilities: { true: round2(p), false: round2(1 - p) }, confidence: 0.55 };
    }

    return this.#choose(id, q, s);
  }

  #choose(id: string, q: ChoiceQuestion, s: AudioState): Answer {
    const profiles = PROFILES[id];
    const labels = Object.keys(q.criteria);

    // An unfamiliar question still gets a valid, honestly uninformative answer.
    if (!profiles) {
      const p = Object.fromEntries(labels.map((l) => [l, round2(1 / labels.length)]));
      return { type: 'choice', choice: labels[0] ?? '', probabilities: p, confidence: 0 };
    }

    const utilities = new Map<string, number>();
    for (const label of labels) {
      const prof = profiles[label];
      if (!prof) continue;

      // Negative squared distance in profile space, per-axis weighted.
      let d = 0;
      d += sq(prof.energy - s.energy) * 1.0;
      d += sq(prof.brightness - s.brightness) * 0.8;
      d += sq(prof.percussive - s.percussive) * 0.9;
      let u = -d;

      if (prof.modeBias != null && s.mode != null) u += prof.modeBias * (s.mode === 'major' ? 1 : -1) * 0.06;
      if (label === s.current[id]) u += this.#hysteresis * sq(1 - s.change);

      // A small, deterministic per-section offset so repeat listens are not
      // frame-identical while staying reproducible for the same input.
      u += (hash(`${id}:${label}:${s.sectionIndex}`) - 0.5) * 0.02;

      utilities.set(label, u);
    }

    if (utilities.size === 0) {
      const p = Object.fromEntries(labels.map((l) => [l, round2(1 / labels.length)]));
      return { type: 'choice', choice: labels[0] ?? '', probabilities: p, confidence: 0 };
    }

    const probs = softmax(utilities, this.#temperature);

    let top = '';
    let best = -Infinity;
    const out: Record<string, number> = {};
    for (const [label, p] of probs) {
      // Drop negligible tails; the renderer renormalizes what is left.
      if (p >= 0.02) out[label] = round2(p);
      if (p > best) {
        best = p;
        top = label;
      }
    }

    return { type: 'choice', choice: top, probabilities: out, confidence: round2(best * (0.6 + 0.4 * s.evidence)) };
  }
}

interface Profile {
  energy: number;
  brightness: number;
  percussive: number;
  /** Positive leans major, negative leans minor. */
  modeBias?: number;
}

/**
 * Where each label sits in profile space.
 *
 * These are the tuning knobs. Editing a number here changes when a look gets
 * chosen, and it is the one place to look when the visualizer reaches for the
 * wrong thing.
 */
const PROFILES: Record<string, Record<string, Profile>> = {
  motion: {
    drift: { energy: 0.12, brightness: 0.35, percussive: 0.1 },
    orbit: { energy: 0.38, brightness: 0.45, percussive: 0.3 },
    pulse: { energy: 0.6, brightness: 0.35, percussive: 0.8 },
    shear: { energy: 0.55, brightness: 0.55, percussive: 0.45 },
    turbulent: { energy: 0.88, brightness: 0.78, percussive: 0.85 },
    collapse: { energy: 0.45, brightness: 0.28, percussive: 0.35, modeBias: -1 },
    bloom: { energy: 0.76, brightness: 0.62, percussive: 0.55, modeBias: 1 },
    lattice: { energy: 0.62, brightness: 0.68, percussive: 0.75 },
  },
  palette: {
    ember: { energy: 0.5, brightness: 0.22, percussive: 0.4, modeBias: -1 },
    sodium: { energy: 0.3, brightness: 0.32, percussive: 0.3 },
    oxide: { energy: 0.45, brightness: 0.4, percussive: 0.45, modeBias: -1 },
    chlorophyll: { energy: 0.4, brightness: 0.48, percussive: 0.35, modeBias: 1 },
    ice: { energy: 0.35, brightness: 0.66, percussive: 0.3, modeBias: 1 },
    ultraviolet: { energy: 0.65, brightness: 0.72, percussive: 0.6, modeBias: -1 },
    monochrome: { energy: 0.55, brightness: 0.5, percussive: 0.7 },
    spectral: { energy: 0.85, brightness: 0.85, percussive: 0.65, modeBias: 1 },
  },
  texture: {
    // Texture keys off percussiveness and brightness far more than loudness:
    // it is about the grain of the sound, not how much of it there is.
    filament: { energy: 0.4, brightness: 0.55, percussive: 0.35 },
    plasma: { energy: 0.22, brightness: 0.35, percussive: 0.1 },
    grain: { energy: 0.7, brightness: 0.85, percussive: 0.7 },
    cellular: { energy: 0.45, brightness: 0.4, percussive: 0.3, modeBias: 1 },
    strata: { energy: 0.5, brightness: 0.5, percussive: 0.5 },
    shards: { energy: 0.8, brightness: 0.7, percussive: 0.9 },
  },
  geometry: {
    // Biased toward 'none' overall (most sections should not have an accent
    // layer fighting for attention) by giving it a wide, central profile that
    // wins by default; the three shapes only pull ahead for their own niches.
    none: { energy: 0.5, brightness: 0.5, percussive: 0.4 },
    circles: { energy: 0.3, brightness: 0.55, percussive: 0.2, modeBias: 1 },
    hexagons: { energy: 0.55, brightness: 0.5, percussive: 0.55 },
    stars: { energy: 0.75, brightness: 0.75, percussive: 0.6, modeBias: 1 },
  },
  symmetry: {
    none: { energy: 0.85, brightness: 0.6, percussive: 0.7 },
    mirror: { energy: 0.7, brightness: 0.55, percussive: 0.55 },
    kaleido3: { energy: 0.5, brightness: 0.5, percussive: 0.45 },
    kaleido6: { energy: 0.35, brightness: 0.5, percussive: 0.35 },
    kaleido12: { energy: 0.2, brightness: 0.45, percussive: 0.25 },
    polar: { energy: 0.45, brightness: 0.6, percussive: 0.5 },
  },
  feedback: {
    none: { energy: 0.6, brightness: 0.7, percussive: 0.9 },
    trail: { energy: 0.55, brightness: 0.55, percussive: 0.6 },
    zoom_in: { energy: 0.6, brightness: 0.5, percussive: 0.45 },
    zoom_out: { energy: 0.4, brightness: 0.45, percussive: 0.4 },
    swirl: { energy: 0.45, brightness: 0.5, percussive: 0.3 },
    smear: { energy: 0.3, brightness: 0.4, percussive: 0.12 },
  },
};

interface AudioState {
  energy: number;
  brightness: number;
  percussive: number;
  onsetDensity: number;
  /** How much the music has changed since the last decision, 0..1. */
  change: number;
  /** How much to trust any of this, 0..1. */
  evidence: number;
  mode: 'major' | 'minor' | null;
  sectionIndex: number;
  current: Record<string, string | undefined>;
}

/**
 * Collapse the director's state payload into the three axes the profiles use.
 *
 * Reads defensively: the same function has to cope with a full frame from the
 * extension and a partial one from the dev harness.
 */
function readState(raw: unknown): AudioState {
  const s = (raw ?? {}) as Record<string, any>;
  const a = (s['audio'] ?? {}) as Record<string, number>;
  const cur = (s['current_visuals'] ?? {}) as Record<string, string>;

  const level = num(a['level']);
  const bass = num(a['bass']);
  const lowMid = num(a['low_mid']);
  const mid = num(a['mid']);
  const highMid = num(a['high_mid']);
  const treble = num(a['treble']);
  const onset = num(a['onset_density']);

  // Brightness is the spectral centroid in miniature: where the energy sits.
  const total = bass + lowMid + mid + highMid + treble || 1;
  const brightness = clamp01((lowMid * 0.25 + mid * 0.5 + highMid * 0.8 + treble * 1.0) / total);

  return {
    energy: clamp01(level * 0.7 + (bass + mid + treble) / 3 * 0.3),
    brightness,
    percussive: clamp01(onset * 0.65 + bass * 0.35),
    onsetDensity: onset,
    change: clamp01(onset),
    evidence: a['structure_known'] ? 1 : 0.5,
    mode: (s['track']?.mode as 'major' | 'minor' | undefined) ?? null,
    sectionIndex: Number(s['section']?.index ?? 0),
    current: cur,
  };
}

function softmax(utilities: Map<string, number>, temperature: number): Map<string, number> {
  const t = Math.max(temperature, 1e-4);
  let max = -Infinity;
  for (const u of utilities.values()) max = Math.max(max, u);

  let sum = 0;
  const exps = new Map<string, number>();
  for (const [k, u] of utilities) {
    const e = Math.exp((u - max) / t);
    exps.set(k, e);
    sum += e;
  }

  const out = new Map<string, number>();
  for (const [k, e] of exps) out.set(k, e / sum);
  return out;
}

/** Deterministic hash to a 0..1 float, for reproducible jitter. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sq = (n: number): number => n * n;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;
