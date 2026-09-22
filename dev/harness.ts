import { VisualizerApp } from '../src/core';

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
  }
}

const params = new URLSearchParams(location.search);

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

async function main(): Promise<void> {
  const app: VisualizerApp = new VisualizerApp({
    apiKey: await resolveApiKey(),
    proxyUrl: params.get('proxy') ?? undefined,
    renderScale: Number(params.get('scale') ?? 0.85),
    status: (): string[] => ['', app.loopback.capturing ? 'capture   ok' : 'capture   off (no spectrum)'],
    // Real decision logging for the evaluation pass, when Electron's preload
    // has exposed a sink. Absent in a plain browser tab - nothing changes there.
    log: window.s1Log ? (line) => window.s1Log!.append(line) : undefined,
  });

  const button = document.getElementById('start') as HTMLButtonElement | null;
  const hint = document.getElementById('hint');

  button?.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'starting…';
    await app.start();
    document.getElementById('gate')?.remove();
  });

  // `mediaDevices` is undefined outside a secure context, so this is a real
  // runtime check despite the DOM types insisting the method always exists.
  const canCapture = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  if (hint) {
    hint.textContent = canCapture
      ? 'Pick a tab or your whole screen, and make sure "Share audio" is ticked.'
      : 'No getDisplayMedia here (needs https or localhost). The visuals will run with no spectrum.';
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') app.overlay.toggleHud();
    // Perf-isolation toggles for the validation pass, dev/Electron only - not
    // part of the Spicetify build. Watch [perf] lines in the terminal for the
    // fps delta each one makes.
    if (e.key === '1') app.renderer?.toggleDebug('sim');
    if (e.key === '2') app.renderer?.toggleDebug('particles');
    if (e.key === '3') app.renderer?.toggleDebug('bloom');
  });

  // Handy while tuning: __s1.app.director.refresh(...) forces a new decision.
  Object.defineProperty(globalThis, '__s1', { value: { app }, configurable: true });
}

void main();
