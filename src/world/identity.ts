import type { TrackContext } from '../director/director';
import type { WorldState } from './model';

export interface WorldIdentity {
  schema: 1;
  trackKey: string | null;
  title: string | null;
  artist: string | null;
  artwork: TrackContext['artwork'] | null;
  seed: number | null;
  confidence: number;
}

/** Stable track-scale identity; metadata absence is explicit, never invented. */
export function identityFromContext(ctx: TrackContext, world?: WorldState): WorldIdentity {
  const title = clean(ctx.title);
  const artist = clean(ctx.artist);
  const trackKey = title || artist ? `${title ?? ''}\u0000${artist ?? ''}` : null;
  return {
    schema: 1,
    trackKey,
    title,
    artist,
    artwork: ctx.artwork ?? null,
    seed: trackKey ? world?.dynamics.seed ?? hashSeed(trackKey) : null,
    confidence: trackKey ? (title && artist ? 1 : 0.65) : 0,
  };
}

function clean(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 10000) / 10000;
}
