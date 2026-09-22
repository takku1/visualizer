import { VisualizerApp } from './core';
import { AnalysisSource } from './audio/analysis';
import { analyzeArtwork, type ArtworkDNA } from './audio/artwork';
import type { TrackContext } from './director/director';

/**
 * Spicetify entry point.
 *
 * Spicetify loads this as a plain script into the Spotify client's renderer.
 * The globals it needs may not exist yet at that moment, so everything waits
 * on `ready()` before touching them.
 */

const SETTINGS_KEY = 's1visualizer:settings';

interface Settings {
  /** TypeSafe key, for the hosted Jev engine. Optional. */
  apiKey?: string;
  /** Local System One sidecar, e.g. a Laya server on http://127.0.0.1:8765. */
  proxyUrl?: string;
  renderScale?: number;
}

function loadSettings(): Settings {
  const raw = globalThis.Spicetify?.LocalStorage?.get(SETTINGS_KEY) ?? localStorage.getItem(SETTINGS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Settings;
  } catch {
    return {};
  }
}

function saveSettings(s: Settings): void {
  const raw = JSON.stringify(s);
  globalThis.Spicetify?.LocalStorage?.set(SETTINGS_KEY, raw);
  localStorage.setItem(SETTINGS_KEY, raw);
}

/** Resolve once the Spicetify globals this extension uses are present. */
async function ready(timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const sp = globalThis.Spicetify;
    if (sp?.Player?.data !== undefined && sp.showNotification) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main(): Promise<void> {
  if (!(await ready())) {
    console.warn('[s1-visualizer] Spicetify globals never arrived; not starting.');
    return;
  }

  const sp = globalThis.Spicetify!;
  const settings = loadSettings();
  const analysis = new AnalysisSource();

  // Album art loads asynchronously on song change and is cached here rather
  // than re-fetched every frame; `context()` just reads whatever landed last.
  let artwork: ArtworkDNA | null = null;
  let artworkUri: string | undefined;

  const context = (): TrackContext => {
    const item = sp.Player?.data?.item;
    const meta = item?.metadata;
    const pos = (sp.Player?.getProgress() ?? 0) / 1000;
    const info = analysis.info(pos);
    return {
      title: meta?.title,
      artist: meta?.artist_name,
      tempo: info.tempo,
      key: info.key,
      mode: info.mode,
      loudness: info.loudness,
      sectionLabel: info.sectionLabel,
      artwork: artwork ?? undefined,
    };
  };

  // Annotated because `status` closes over `app`, and TypeScript will not
  // infer a type that references itself.
  const app: VisualizerApp = new VisualizerApp({
    apiKey: settings.apiKey,
    proxyUrl: settings.proxyUrl,
    renderScale: settings.renderScale ?? 0.85,
    context,
    status: (): string[] => [
      '',
      analysis.ready
        ? 'analysis  ok'
        : analysis.unavailable
          ? 'analysis  unavailable (beat grid estimated)'
          : 'analysis  loading',
      app.loopback.capturing ? 'capture   ok' : 'capture   off (no spectrum)',
    ],
  });

  app.useAnalysis(analysis);
  void analysis.load();

  const onSongChange = (): void => {
    void analysis.load();
    app.bus.resetTrackStats();

    // Otherwise the previous track's plan keeps running for up to
    // maxIntervalMs (30s) into the new one - not a hard cut, since the
    // engine itself decides whether the change warrants one, but the
    // decision happens now instead of on the old track's leftover clock.
    if (app.running) void app.director.refresh(app.bus.frame, context());

    const uri = sp.Player?.data?.item?.uri;
    const imageUrl = sp.Player?.data?.item?.metadata?.image_url;
    if (uri === artworkUri) return;
    artworkUri = uri;
    artwork = null; // clear immediately so a slow fetch does not carry the old track's color into the new one
    void analyzeArtwork(imageUrl).then((dna) => {
      if (sp.Player?.data?.item?.uri === artworkUri) artwork = dna;
    });
  };

  onSongChange();
  sp.Player?.addEventListener('songchange', onSongChange);

  const toggle = async (): Promise<void> => {
    if (app.running) app.stop();
    else await app.start();
  };

  new sp.Menu!.Item('System One Visualizer', false, () => void toggle()).register();

  sp.Keyboard?.registerShortcut({ key: 'v', ctrl: true, shift: true }, () => void toggle());

  // Escape closes; H hides the HUD. Capture phase so the client's own
  // handlers do not swallow them first.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!app.running) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        app.stop();
      } else if (e.key === 'h' || e.key === 'H') {
        e.stopPropagation();
        app.overlay.toggleHud();
      }
    },
    true,
  );

  // Exposed so the engine can be reconfigured from the client console without
  // rebuilding: __s1.configure({ proxyUrl: 'http://127.0.0.1:8765' })
  Object.defineProperty(globalThis, '__s1', {
    value: {
      app,
      toggle,
      settings: loadSettings,
      configure(patch: Settings) {
        const next = { ...loadSettings(), ...patch };
        saveSettings(next);
        sp.showNotification?.('Visualizer settings saved. Reload Spotify to apply.');
        return next;
      },
    },
    configurable: true,
  });

  console.info('[s1-visualizer] ready. Ctrl+Shift+V to toggle.');
}

void main();
