import type { TrackContext } from '../director/director';
import type { LyricCue, LyricSource } from './types';

/** Rights-aware lyrics boundary. The sidecar owns provider credentials and
 * returns normalized timed cues; the renderer never scrapes provider APIs. */
export class SidecarLyricSource implements LyricSource {
  readonly name = 'lyrics-sidecar';
  readonly configured = true;

  constructor(private readonly endpoint: string, private readonly timeoutMs = 4000) {}

  async load(track: TrackContext): Promise<LyricCue[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: track.title ?? null, artist: track.artist ?? null }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`lyrics sidecar returned ${response.status}`);
      const result = await response.json() as { cues?: LyricCue[] };
      return Array.isArray(result.cues) ? result.cues : [];
    } finally {
      clearTimeout(timer);
    }
  }
}
