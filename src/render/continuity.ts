/**
 * Reduce reliance on a stale painted frame without cutting to the procedural
 * layer. Normal sidecar cadence is untouched; during a long GPU/network stall
 * the 60 Hz substrate gradually becomes visible again.
 */
export function continuityPaint(base: number, ageMs: number, expectedIntervalMs: number): number {
  const graceMs = Math.max(180, expectedIntervalMs * 1.8);
  const fade = Math.min(Math.max((ageMs - graceMs) / 600, 0), 1);
  return Math.min(Math.max(base * (1 - fade * 0.75), 0), 1);
}
