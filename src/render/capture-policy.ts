/** Back off source capture after a GPU/JPEG spike, without blocking display. */
export function captureBackoffMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 100) return 0;
  return Math.min(5000, Math.max(500, elapsedMs * 2));
}

/**
 * Repeated multi-hundred-millisecond captures are a shared-GPU failure mode,
 * not useful source frames. After the first severe stall we give the encoder
 * a long recovery window; after the second, stop retrying for this track and
 * let the persistent sidecar/procedural world continue without new JPEGs.
 */
export function severeCapturePolicy(severeStalls: number): { pauseMs: number; disableForTrack: boolean } {
  if (severeStalls >= 2) return { pauseMs: 0, disableForTrack: true };
  return { pauseMs: 30_000, disableForTrack: false };
}
