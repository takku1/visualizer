/** Back off source capture after a GPU/JPEG spike, without blocking display. */
export function captureBackoffMs(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 100) return 0;
  return Math.min(5000, Math.max(500, elapsedMs * 2));
}
