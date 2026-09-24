import type { ContinuityContract, Scene } from '../stream/scenes';

export type ShotTransition = 'glide' | 'cut' | 'hold' | 'reveal' | 'dissolve';

/** Presentation intent: how to look at a world, not what exists in it. */
export interface Shot {
  id: string;
  worldRevision: number | null;
  grammar: string;
  framing: string;
  camera: string;
  transition: ShotTransition;
  durationSec: number;
  continuity: Pick<ContinuityContract, 'identity' | 'action' | 'environment' | 'camera' | 'confidence'>;
}

/** Stable compatibility projection until all callers consume Shot directly. */
export function shotFromScene(scene: Scene, id: string, durationSec = 8): Shot {
  const semantic = scene.semantic;
  return {
    id,
    worldRevision: semantic?.meaningRevision ?? null,
    grammar: semantic?.shot ?? 'establish',
    framing: semantic?.camera ?? scene.continuityContract.camera,
    camera: semantic?.camera ?? scene.continuityContract.camera,
    transition: semantic?.transition ?? scene.continuityContract.transition,
    durationSec: Math.max(0.1, durationSec),
    continuity: {
      identity: scene.continuityContract.identity,
      action: scene.continuityContract.action,
      environment: scene.continuityContract.environment,
      camera: scene.continuityContract.camera,
      confidence: scene.continuityContract.confidence,
    },
  };
}
