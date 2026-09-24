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

/**
 * Cheap, backend-neutral semantic conditioning for the current UNet adapter.
 * These are perceptual directions, not object labels: the sidecar can apply
 * them in its learned bottleneck space without pretending it has identity
 * correspondence or a depth map.
 */
export interface StructuredConditioning {
  version: 'structured-world-v2';
  hspace: { energy: number; light: number; organic: number };
  preservedEntityCount: number;
  transition: 'preserve' | 'evolve' | 'replace';
}

/** The director's structured request before backend-specific compilation. */
export interface RealizationRequest {
  world: WorldState;
  shot: Shot;
  diff: SceneDiff;
  continuousForces: ContinuousForces;
  resonance: WorldResonance;
  conditioning: StructuredConditioning;
  legacy: {
    prompt: string;
    look: Look;
    seed: number;
    continuity: number;
    spliceFrames: number;
  };
}

export function structuredConditioningFrom(world: WorldState, diff: SceneDiff): StructuredConditioning {
  const intent = world.intent;
  const words = [
    ...intent.form, ...intent.behavior, ...intent.motion, ...intent.lighting, ...intent.tension,
  ].join(' ').toLowerCase();
  const score = (positive: RegExp, negative: RegExp): number => clampSigned(
    (positive.test(words) ? 0.65 : 0) - (negative.test(words) ? 0.65 : 0),
  );
  const organic = clampSigned(2 * world.visualIdentity.look.organic - 1
    + (/(organic|soft|fluid|living|fibrous)/u.test(words) ? 0.25 : 0)
    - (/(structured|angular|architectural|mineral|rigid)/u.test(words) ? 0.25 : 0));
  const light = clampSigned(
    2 * world.visualIdentity.lighting.keyIntensity - 1
      + (world.visualIdentity.lighting.warmth - 0.5) * 0.25,
  );
  return {
    version: 'structured-world-v2',
    hspace: {
      energy: score(/expanding|explosive|urgent|accelerating|pulsing|high-energy/u, /restrained|suspended|still|quiet/u),
      light,
      organic,
    },
    preservedEntityCount: diff.keep.length,
    transition: diff.identityBreak ? 'replace' : diff.keep.length || diff.add.length || diff.remove.length ? 'evolve' : 'preserve',
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

function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
}
