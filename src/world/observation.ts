/** Anonymous visual forms observed by a realization backend. A handle is a
 * correspondence claim, not a semantic identity claim. */
export interface EmergentObservation {
  handle: string;
  descriptors: string[];
  confidence: number;
  visible: boolean;
}

export type EmergentLifecycle = 'new' | 'persistent' | 'occluded' | 'fading';

export interface EmergentWorldHypothesis {
  handle: string;
  descriptors: string[];
  confidence: number;
  lifecycle: EmergentLifecycle;
  seenFrames: number;
  missedFrames: number;
}

export interface EmergentWorldState {
  revision: number;
  hypotheses: EmergentWorldHypothesis[];
}

export const EMPTY_EMERGENT_WORLD: EmergentWorldState = { revision: 0, hypotheses: [] };

/**
 * Apply an observation batch without inventing correspondences. Backends must
 * provide the handle; absent observations cause bounded occlusion/fade rather
 * than silently attaching a new form to an old one.
 */
export function applyEmergentObservations(
  previous: EmergentWorldState,
  observations: readonly EmergentObservation[],
  revision = previous.revision + 1,
): EmergentWorldState {
  const observed = new Map(observations.filter((item) => item.visible).map((item) => [item.handle, item]));
  const prior = new Map(previous.hypotheses.map((item) => [item.handle, item]));
  const next: EmergentWorldHypothesis[] = [];
  for (const observation of observed.values()) {
    const old = prior.get(observation.handle);
    next.push({
      handle: observation.handle,
      descriptors: [...observation.descriptors],
      confidence: clamp(observation.confidence),
      lifecycle: old ? 'persistent' : 'new',
      seenFrames: (old?.seenFrames ?? 0) + 1,
      missedFrames: 0,
    });
  }
  for (const old of previous.hypotheses) {
    if (observed.has(old.handle)) continue;
    const missedFrames = old.missedFrames + 1;
    if (missedFrames > 3) continue;
    next.push({
      ...old,
      descriptors: [...old.descriptors],
      lifecycle: missedFrames === 1 ? 'occluded' : 'fading',
      missedFrames,
    });
  }
  return { revision, hypotheses: next };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
