import type { WorldState } from './model';
import type { ConditioningPacket } from './conditioning';

export interface ImageSubstrate {
  kind: 'image' | 'latent' | 'mask';
  source: string;
  width: number;
  height: number;
  data: ImageBitmap | Float32Array | Uint8Array;
  /** Sidecar evidence: whether this material descended from the prior image. */
  continuity?: 'initial' | 'img2img';
}

export interface SubstrateConditioning {
  strength: number;
  mode: 'blend' | 'replace';
}

/** Sparse learned material provider. It is never called from the frame loop. */
export interface ImageSubstrateProvider { readonly name: string; readonly configured: boolean; generate(world: WorldState, conditioning?: ConditioningPacket): Promise<ImageSubstrate | null>; }

export class DisabledSubstrateProvider implements ImageSubstrateProvider {
  readonly name = 'disabled';
  readonly configured = false;
  async generate(_world: WorldState, _conditioning?: ConditioningPacket): Promise<ImageSubstrate | null> { return null; }
}

/**
 * Optional sparse image provider. It is deliberately network-shaped so the
 * renderer never imports Python, torch, or a diffusion runtime.
 */
export class SidecarSubstrateProvider implements ImageSubstrateProvider {
  readonly name = 'image-sidecar';
  readonly configured = true;

  constructor(private readonly endpoint = 'http://127.0.0.1:8766/v1/substrate') {}

  async generate(world: WorldState, conditioning?: ConditioningPacket): Promise<ImageSubstrate | null> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ world, conditioning }),
    });
    if (!response.ok) throw new Error(`substrate sidecar returned ${response.status}`);
    const result = await response.json() as { kind?: ImageSubstrate['kind']; source?: string; width?: number; height?: number; data?: string; continuity?: ImageSubstrate['continuity'] };
    if (!result.data || !result.width || !result.height) return null;
    return {
      kind: result.kind ?? 'image',
      source: result.source ?? this.endpoint,
      width: result.width,
      height: result.height,
      data: decodeBase64(result.data),
      continuity: result.continuity,
    };
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return data;
}
