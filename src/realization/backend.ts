import type { SceneDiff, WorldState } from '../world/state';
import type { Shot } from '../world/shot';
import type { Look } from '../stream/scenes';

/** Renderer-neutral continuous pressure; semantic identity is intentionally absent. */
export interface ContinuousForces {
  bass: number;
  treble: number;
  energy: number;
  flux: number;
  beatImpulse: number;
  huePressure: number;
  motionMagnitude: number;
}

/** The director's structured request before backend-specific compilation. */
export interface RealizationRequest {
  world: WorldState;
  shot: Shot;
  diff: SceneDiff;
  continuousForces: ContinuousForces;
  legacy: {
    prompt: string;
    look: Look;
    seed: number;
    continuity: number;
    spliceFrames: number;
  };
}

export interface RealizationReceipt {
  requestId: string;
  backend: string;
  acceptedAt: number;
}

export interface RealizationTelemetry {
  backend: string;
  fps: number;
  latencyMs: number;
  identityConfidence: number | null;
  actionConfidence: number | null;
}

/** Small backend seam: structured state in, pixels/telemetry out. */
export interface RealizationBackend {
  commit(request: RealizationRequest): RealizationReceipt;
  applyForces(forces: ContinuousForces): void;
  observe(): RealizationTelemetry;
}
