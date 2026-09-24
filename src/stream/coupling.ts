import type { SamplerControl } from './control';

export interface CouplingObservation {
  /** Normalized musical energy, 0..1. */
  energy: number;
  change?: number;
  jitter?: number;
  drift?: number;
}

/**
 * Conservative mechanical feedback from renderer telemetry into sampler
 * physics. It never chooses content and all gains are bounded near one.
 */
export class CouplingController {
  #strength = 1;
  #noise = 1;
  #feedback = 1;

  apply(control: SamplerControl, obs: CouplingObservation | null, dt: number): SamplerControl {
    if (!obs) return control;
    const change = obs.change ?? 0.12;
    const jitter = obs.jitter ?? 0.15;
    const drift = obs.drift ?? 0;
    const energeticStall = obs.energy > 0.55 && change < 0.08;
    const unstable = jitter > 0.35;
    const drifting = drift > 1.0;
    const targetStrength = energeticStall ? 1.08 : unstable ? 0.94 : drifting ? 0.97 : 1;
    const targetNoise = unstable ? 0.82 : energeticStall ? 1.04 : 1;
    // Lower feedback gives the fresh procedural frame more authority.
    const targetFeedback = drifting ? 0.88 : unstable ? 0.94 : 1;
    const k = Math.min(1, Math.max(0, dt * 2));
    this.#strength += (targetStrength - this.#strength) * k;
    this.#noise += (targetNoise - this.#noise) * k;
    this.#feedback += (targetFeedback - this.#feedback) * k;
    return {
      ...control,
      strength: clamp(control.strength * this.#strength, 0.2, 0.6),
      noise: clamp(control.noise * this.#noise, 0, 0.4),
      feedback: clamp(control.feedback * this.#feedback, 0.05, 0.25),
    };
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
