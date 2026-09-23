import { FeatureBus } from './audio/bus';
import { LoopbackSource } from './audio/loopback';
import { AnalysisSource } from './audio/analysis';
import type { AudioSource } from './audio/source';
import type { FeatureFrame } from './types';
import { Director, type TrackContext } from './director/director';
import { JevClient } from './director/jev';
import { LocalSystemOne } from './director/local';
import type { DecisionEngine } from './director/engine';
import { Renderer } from './render/renderer';
import { Overlay } from './ui/overlay';
import { recordLine, telemetryLine, type LogSink } from './eval/recorder';
import { WorldModel } from './world/model';
import type { ImageSubstrateProvider, SubstrateConditioning } from './world/substrate';
import type { LearnedAudioPerception } from './perception/adapter';
import type { LyricsRuntime } from './lyrics/runtime';
import { buildConditioningPacket } from './world/conditioning';
import { motionFromWorld } from './world/motion';
import { identityFromContext } from './world/identity';
import { deltaFromDecision } from './world/delta';

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
  /** Optional sparse image-model realization; never called from the frame hot path. */
  substrateProvider?: ImageSubstrateProvider;
  substrate?: SubstrateConditioning;
  /** Optional learned audio embedding provider, sampled at decision cadence. */
  perception?: LearnedAudioPerception;
  lyrics?: LyricsRuntime;
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
  #world = new WorldModel();
  #substrateInFlight = false;
  #substrateStats = { requests: 0, successes: 0, failures: 0, lastMs: 0, lastSource: 'none', lastContinuity: 'none' };
  #lastFrame: FeatureFrame | null = null;
  #lastContext: TrackContext = {};

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
      perception: config.perception,
      audioWindow: () => this.loopback.audioWindow(),
      onPlan: (plan, features, ctx, baseline, perception) => {
        this.#world.setPlan(plan);
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
        this.#config.log?.(recordLine(
          plan,
          baseline,
          features,
          ctx,
          this.loopback.capturing,
          this.#world.projection(),
          this.#world.state,
          perception,
          motionFromWorld(this.#world.state),
          identityFromContext(ctx, this.#world.state),
          deltaFromDecision(plan, features, ctx, this.#world.state, motionFromWorld(this.#world.state)),
        ));
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
    if (this.#config.lyrics) void this.#config.lyrics.sync(this.#config.context?.() ?? {});
    this.#loop();
    if (this.#config.substrateProvider) void this.#refreshSubstrate();

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
  #lastSimStats: { meanU: number; meanV: number; hasNaN: boolean } | null = null;
  #beatsSinceTelemetry = 0;
  #sectionsSinceTelemetry = 0;

  #loop = (): void => {
    if (!this.#running) return;
    this.#raf = requestAnimationFrame(this.#loop);

    const now = performance.now();
    const frame = this.bus.update(now);
    const baseCtx = this.#config.context?.() ?? {};
    if (this.#config.lyrics) void this.#config.lyrics.sync(baseCtx);
    const lyricText = this.#config.lyrics?.currentText(baseCtx.position ?? frame.t);
    const ctx = lyricText ? { ...baseCtx, lyrics: lyricText } : baseCtx;
    this.#lastFrame = frame;
    this.#lastContext = ctx;

    this.#director.tick(frame, ctx);
    const lyrics = this.#config.lyrics?.frame(ctx.position ?? frame.t) ?? { mode: 'off' as const, cue: null, progress: 0, opacity: 0 };
    if (lyrics.mode === 'world' || lyrics.mode === 'hybrid') {
      for (const event of this.#config.lyrics?.events(ctx.position ?? frame.t) ?? []) this.#world.applyLyricEvent(event);
    }
    const world = this.#world.update(frame);
    if (frame.onSection) void this.#refreshSubstrate();
    if (frame.onBeat) this.#beatsSinceTelemetry++;
    if (frame.onSection) this.#sectionsSinceTelemetry++;
    this.#renderer?.setArtwork(ctx.artwork ?? null);
      this.#renderer?.setWorld(world);
    this.#renderer?.render(frame);
    this.overlay.setLyrics(lyrics);
    this.#renderer?.setLyricMask(
      lyrics.mode === 'world' || lyrics.mode === 'hybrid' ? lyrics.cue?.id ?? null : null,
      lyrics.cue?.text ?? '',
      lyrics.mode === 'world' || lyrics.mode === 'hybrid' ? lyrics.opacity : 0,
    );

    // Printed rather than only shown in the HUD, so it lands in the terminal
    // log for the perf pass without needing to read the screen at all.
    this.#fpsFrames++;
    if (this.#fpsWindowStart === 0) this.#fpsWindowStart = now;
    const elapsed = now - this.#fpsWindowStart;
    if (elapsed >= 5000) {
      const fps = (this.#fpsFrames / elapsed) * 1000;
      const frameMs = 1000 / Math.max(fps, 0.001);
      console.log(`[perf] ${fps.toFixed(1)} fps  (${(1000 / fps).toFixed(2)}ms/frame avg over ${(elapsed / 1000).toFixed(1)}s)`);
      this.#config.log?.(telemetryLine({
        t: frame.t,
        fps,
        frameMs,
        world,
        motion: motionFromWorld(this.#world.state),
        sim: this.#lastSimStats,
        renderer: this.#renderer?.telemetry(),
        audio: { onBeat: frame.onBeat, onSection: frame.onSection, level: frame.level, flux: frame.flux, bassFlux: frame.bassFlux },
        beatsSinceLast: this.#beatsSinceTelemetry,
        sectionsSinceLast: this.#sectionsSinceTelemetry,
        substrate: this.#substrateStats,
        perception: this.#config.perception?.telemetry?.(),
      }));
      this.#beatsSinceTelemetry = 0;
      this.#sectionsSinceTelemetry = 0;
      this.#fpsFrames = 0;
      this.#fpsWindowStart = now;
    }

    // Multi-minute RD stability check: cheap enough at this interval (one
    // GPU readback per 20s, not per frame) to leave on for the whole session.
    if (now - this.#lastSimSampleAt >= 20000) {
      this.#lastSimSampleAt = now;
      const stats = this.#renderer?.sampleSimStats();
      if (stats) {
        this.#lastSimStats = stats;
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

  async #refreshSubstrate(): Promise<void> {
    const provider = this.#config.substrateProvider;
    if (!provider || this.#substrateInFlight || !this.#renderer) return;
    this.#substrateInFlight = true;
    const started = performance.now();
    this.#substrateStats.requests++;
    try {
      const world = this.#world.state;
      const conditioning = buildConditioningPacket(world, this.#lastFrame, this.#lastContext);
      const substrate = await provider.generate(world, conditioning);
      if (substrate) {
        await this.#renderer.setSubstrate(substrate, this.#config.substrate ?? { strength: 1, mode: 'replace' });
        this.#substrateStats.successes++;
        this.#substrateStats.lastSource = substrate.source;
        this.#substrateStats.lastContinuity = substrate.continuity ?? 'unknown';
      }
      this.#substrateStats.lastMs = Math.round(performance.now() - started);
    } catch (err) {
      this.#substrateStats.failures++;
      this.#substrateStats.lastMs = Math.round(performance.now() - started);
      console.warn(`[substrate] ${provider.name}: ${(err as Error).message}`);
    } finally {
      this.#substrateInFlight = false;
    }
  }
}

export type { AudioSource, TrackContext };
