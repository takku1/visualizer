import type { Scene } from './scenes';
import { diffWorldState, type SceneDiff, type WorldState } from '../world/state';
import type { Shot } from '../world/shot';

/** A small, deterministic seam for future alternate-shot generation. */
export interface ShotNode {
  id: string;
  scene: Scene;
  /** Structured state is the graph's real subject; Scene is compatibility output. */
  world: WorldState;
  shot: Shot;
  worldDiff: SceneDiff | null;
  durationSec: number;
}

export interface ShotEdge {
  from: string;
  to: string;
  transition: 'glide' | 'cut';
  weight: number;
  prefetch: boolean;
  guard?: ShotGuard;
}

export interface ShotGuard {
  section?: number;
  minConfidence?: number;
  requiresDownbeat?: boolean;
}

export interface ShotSelectionContext {
  section: number;
  confidence: number;
  downbeat: boolean;
}

export interface ShotSelectionDiagnostic {
  status: 'selected' | 'waiting' | 'no-edge';
  current: string;
  selectedId: string | null;
  eligibleIds: string[];
  rejected: { id: string; reasons: string[] }[];
  context: ShotSelectionContext;
}

/** Match checkpoint timing: trusted grids select on bar wrap; fallback grids use beats. */
export function shotGraphBoundary(
  barPhase: number,
  previousBarPhase: number,
  onBeat: boolean,
  hasStructure: boolean,
  rhythmConfidence: number,
): { eligible: boolean; downbeat: boolean } {
  const downbeat = barPhase + 0.5 < previousBarPhase;
  const trustedGrid = hasStructure || rhythmConfidence > 0.5;
  return { downbeat, eligible: trustedGrid ? downbeat : onBeat };
}

export interface ShotGraph {
  nodes: ShotNode[];
  edges: ShotEdge[];
}

export function compileShotGraph(scene: Scene, durationSec = 8): ShotGraph {
  return {
    nodes: [{ id: 'current', scene, world: scene.world, shot: scene.shot, worldDiff: null, durationSec: Math.max(0.1, durationSec) }],
    edges: [],
  };
}

export function addShotCandidate(
  graph: ShotGraph,
  id: string,
  scene: Scene,
  durationSec: number,
  weight = 1,
  guard?: ShotGuard,
  fromId = 'current',
): ShotGraph {
  if (graph.nodes.some((node) => node.id === id)) throw new Error(`duplicate shot id: ${id}`);
  const from = graph.nodes.find((node) => node.id === fromId) ?? graph.nodes[0];
  return {
    nodes: [...graph.nodes, {
      id,
      scene,
      world: scene.world,
      shot: scene.shot,
      worldDiff: diffWorldState(from?.world ?? null, scene.world),
      durationSec: Math.max(0.1, durationSec),
    }],
    edges: [...graph.edges, {
      from: from?.id ?? 'current', to: id,
      transition: scene.continuityContract.transition,
      weight: Math.max(0, weight), prefetch: true, guard,
    }],
  };
}

export function nextShots(graph: ShotGraph, from = 'current'): ShotEdge[] {
  return graph.edges.filter((edge) => edge.from === from).sort((a, b) => b.weight - a.weight);
}

/** Runtime-only graph state: selection and cancellation stay outside rendering. */
export class ShotGraphRuntime {
  #graph: ShotGraph;
  #current = 'current';
  #epoch = 0;
  #lastSelection: ShotSelectionDiagnostic | null = null;

  constructor(graph: ShotGraph) {
    this.#graph = graph;
  }

  get epoch(): number {
    return this.#epoch;
  }

  get lastSelection(): ShotSelectionDiagnostic | null {
    return this.#lastSelection;
  }

  prefetchCandidates(): ShotNode[] {
    const nodes = new Map(this.#graph.nodes.map((node) => [node.id, node]));
    return nextShots(this.#graph, this.#current)
      .filter((edge) => edge.prefetch)
      .map((edge) => nodes.get(edge.to))
      .filter((node): node is ShotNode => Boolean(node));
  }

  choose(context: ShotSelectionContext): ShotNode | null {
    const nodes = new Map(this.#graph.nodes.map((node) => [node.id, node]));
    const current = this.#current;
    const edges = nextShots(this.#graph, current);
    const rejected = edges.map((edge) => ({ id: edge.to, reasons: guardReasons(edge, context) }))
      .filter((item) => item.reasons.length > 0);
    const eligibleIds = edges.filter((edge) => guardReasons(edge, context).length === 0).map((edge) => edge.to);
    const edge = edges.find((candidate) => guardReasons(candidate, context).length === 0);
    if (!edge) {
      this.#lastSelection = {
        status: edges.length ? 'waiting' : 'no-edge', current, selectedId: null,
        eligibleIds, rejected, context: { ...context },
      };
      return null;
    }
    this.#current = edge.to;
    this.#lastSelection = {
      status: 'selected', current, selectedId: edge.to,
      eligibleIds, rejected, context: { ...context },
    };
    return nodes.get(edge.to) ?? null;
  }

  cancel(): number {
    this.#epoch++;
    return this.#epoch;
  }
}

function guardReasons(edge: ShotEdge, context: ShotSelectionContext): string[] {
  const guard = edge.guard;
  const reasons: string[] = [];
  if (guard?.section != null && guard.section !== context.section) reasons.push('section');
  if (guard?.minConfidence != null && context.confidence < guard.minConfidence) reasons.push('confidence');
  if (guard?.requiresDownbeat && !context.downbeat) reasons.push('downbeat');
  return reasons;
}
