import { VisualizerApp, type TrackContext } from '../src/core';
import { CachedLyricsProvider, LrclibLyricsProvider, StorageLyricsCache } from '../src/director/lyrics';

/**
 * Standalone dev harness. Runs in a plain browser tab, or - unmodified - as
 * the renderer of the Electron shell in electron/main.cjs.
 *
 * Reloading a Spicetify extension means restarting the Spotify client, which
 * is far too slow to iterate on a shader. This runs the identical pipeline
 * with hot rebuilds, and captures any audio the machine is playing.
 */

declare global {
  interface Window {
    /** Present only inside the Electron shell, via electron/preload.cjs. */
    s1Log?: { append: (line: string) => void };
    /** Present only inside the Electron shell, via electron/preload.cjs. */
    s1Key?: { getKey: () => Promise<string | null> };
    /** Present only inside the Electron shell: Windows media session now-playing. */
    s1Media?: { subscribe: (callback: (info: MediaInfo) => void) => () => void };
  }
}

const params = new URLSearchParams(location.search);

// Lyrics lookup is off only when explicitly disabled. The provider is
// cached and runs outside the frame loop. Community results retain their
// provider/rights/confidence provenance; pass `lyrics=off` or
// `lyrics-rights=off` to disable their semantic promotion.
const lyricsMode = params.get('lyrics') ?? 'lrclib';
const lyricsRights = params.get('lyrics-rights') ?? 'community';

/** One line from scripts/media-session.ps1. */
interface MediaInfo {
  ok: boolean;
  app?: string;
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  /** Seconds, as of `lastUpdated`. */
  position?: number;
  duration?: number;
  /** Unix ms. */
  lastUpdated?: number;
}

let media: MediaInfo | null = null;

/**
 * Track metadata for the director and scene compiler. Position is
 * extrapolated between media-session updates while playing (players update
 * the timeline only every few seconds).
 */
function trackContext(): TrackContext {
  if (!media?.ok || !media.title) return {};
  const elapsed = media.playing && media.lastUpdated ? Math.max(0, (Date.now() - media.lastUpdated) / 1000) : 0;
  const position = Math.min((media.position ?? 0) + elapsed, media.duration || Infinity);
  return {
    trackId: `${media.artist ?? ''}|${media.title}`,
    title: media.title,
    artist: media.artist,
    album: media.album,
    durationSec: media.duration,
    position,
  };
}

/**
 * TypeSafe key precedence: `?key=` URL override first (handy for a quick
 * test, but it lands in history), then the Electron shell's key from the
 * environment or Windows Credential Manager, then nothing - which means the
 * built-in local engine drives everything.
 */
async function resolveApiKey(): Promise<string | undefined> {
  const fromUrl = params.get('key') ?? undefined;
  if (fromUrl) return fromUrl;
  try {
    return (await window.s1Key?.getKey()) ?? undefined;
  } catch {
    return undefined;
  }
}

function storedPaint(): string | null {
  try { return localStorage.getItem('s1:paint'); } catch { return null; }
}

async function main(): Promise<void> {
  const app: VisualizerApp = new VisualizerApp({
    apiKey: await resolveApiKey(),
    proxyUrl: params.get('proxy') ?? undefined,
    renderScale: Number(params.get('scale') ?? 1),
    // The stream sidecar is the product path; `?stream=off` runs the fallback
    // field alone, `?stream=ws://host:port` points elsewhere.
    streamUrl: params.get('stream') === 'off' ? undefined : params.get('stream') ?? 'ws://127.0.0.1:8771',
    meaningUrl: params.get('meaning') ?? undefined,
    meaningIntervalMs: Number(params.get('meaning-interval-ms') ?? 3000),
    lyricsProvider: lyricsMode !== 'off'
      ? new CachedLyricsProvider(new LrclibLyricsProvider(), new StorageLyricsCache(localStorage))
      : undefined,
    allowUnknownLyrics: lyricsRights === 'community',
    paint: Number(params.get('paint') ?? storedPaint() ?? 0.6),
    appearanceSource: params.get('appearance') === 'persistent' ? 'persistent' : 'raster',
    keyframes: params.get('keyframes') !== 'off',
    continuousLatentMode: params.get('continuous') !== 'off',
    direction: params.get('direction') === 'knobs' ? 'knobs' : 'splice',
    context: trackContext,
    status: (): string[] => ['', app.loopback.capturing ? 'capture   ok' : 'capture   off (no spectrum)'],
    // Real decision logging for the evaluation pass, when Electron's preload
    // has exposed a sink. Absent in a plain browser tab - nothing changes there.
    log: window.s1Log ? (line) => window.s1Log!.append(line) : undefined,
  });

  // A new track resets the per-track audio statistics and asks the director
  // for a decision now, rather than on the old track's leftover clock (the
  // Spicetify build does the same from its songchange event).
  window.s1Media?.subscribe((info) => {
    const before = trackContext().trackId;
    media = info;
    const after = trackContext().trackId;
    if (after && after !== before) {
      console.log(`[media] now playing: ${info.title}${info.artist ? ` - ${info.artist}` : ''} (${info.app ?? '?'})`);
      app.bus.resetTrackStats();
      if (app.running) void app.director.refresh(app.bus.frame, trackContext());
    }
  });

  // Electron is the supported runtime. Start immediately; audio capture is
  // best-effort and the world remains visible if permission is unavailable.
  await app.start();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') app.overlay.toggleHud();
    // Paint: how much of the procedural scene the diffusion stream paints over.
    if (e.key === '[' || e.key === ']') {
      app.paint += e.key === ']' ? 0.1 : -0.1;
      try { localStorage.setItem('s1:paint', String(app.paint)); } catch { /* private window */ }
    }
  });

  // Handy while tuning: __s1.app.director.refresh(...) forces a new decision.
  Object.defineProperty(globalThis, '__s1', { value: { app }, configurable: true });
}

void main();
