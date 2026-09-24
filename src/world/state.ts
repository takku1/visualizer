import type { Look, Scene } from '../stream/scenes';

export interface WorldEntity {
  id: string;
  label: string;
  kind: string;
  attributes: string[];
  confidence: number;
}

export interface WorldState {
  entities: WorldEntity[];
  environment: string[];
  relation: string | null;
  action: string;
  camera: string;
  visualIdentity: { look: Look; source: Scene['source'] };
  time: { section: number; positionSec: number };
  provenance: { meaningRevision: number | null; confidence: number };
}

export interface SceneDiff {
  keep: WorldEntity[];
  add: WorldEntity[];
  remove: WorldEntity[];
  environmentAdded: string[];
  environmentRemoved: string[];
  action: { from: string | null; to: string };
  camera: { from: string | null; to: string };
  /** Non-entity state copied from the proposed next world at commit time. */
  state: Pick<WorldState, 'relation' | 'visualIdentity' | 'time' | 'provenance'>;
  identityBreak: boolean;
  requiresKeyframe: boolean;
}

export function worldStateFromScene(scene: Scene, section: number, positionSec = 0): WorldState {
  const semantic = scene.semantic;
  const entities = semantic?.subjects.map((label, index) => ({
    id: semantic.subjectIds[index] ?? `subject-${index}-${stable(label)}`,
    label,
    kind: 'subject',
    attributes: [],
    confidence: scene.continuityContract.confidence,
  })) ?? [];
  return {
    entities,
    environment: semantic?.environmentIds ?? semantic?.environment ?? [],
    relation: semantic?.relation ?? null,
    action: semantic?.action ?? 'abstain',
    camera: semantic?.camera ?? scene.continuityContract.camera,
    visualIdentity: { look: scene.look, source: scene.source },
    time: { section, positionSec },
    provenance: {
      meaningRevision: semantic?.meaningRevision ?? null,
      confidence: scene.continuityContract.confidence,
    },
  };
}

export function diffWorldState(previous: WorldState | null, next: WorldState): SceneDiff {
  const prior = previous ?? emptyWorld();
  const oldById = new Map(prior.entities.map((entity) => [entity.id, entity]));
  const newById = new Map(next.entities.map((entity) => [entity.id, entity]));
  const keep = next.entities.filter((entity) => oldById.has(entity.id));
  const add = next.entities.filter((entity) => !oldById.has(entity.id));
  const remove = prior.entities.filter((entity) => !newById.has(entity.id));
  const environmentAdded = next.environment.filter((item) => !prior.environment.includes(item));
  const environmentRemoved = prior.environment.filter((item) => !next.environment.includes(item));
  const identityBreak = add.length > 0 && remove.length > 0;
  return {
    keep, add, remove, environmentAdded, environmentRemoved,
    action: { from: previous?.action ?? null, to: next.action },
    camera: { from: previous?.camera ?? null, to: next.camera },
    state: {
      relation: next.relation,
      visualIdentity: cloneVisualIdentity(next.visualIdentity),
      time: { ...next.time },
      provenance: { ...next.provenance },
    },
    identityBreak,
    requiresKeyframe: identityBreak || previous?.visualIdentity.source !== next.visualIdentity.source,
  };
}

/**
 * Apply a world transition without mutating either input. This is the
 * authoritative continuity seam: renderers consume the resulting state, but
 * cannot silently replace entities by changing prompt text.
 */
export function applySceneDiff(previous: WorldState | null, diff: SceneDiff): WorldState {
  const prior = previous ?? emptyWorld();
  const entities = new Map(prior.entities.map((entity) => [entity.id, cloneEntity(entity)]));
  for (const entity of diff.remove) entities.delete(entity.id);
  for (const entity of diff.keep) entities.set(entity.id, cloneEntity(entity));
  for (const entity of diff.add) entities.set(entity.id, cloneEntity(entity));

  const environment = prior.environment.filter((item) => !diff.environmentRemoved.includes(item));
  for (const item of diff.environmentAdded) {
    if (!environment.includes(item)) environment.push(item);
  }

  return {
    entities: [...entities.values()],
    environment,
    relation: diff.state.relation,
    action: diff.action.to,
    camera: diff.camera.to,
    visualIdentity: cloneVisualIdentity(diff.state.visualIdentity),
    time: { ...diff.state.time },
    provenance: { ...diff.state.provenance },
  };
}

function cloneEntity(entity: WorldEntity): WorldEntity {
  return { ...entity, attributes: [...entity.attributes] };
}

function cloneVisualIdentity(identity: WorldState['visualIdentity']): WorldState['visualIdentity'] {
  return {
    source: identity.source,
    look: {
      ...identity.look,
      palette: identity.look.palette.map((rgb) => [...rgb] as [number, number, number]) as WorldState['visualIdentity']['look']['palette'],
    },
  };
}

function emptyWorld(): WorldState {
  return {
    entities: [], environment: [], relation: null, action: 'abstain', camera: 'abstain',
    visualIdentity: { look: { palette: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], organic: 0, warp: 0, fold: 0, seed: 0 }, source: 'abstract-fallback' },
    time: { section: 0, positionSec: 0 }, provenance: { meaningRevision: null, confidence: 0 },
  };
}

function stable(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
