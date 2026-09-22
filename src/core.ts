import { FeatureBus } from './audio/bus';
import { LoopbackSource } from './audio/loopback';
import { AnalysisSource } from './audio/analysis';
import type { AudioSource } from './audio/source';
import { Director, type TrackContext } from './director/director';
import { JevClient } from './director/jev';
import { LocalSystemOne } from './director/local';
import type { DecisionEngine } from './director/engine';
import { Renderer } from './render/renderer';
import { Overlay } from './ui/overlay';
import { recordLine, type LogSink } from './eval/recorder';

export interface AppConfig {
  /** TypeSafe key. Absent means the local engine drives everything. */
  apiKey?: string;
  /** Proxy that holds the key server-side. Takes precedence over `apiKey`. */
  proxyUrl?: string;
  renderScale?: number;
  /** Supplies track metadata. The Spicetify build passes one; the harness does not. */
  context?: () => TrackContext;
  /** Extra HUD lines. */
  status?: () => string[];
  /**
   * Receives one JSONL line per decision: the System1 answer, the direct
   * baseline computed on the same window, and which audio sources were
   * actually live. Wired to a real file in the Electron build; omitted
   * elsewhere.
   */
  log?: LogSink;
}

/**
 * Wiring shared by the Spicetify extension and the dev harness.
 *
 * Both builds run this identical pipeline. Anything Spotify-specific arrives
 * through `config.context` or through an AudioSource, so the harness exercises
 * the real renderer and the real director rather than a mock of them.
 */
export class VisualizerApp {
  readonly overlay = new Overlay();
  readonly bus = new FeatureBus();
  readonly loopback = new LoopbackSource();

  #analysis: AnalysisSource | null = null;
  #renderer: Renderer | null = null;
  #director: Director;
  #raf = 0;
  #running = false;
  #config: AppConfig;
  #errors: string[] = [];

  constructor(config: AppConfig = {}) {
    this.#config = config;

    const local = new LocalSystemOne();
    const engine: DecisionEngine =
      config.apiKey || config.proxyUrl
        ? new JevClient({ apiKey: config.apiKey, proxyUrl: config.proxyUrl })
        : local;

    this.#director = new Director({
      engine,
      fallback: local,
      onPlan: (plan, features, ctx, baseline) => {
        this.#renderer?.setPlan(plan);
        // Visible confirmation the whole chain actually ran: in Electron this
        // prints straight to the terminal, which is otherwise blind to
        // anything happening inside the renderer.
        const w = (x: { top: string; p: Partial<Record<string, number>> }) =>
          `${x.top}${x.p[x.top] != null ? ` ${(x.p[x.top] as number).toFixed(2)}` : ''}`;
        console.log(
          `[director] ${plan.origin} → motion=${w(plan.motion)} palette=${w(plan.palette)} ` +
            `texture=${w(plan.texture)} sym=${w(plan.symmetry)} fb=${w(plan.feedback)} ` +
            `intensity=${plan.intensity.toFixed(2)}` +
            (plan.motion.top !== baseline.motion.top || plan.palette.top !== baseline.palette.top
              ? `  [baseline would say: ${baseline.motion.top}/${baseline.palette.top}]`
              : '  [baseline agrees]'),
        );
        this.#config.log?.(recordLine(plan, baseline, features, ctx, this.loopback.capturing));
      },
      onError: (err) => {
        // Keep only the most recent; a failing key would otherwise fill the HUD.
        this.#errors = [`! ${err.message.slice(0, 64)}`];
        console.error(`[director] ${err.message}`);
      },
    });

    this.bus.add(this.loopback);
  }

  /** Attach Spotify's analysis as a second source. Extension build only. */
  useAnalysis(source: AnalysisSource): void {
    this.#analysis = source;
    this.bus.add(source);
  }

  get running(): boolean {
    return this.#running;
  }

  get director(): Director {
    return this.#director;
  }

  get analysis(): AnalysisSource | null {
    return this.#analysis;
  }

  /** `null` until `start()` has created it. Exposed for perf-isolation toggles only. */
  get renderer(): Renderer | null {
    return this.#renderer;
  }

  async start(): Promise<void> {
    if (this.#running) return;

    this.overlay.show();

    if (!this.#renderer) {
      try {
        this.#renderer = new Renderer(this.overlay.canvas, this.#director.plan, {
          scale: this.#config.renderScale ?? 0.85,
        });
        console.log(`[renderer] ready (hdr: ${this.#renderer.hdr})`);
      } catch (err) {
        this.overlay.notice(`Renderer failed to start.\n\n${(err as Error).message}`);
        console.error(`[renderer] failed to start: ${(err as Error).message}`);
        return;
      }
    }

    this.#running = true;
    this.#loop();

    // Capture is requested after rendering is live, and deliberately not
    // awaited. The permission prompt can sit unanswered indefinitely, and
    // blocking on it would leave the caller's start screen covering a
    // perfectly good visualizer. Denial just means no spectrum.
    if (!this.loopback.capturing) {
      void this.loopback
        .start()
        .then(() => console.log('[audio] loopback capture started'))
        .catch((err: Error) => {
          this.#errors = [`! audio capture: ${err.message.slice(0, 48)}`];
          console.error(`[audio] loopback capture failed: ${err.message}`);
        });
    }
  }

  stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#raf);
    this.overlay.hide();
  }

  /** Stop and release the GPU and audio resources. */
  dispose(): void {
    this.stop();
    this.loopback.stop();
    this.#renderer?.dispose();
    this.#renderer = null;
  }

  #fpsFrames = 0;
  #fpsWindowStart = 0;
  #lastSimSampleAt = 0;

  #loop = (): void => {
    if (!this.#running) return;
    this.#raf = requestAnimationFrame(this.#loop);

    const now = performance.now();
    const frame = this.bus.update(now);
    const ctx = this.#config.context?.() ?? {};

    this.#director.tick(frame, ctx);
    this.#renderer?.setArtwork(ctx.artwork ?? null);
    this.#renderer?.render(frame);

    // Printed rather than only shown in the HUD, so it lands in the terminal
    // log for the perf pass without needing to read the screen at all.
    this.#fpsFrames++;
    if (this.#fpsWindowStart === 0) this.#fpsWindowStart = now;
    const elapsed = now - this.#fpsWindowStart;
    if (elapsed >= 5000) {
      const fps = (this.#fpsFrames / elapsed) * 1000;
      console.log(`[perf] ${fps.toFixed(1)} fps  (${(1000 / fps).toFixed(2)}ms/frame avg over ${(elapsed / 1000).toFixed(1)}s)`);
      this.#fpsFrames = 0;
      this.#fpsWindowStart = now;
    }

    // Multi-minute RD stability check: cheap enough at this interval (one
    // GPU readback per 20s, not per frame) to leave on for the whole session.
    if (now - this.#lastSimSampleAt >= 20000) {
      this.#lastSimSampleAt = now;
      const stats = this.#renderer?.sampleSimStats();
      if (stats) {
        console.log(
          `[perf] sim U=${stats.meanU.toFixed(3)} V=${stats.meanV.toFixed(3)}` +
            (stats.hasNaN ? '  !! NaN detected !!' : ''),
        );
      }
    }

    this.overlay.update(
      frame,
      this.#director.plan,
      [...(this.#config.status?.() ?? []), ...this.#errors],
      ctx,
    );
  };
}

export type { AudioSource, TrackContext };
