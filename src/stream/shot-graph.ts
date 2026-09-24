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

export function addShotCandidate(graph: ShotGraph, id: string, scene: Scene, durationSec: number, weight = 1): ShotGraph {
  if (graph.nodes.some((node) => node.id === id)) throw new Error(`duplicate shot id: ${id}`);
  const from = graph.nodes[graph.nodes.length - 1];
  return {
    nodes: [...graph.nodes, { id, scene, durationSec: Math.max(0.1, durationSec) }],
    edges: [...graph.edges, {
      from: from?.id ?? 'current', to: id,
      transition: scene.continuityContract.transition,
      weight: Math.max(0, weight), prefetch: true,
    }],
  };
}

export function nextShots(graph: ShotGraph, from = 'current'): ShotEdge[] {
  return graph.edges.filter((edge) => edge.from === from).sort((a, b) => b.weight - a.weight);
}
