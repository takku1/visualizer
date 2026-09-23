import type { TrackContext, WindowedFeatures } from '../director/director';
import type { VisualPlan } from '../types';
import type { WorldState } from './model';
import type { WorldMotion } from './motion';

export interface WorldDelta {
  schema: 1;
  sectionIndex: number;
  sectionLabel: string | null;
  boundary: boolean;
  reason: 'section' | 'interval' | 'fallback';
  semantics: WorldState['semantics'];
  planProjection: {
    motion: string;
    palette: string;
    texture: string;
    geometry: string;
    symmetry: string;
    feedback: string;
  };
  motion: WorldMotion;
  intensity: number;
}

/** Snapshot the section-scale semantic change without exposing shader uniforms. */
export function deltaFromDecision(
  plan: VisualPlan,
  features: WindowedFeatures,
  ctx: TrackContext,
  world: WorldState,
  motion: WorldMotion,
): WorldDelta {
  return {
    schema: 1,
    sectionIndex: features.sectionIndex,
    sectionLabel: ctx.sectionLabel ?? null,
    boundary: features.onSection,
    reason: features.onSection ? 'section' : plan.origin === 'offline' ? 'fallback' : 'interval',
    semantics: world.semantics,
    planProjection: {
      motion: plan.motion.top,
      palette: plan.palette.top,
      texture: plan.texture.top,
      geometry: plan.geometry.top,
      symmetry: plan.symmetry.top,
      feedback: plan.feedback.top,
    },
    motion,
    intensity: plan.intensity,
  };
}
