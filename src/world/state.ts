import type { Look, Scene } from '../stream/scenes';
import { colorStateFromLook, lightingStateFromLook, type ColorState, type LightingState } from './visual';
import { perceptualIntentFromScene, type PerceptualIntent } from './intent';
import { EMPTY_EMERGENT_WORLD, type EmergentWorldState } from './observation';

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
  intent: PerceptualIntent;
  emergent: EmergentWorldState;
  action: string;
  camera: string;
  visualIdentity: { look: Look; source: Scene['source']; color: ColorState; lighting: LightingState };
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
  state: Pick<WorldState, 'relation' | 'intent' | 'emergent' | 'visualIdentity' | 'time' | 'provenance'>;
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
    intent: perceptualIntentFromScene(scene),
    emergent: { revision: 0, hypotheses: [] },
    action: semantic?.action ?? 'abstain',
    camera: semantic?.camera ?? scene.continuityContract.camera,
    visualIdentity: {
      look: scene.look,
      source: scene.source,
      color: colorStateFromLook(scene.look),
      lighting: lightingStateFromLook(scene.look),
    },
    time: { section, positionSec },
    provenance: {
      meaningRevision: semantic?.meaningRevision ?? null,
      confidence: scene.continuityContract.confidence,
    },
  };
}

export function diffWorldState(previous: WorldState | null, next: WorldState): SceneDiff {
  const prior = previous ?? emptyWorld();
  // A freshly compiled director scene has no visual observation yet. Do not
  // erase an anonymous form memory at that semantic checkpoint; only a newer
  // backend observation revision may replace it.
  const emergent = next.emergent.revision > prior.emergent.revision ? next.emergent : prior.emergent;
  const oldById = new Map(prior.entities.map((entity) => [entity.id, entity]));
  const matchedPriorIds = new Set<string>();
  const keep: WorldEntity[] = [];
  const add: WorldEntity[] = [];
  for (const entity of next.entities) {
    if (oldById.has(entity.id)) {
      matchedPriorIds.add(entity.id);
      keep.push(entity);
      continue;
    }
    // Rolling ASR and semantic revisions can mint a new evidence id for the
    // same bounded cue. Preserve the existing world identity when kind/label
    // agree; an opaque evidence id must not turn a revision into a replacement.
    const priorMatch = prior.entities.find((candidate) =>
      !matchedPriorIds.has(candidate.id) && canonicalEntityKey(candidate) === canonicalEntityKey(entity));
    if (priorMatch) {
      matchedPriorIds.add(priorMatch.id);
      keep.push({ ...entity, id: priorMatch.id });
    } else {
      add.push(entity);
    }
  }
  const remove = prior.entities.filter((entity) => !matchedPriorIds.has(entity.id));
  const environmentAdded = next.environment.filter((item) => !prior.environment.includes(item));
  const environmentRemoved = prior.environment.filter((item) => !next.environment.includes(item));
  const identityBreak = add.length > 0 && remove.length > 0;
  return {
    keep, add, remove, environmentAdded, environmentRemoved,
    action: { from: previous?.action ?? null, to: next.action },
    camera: { from: previous?.camera ?? null, to: next.camera },
    state: {
      relation: next.relation,
      intent: cloneIntent(next.intent),
      emergent: cloneEmergent(emergent),
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
    intent: cloneIntent(diff.state.intent),
    emergent: cloneEmergent(diff.state.emergent),
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
    color: { ...identity.color },
    lighting: { ...identity.lighting },
  };
}

function emptyWorld(): WorldState {
  return {
    entities: [], environment: [], relation: null, emergent: { ...EMPTY_EMERGENT_WORLD, hypotheses: [] },
    intent: { form: ['neutral'], behavior: ['drifting'], spatiality: ['open'], materiality: ['unresolved'], motion: ['flowing'], lighting: ['ambient'], color: ['neutral'], tension: ['continuous'], affect: [], continuityPressure: 0, evidence: 'abstention', confidence: 0 },
    action: 'abstain', camera: 'abstain',
    visualIdentity: {
      look: { palette: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], organic: 0, warp: 0, fold: 0, seed: 0 },
      source: 'abstract-fallback',
      color: { dominantHue: 0, accentHue: 0, scheme: 'monochromatic', saturation: 0, contrast: 0, temperature: 0.5, luminance: 0, accentWeight: 0 },
      lighting: { keyIntensity: 0, fillIntensity: 0, shadowDensity: 1, warmth: 0.5, atmosphere: 0, direction: 'ambient' },
    },
    time: { section: 0, positionSec: 0 }, provenance: { meaningRevision: null, confidence: 0 },
  };
}

function cloneIntent(intent: PerceptualIntent): PerceptualIntent {
  return {
    ...intent,
    form: [...intent.form], behavior: [...intent.behavior], spatiality: [...intent.spatiality],
    materiality: [...intent.materiality], motion: [...intent.motion], lighting: [...intent.lighting],
    color: [...intent.color], tension: [...intent.tension], affect: [...intent.affect],
  };
}

function cloneEmergent(emergent: EmergentWorldState): EmergentWorldState {
  return {
    revision: emergent.revision,
    hypotheses: emergent.hypotheses.map((hypothesis) => ({ ...hypothesis, descriptors: [...hypothesis.descriptors] })),
  };
}

function stable(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

function canonicalEntityKey(entity: Pick<WorldEntity, 'kind' | 'label'>): string {
  return `${entity.kind}:${entity.label.trim().toLocaleLowerCase().replace(/\s+/gu, ' ')}`;
}
