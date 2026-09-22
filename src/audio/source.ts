import type { FeatureFrame } from '../types';

/** Number of spectrum bins handed to the GPU. Half the FFT size. */
export const BINS = 1024;

/**
 * A source of audio features.
 *
 * Two implementations exist and they are not interchangeable: loopback gives a
 * real spectrum but knows nothing about the music, analysis gives musical
 * structure but no spectrum. The bus runs both and merges what it gets.
 */
export interface AudioSource {
  readonly name: string;
  /** False until the source has produced usable data. */
  readonly ready: boolean;
  start(): Promise<void>;
  stop(): void;
  /** Write this source's contribution into the frame. */
  sample(frame: FeatureFrame, now: number): void;
}

/** One-pole smoothing. `tau` is the time constant in seconds. */
export function smooth(prev: number, next: number, dt: number, tau: number): number {
  if (tau <= 0) return next;
  const k = 1 - Math.exp(-dt / tau);
  return prev + (next - prev) * k;
}

/**
 * Tracks a running maximum that decays, so a band's output uses the full 0..1
 * range regardless of how loud the source is.
 *
 * Without this, quiet tracks render as a flat, dead image and loud ones clip
 * to white. The decay lets it re-normalize when the music changes.
 */
export class AutoGain {
  #peak: number;
  constructor(private readonly decayPerSec = 0.35, private readonly floor = 1e-4) {
    this.#peak = floor;
  }
  push(v: number, dt: number): number {
    this.#peak = Math.max(v, this.#peak * Math.exp(-this.decayPerSec * dt), this.floor);
    return Math.min(v / this.#peak, 1);
  }
}
