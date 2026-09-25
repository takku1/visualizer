/** Back off source capture after a GPU/JPEG spike, without blocking display. */
export function captureBackoffMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 100) return 0;
  return Math.min(5000, Math.max(500, elapsedMs * 2));
}

/**
 * Multi-hundred-millisecond captures are a shared-GPU failure mode, not useful
 * source frames. One severe stall is enough to stop retrying for this track;
 * the procedural world and persistent sidecar must remain responsive.
 */
export function severeCapturePolicy(severeStalls: number): { pauseMs: number; disableForTrack: boolean } {
  if (severeStalls >= 1) return { pauseMs: 0, disableForTrack: true };
  return { pauseMs: 0, disableForTrack: false };
}
