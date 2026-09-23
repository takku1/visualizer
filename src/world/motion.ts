import type { WorldState } from './model';

export interface WorldMotion {
  fieldMode: 'drift' | 'breathing' | 'planar' | 'flow' | 'settle';
  drift: { x: number; y: number };
  rotation: number;
  radial: number;
  localWarp: number;
  breathing: number;
  settling: number;
  eventResponse: number;
  memory: number;
}

/** Pure bounded projection from semantic world state to motion policy. */
export function motionFromWorld(world: WorldState): WorldMotion {
  const form = world.semantics.form;
  const space = world.semantics.space;
  const behavior = world.semantics.behavior;
  const affect = world.semantics.affect;
  const persistence = world.semantics.persistence;
  const structured = score(world.semantics.coherence, 'structured');
  const organic = score(form, 'organic');
  const architectural = score(form, 'architectural');
  const turbulent = score(behavior, 'turbulent');
  const flowing = score(behavior, 'flowing');
  const growing = score(behavior, 'growing');
  const decaying = score(behavior, 'decaying');
  const ecstatic = score(affect, 'ecstatic');
  const stable = score(persistence, 'stable');
  const vast = score(space, 'vast');
  const fieldMode: WorldMotion['fieldMode'] = decaying > 0.52
    ? 'settle'
    : architectural > organic + 0.12 && structured > 0.42
      ? 'planar'
      : flowing > 0.38 && turbulent < 0.42
        ? 'flow'
        : growing > decaying + 0.12
          ? 'breathing'
          : 'drift';
  return {
    fieldMode,
    drift: {
      x: clamp((flowing - architectural * 0.45) * 0.16, -0.16, 0.16),
      y: clamp((organic - vast * 0.35) * 0.12, -0.12, 0.12),
    },
    rotation: clamp((turbulent * 0.08 + ecstatic * 0.025) * (1 - structured * 0.7), -0.08, 0.08),
    radial: clamp(growing * 0.5 - decaying * 0.32 + vast * 0.08, -0.32, 0.58),
    localWarp: clamp(turbulent * 0.62 + organic * 0.12, 0, 0.78),
    breathing: clamp(growing * 0.55 + stable * 0.08, 0, 0.68),
    settling: clamp(decaying * 0.72, 0, 0.8),
    eventResponse: clamp(0.18 + turbulent * 0.48 + ecstatic * 0.2 + world.dynamics.impulse * 0.3, 0, 1),
    memory: clamp(world.dynamics.memory * (0.55 + stable * 0.45), 0, 0.92),
  };
}

function score(values: Record<string, number>, key: string): number { return values[key] ?? 0; }
function clamp(value: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, value)); }
