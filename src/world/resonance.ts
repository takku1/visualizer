import type { ContinuousForces } from '../realization/backend';
import type { WorldState } from './state';

/**
 * Fast physical response derived from an already-existing world. It contains
 * no semantic creation/removal operation: resonance can intensify a rain
 * field, move a camera, or pulse light, but it cannot invent an entity.
 */
export interface WorldResonance {
  motion: number;
  cameraImpulse: number;
  lightPulse: number;
  weatherIntensity: number | null;
  entityMotion: Record<string, number>;
}

export function resonanceFrom(world: WorldState, forces: ContinuousForces): WorldResonance {
  const motion = clamp(0.55 * forces.motionMagnitude + 0.3 * forces.energy + 0.15 * forces.beatImpulse);
  const weather = world.environment.some((item) => /rain|snow|wind|雨|雪|風/iu.test(item))
    ? clamp(0.45 * forces.energy + 0.35 * forces.beatImpulse + 0.2 * forces.flux)
    : null;
  const entityMotion: Record<string, number> = {};
  for (const entity of world.entities) {
    entityMotion[entity.id] = /walk|run|move|歩|走/iu.test(world.action) ? motion : 0;
  }
  return {
    motion,
    cameraImpulse: world.camera === 'abstain' ? 0 : clamp(0.5 * motion + 0.5 * forces.beatImpulse),
    lightPulse: clamp(0.45 * forces.treble + 0.35 * forces.huePressure + 0.2 * forces.beatImpulse),
    weatherIntensity: weather,
    entityMotion,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
