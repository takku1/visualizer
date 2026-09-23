import type { WorldProjection } from './model';

export type PrimitiveKind = 'implicit_field' | 'sdf' | 'reaction_diffusion' | 'flow' | 'particles' | 'feedback' | 'symmetry' | 'color';

export interface ProgramNode { id: string; kind: PrimitiveKind; inputs: string[]; weight: number; }

/** Bounded, inspectable visual program; it is data, not arbitrary generated code. */
export interface WorldProgram { version: 1; nodes: ProgramNode[]; }

export function programForWorld(world: WorldProjection): WorldProgram {
  return {
    version: 1,
    nodes: [
      { id: 'field', kind: 'implicit_field', inputs: [], weight: 0.45 + world.suggestive * 0.55 },
      { id: 'flow', kind: 'flow', inputs: ['field'], weight: 0.35 + world.atmospheric * 0.65 },
      { id: 'rd', kind: 'reaction_diffusion', inputs: ['flow'], weight: 0.25 + world.organic * 0.75 },
      { id: 'sdf', kind: 'sdf', inputs: ['field'], weight: world.architectural },
      { id: 'particles', kind: 'particles', inputs: ['rd', 'sdf'], weight: 0.25 + world.impulse * 0.5 },
      { id: 'feedback', kind: 'feedback', inputs: ['rd', 'particles'], weight: world.persistent },
      { id: 'symmetry', kind: 'symmetry', inputs: ['field'], weight: world.structured },
      { id: 'color', kind: 'color', inputs: ['feedback'], weight: 1 },
    ],
  };
}
