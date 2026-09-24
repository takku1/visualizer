import type { SceneDiff, WorldState } from '../world/state';
import type { Shot } from '../world/shot';
import type { Look } from '../stream/scenes';
import type { FeatureFrame } from '../types';
import type { SamplerControl } from '../stream/control';
import { resonanceFrom, type WorldResonance } from '../world/resonance';
import { applyEmergentObservations, type EmergentObservation, type EmergentWorldState } from '../world/observation';

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
  resonance: WorldResonance;
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
  /** Optional anonymous correspondence output from a stateful visual observer. */
  emergentObservations?: readonly EmergentObservation[];
  /** Backend-owned monotonic observation revision, when observations are present. */
  observationRevision?: number;
}

/** Small backend seam: structured state in, pixels/telemetry out. */
export interface RealizationBackend {
  commit(request: RealizationRequest): RealizationReceipt;
  applyForces(forces: ContinuousForces): void;
  observe(): RealizationTelemetry;
}

/** Map live perception into bounded physical pressure, never semantic content. */
export function continuousForcesFrom(frame: FeatureFrame, control: SamplerControl): ContinuousForces {
  return {
    bass: clamp(frame.bass),
    treble: clamp(Math.max(frame.treble, frame.trebleFlux)),
    energy: clamp(frame.level),
    flux: clamp(frame.flux),
    beatImpulse: clamp(frame.onBeat ? Math.max(frame.bassFlux, 0.5) : frame.bassFlux),
    huePressure: clamp(Math.abs(control.hue) / Math.PI),
    motionMagnitude: clamp((Math.abs(control.zoom) / 2 + Math.abs(control.rotate) / 4 + Math.abs(control.flow)) / 3),
  };
}

/**
 * Apply only explicit backend correspondences to emergent memory.
 *
 * Confidence scores or prompt text alone are deliberately insufficient: a
 * backend must provide a stable handle for this function to preserve a form.
 * This keeps the current prompt-driven sidecar from claiming visual memory.
 */
export function emergentWorldFromTelemetry(
  previous: EmergentWorldState,
  telemetry: Pick<RealizationTelemetry, 'emergentObservations' | 'observationRevision'>,
): EmergentWorldState {
  if (!telemetry.emergentObservations) return previous;
  return applyEmergentObservations(
    previous,
    telemetry.emergentObservations,
    telemetry.observationRevision ?? previous.revision + 1,
  );
}

export { resonanceFrom };

export const ZERO_FORCES: ContinuousForces = {
  bass: 0, treble: 0, energy: 0, flux: 0, beatImpulse: 0, huePressure: 0, motionMagnitude: 0,
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
