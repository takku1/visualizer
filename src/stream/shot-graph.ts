import type { Scene } from './scenes';

/** A small, deterministic seam for future alternate-shot generation. */
export interface ShotNode {
  id: string;
  scene: Scene;
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

export interface ShotGraph {
  nodes: ShotNode[];
  edges: ShotEdge[];
}

export function compileShotGraph(scene: Scene, durationSec = 8): ShotGraph {
  return {
    nodes: [{ id: 'current', scene, durationSec: Math.max(0.1, durationSec) }],
    edges: [],
  };
}

export function addShotCandidate(graph: ShotGraph, id: string, scene: Scene, durationSec: number, weight = 1, guard?: ShotGuard): ShotGraph {
  if (graph.nodes.some((node) => node.id === id)) throw new Error(`duplicate shot id: ${id}`);
  const from = graph.nodes[graph.nodes.length - 1];
  return {
    nodes: [...graph.nodes, { id, scene, durationSec: Math.max(0.1, durationSec) }],
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

  constructor(graph: ShotGraph) {
    this.#graph = graph;
  }

  get epoch(): number {
    return this.#epoch;
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
    const edge = nextShots(this.#graph, this.#current).find((candidate) => {
      const guard = candidate.guard;
      return (guard?.section == null || guard.section === context.section)
        && (guard?.minConfidence == null || context.confidence >= guard.minConfidence)
        && (!guard?.requiresDownbeat || context.downbeat);
    });
    if (!edge) return null;
    this.#current = edge.to;
    return nodes.get(edge.to) ?? null;
  }

  cancel(): number {
    this.#epoch++;
    return this.#epoch;
  }
}
