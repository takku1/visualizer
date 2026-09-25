/**
 * The appearance layer is deliberately not the authoritative world.
 *
 * Procedural simulation owns motion, camera, timing, and cheap audio response.
 * A realization backend owns the slower learned appearance state.  Keeping
 * this contract here prevents the current JPEG bridge from becoming a hidden
 * requirement for every future backend (latent, video, or spatial).
 */

export type AppearanceSourceMode = 'observation' | 'transition' | 'disabled';

export interface AppearanceState {
  /** Backend-owned persistent representation; may be a latent or decoded frame. */
  latent: unknown | null;
  previousFrame: unknown | null;
  /** Cached conditioning, not a prompt that changes every frame. */
  anchorConditioning: unknown | null;
  targetConditioning: unknown | null;
  conditioningMix: number;
  ageFrames: number;
  confidence: number;
}

export interface AppearanceObservation {
  /** A source frame is an observation/retarget input, never world truth. */
  source: ArrayBuffer | null;
  mode: AppearanceSourceMode;
  timestampMs: number;
  reason: 'initial' | 'checkpoint' | 'retarget' | 'refresh' | 'disabled';
}

export interface AppearanceBackend {
  commitObservation(observation: AppearanceObservation): void;
  applyForces(forces: Readonly<Record<string, number>>): void;
  state(): AppearanceState;
}

/**
 * A conservative source policy for the current raster bridge.
 *
 * The default remains compatible with the current sidecar: it can refresh
 * while idle, but never competes with denoising/splicing.  Future latent
 * backends can select `disabled` for ordinary playback and request only
 * checkpoint/retarget observations without changing the world pipeline.
 */
export function appearanceSourceMode(input: {
  connected: boolean;
  sidecarPhase: 'idle' | 'denoising' | 'splicing' | 'waiting' | 'error' | null;
  captureDisabled: boolean;
  transitionPending: boolean;
}): AppearanceSourceMode {
  if (!input.connected || input.captureDisabled) return 'disabled';
  if (input.transitionPending) return 'transition';
  if (input.sidecarPhase === 'denoising' || input.sidecarPhase === 'splicing') return 'disabled';
  return 'observation';
}

