import type { FeatureFrame } from '../types';
import type { TrackContext } from '../director/director';
import type { WorldState } from './model';

/** Small, versioned payload shared by procedural and learned realizations. */
export interface ConditioningPacket {
  schema: 1;
  prompt: string;
  negativePrompt: string;
  semantic: WorldState;
  audio: { level: number; flux: number; bassFlux: number; spectralCentroid: number };
  lyrics?: string;
  transitionStrength: number;
}

/**
 * Compiles the rich live state into a stable model-facing representation.
 * This is intentionally not a renderer setting list: the sidecar may later
 * replace the prompt with cached embeddings or a learned conditioning adapter.
 */
export function buildConditioningPacket(
  world: WorldState,
  frame: FeatureFrame | null,
  context: TrackContext,
): ConditioningPacket {
  const s = world.semantics;
  const labels = [
    top(s.affect), top(s.form), top(s.space), top(s.behavior),
    top(s.coherence), top(s.persistence), top(s.abstraction),
  ];
  const prompt = [
    'one continuous coherent visual world',
    `${labels[0]} mood`, `${labels[1]} ${labels[2]} environment`,
    `${labels[3]} evolution`, `${labels[4]} composition`,
    `${labels[5]} visual memory`, `${labels[6]} imagery`,
    context.title && context.artist ? `visual identity of ${context.title} by ${context.artist}` : '',
    context.genres?.length ? `musical context: ${context.genres.slice(0, 3).join(', ')}` : '',
    'recurring motif, preserve the existing composition, cinematic concept art, layered atmosphere',
  ].filter(Boolean).join(', ');

  return {
    schema: 1,
    prompt,
    negativePrompt: 'text, letters, logo, frame, border, collage, split screen, unrelated objects, hard cut',
    semantic: world,
    audio: {
      level: frame?.level ?? 0,
      flux: frame?.flux ?? 0,
      bassFlux: frame?.bassFlux ?? 0,
      spectralCentroid: frame?.spectralCentroid ?? 0,
    },
    ...(context.lyrics ? { lyrics: context.lyrics.slice(0, 280) } : {}),
    // Low strength is the continuity control: semantic changes steer the
    // existing image instead of replacing the world with a new poster.
    transitionStrength: 0.22 + (1 - world.dynamics.memory) * 0.12,
  };
}

function top(values: Record<string, number>): string {
  return Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
}
