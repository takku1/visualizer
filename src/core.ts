import { FeatureBus } from './audio/bus';
import { LoopbackSource } from './audio/loopback';
import { AnalysisSource } from './audio/analysis';
import type { AudioSource } from './audio/source';
import { Director, type TrackContext } from './director/director';
import { JevClient } from './director/jev';
import { LocalSystemOne } from './director/local';
import type { DecisionEngine } from './director/engine';
import { Renderer } from './render/renderer';
import { ProceduralScene, type ProceduralUniforms } from './render/procedural';
import { ProceduralCapture } from './render/capture';
import { Overlay } from './ui/overlay';
import { checkpointLine, recordLine, stateLine, telemetryLine, type LogSink } from './eval/recorder';
import { ControlMapper, type SamplerControl } from './stream/control';
import { CheckpointScheduler } from './stream/checkpoint';
import { sceneFromPlan, type Scene } from './stream/scenes';
import { KnobDirector, type KnobTargets } from './stream/knobs';
import { smooth } from './audio/source';
import { StreamClient } from './stream/client';
import { CouplingController } from './stream/coupling';
import { MotifLedger } from './director/semantic';
import { LiveMeaningClient } from './director/live-client';
import type { LiveLyricUpdate } from './director/live';
import { LiveLyricAccumulator, type LiveMeaningState } from './director/live-accumulator';
import { liveEvidenceSummary, meaningFromLive, perceptualCueFromLive } from './director/live-meaning';
import { colorStateFromLook, lightingStateFromLook } from './world/visual';
import { continuousForcesFrom } from './realization/backend';
import { addShotCandidate, compileShotGraph, shotGraphBoundary, ShotGraphRuntime } from './stream/shot-graph';

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
  /** One JSONL line per decision, checkpoint, and telemetry tick. Electron wires it to a file. */
  log?: LogSink;
  /** Stream sidecar (tools/stream-server.py). Omit to show the procedural scene alone. */
  streamUrl?: string;
  /** 0 = pure procedural, 1 = fully painted by the diffusion stream. Default 0.85. */
  paint?: number;
  /** false: splice only the initial keyframe (see CheckpointScheduler). Default true. */
  keyframes?: boolean;
  /** Periodic/stagnation re-seeds. Default false: the diffusion state animates continuously. */
  reseed?: boolean;
  /** Optional local ASR worker, e.g. ws://127.0.0.1:8772. */
  meaningUrl?: string;
  /**
   * 'splice' (default): each director decision is a new scene, spliced in as a
   * keyframe. 'knobs': the director steers prompt-blend weights, the
   * procedural look and bend gains every few seconds, and keyframes are
   * spliced only for the first scene and confident hard cuts
   * (docs/live-knob-direction.md).
   */
  direction?: 'splice' | 'knobs';
}

/**
 * The two-timescale visualizer, shared by the Spicetify extension and the dev
 * harness / Electron app.
 *
 *   audio ──► FeatureBus ──► ControlMapper ──► sampler physics ─────────────┐
 *                 │               └──► ProceduralScene (60 Hz) ── capture ──┤ stream sidecar paints it
 *                 │                         │                                ▼ (System 1, every frame)
 *                 │                         └─────────► display ◄── mix(paint) ◄── painted frames
 *                 └──► Meaning/Director ──► Scene (shot + fingerprint + prompt/look)
 *                                           └──► CheckpointScheduler
 *
 * The procedural scene owns structure and motion, so it is smooth and exactly
 * on the beat; the sidecar paints texture and meaning over it; `paint` sets
 * the balance. The browser owns audio analysis and all timing decisions.
 */
export class VisualizerApp {
  readonly overlay = new Overlay();
  readonly bus = new FeatureBus();
  readonly loopback = new LoopbackSource();

  #analysis: AnalysisSource | null = null;
  #renderer: Renderer | null = null;
  #director: Director;
  #mapper = new ControlMapper();
  #scheduler: CheckpointScheduler;
  #stream: StreamClient | null = null;
  #control: SamplerControl | null = null;
  #scene = new ProceduralScene();
  #sceneUniforms: ProceduralUniforms | null = null;
  #capture: ProceduralCapture | null = null;
  #capturing = false;
  #capturePausedUntil = 0;
  #paint: number;
  #knobs: KnobDirector | null;
  #targets: KnobTargets | null = null;
  #bendGain = { hue: 1, swell: 1, glass: 1, lurch: 1 };
  #hspace = { energy: 0, light: 0, organic: 0 };
  #checkpoints = 0;
  #sceneIndex = 0;
  #raf = 0;
  #running = false;
  #config: AppConfig;
  #errors: string[] = [];
  #conceptsRequestedFor: string | null = null;
  #coupling = new CouplingController();
  #motifLedger = new MotifLedger();
  #liveMeaning: LiveMeaningClient | null = null;
  #liveLyrics: LiveLyricUpdate | null = null;
  #liveMeaningState: LiveMeaningState | null = null;
  #liveMeaningRevision = 0;
  #liveCommittedSignature = '';
  #liveAccumulator = new LiveLyricAccumulator();
  #lastMeaningSendAt = -Infinity;
  #shotRuntime: ShotGraphRuntime | null = null;
  #shotGraphStaged = 0;
  #shotGraphPrefetched = 0;
  #shotGraphSelected = 0;
  #shotGraphStagedIds: string[] = [];
  #shotGraphPrefetchedIds: string[] = [];
  #shotGraphSelectedIds: string[] = [];
  #directionDecisions = 0;
  #lastCheckpointReason: string | null = null;
  #realizationTrackId: string | null = null;
  #trackTransitions = 0;
  #lastLoopErrorAt = -Infinity;
  #lastLoopAt = -Infinity;
  #loopWatchdog: number | null = null;

  #meaningTelemetry(): object | null {
    if (!this.#liveMeaning) return null;
    const cue = this.#liveMeaningState ? perceptualCueFromLive(this.#liveMeaningState) : null;
    const evidence = this.#liveMeaningState ? liveEvidenceSummary(this.#liveMeaningState) : null;
    return {
      ...this.#liveMeaning.telemetry(),
      provisional: this.#liveMeaningState?.provisional.length ?? 0,
      committed: this.#liveMeaningState?.committed.length ?? 0,
      candidateCount: this.#liveMeaningState?.candidateCount ?? 0,
      maxCandidateObservations: this.#liveMeaningState?.maxCandidateObservations ?? 0,
      evidence,
      provisionalCue: cue ? {
        active: true,
        confidence: cue.confidence,
        behavior: cue.behavior,
        materiality: cue.materiality,
        motion: cue.motion,
        lighting: cue.lighting,
      } : { active: false },
    };
  }

  #shotGraphTelemetry(): object {
    return {
      staged: this.#shotGraphStaged,
      prefetched: this.#shotGraphPrefetched,
      selected: this.#shotGraphSelected,
      pending: this.#shotRuntime !== null,
      stagedIds: this.#shotGraphStagedIds.slice(-8),
      prefetchedIds: this.#shotGraphPrefetchedIds.slice(-8),
      selectedIds: this.#shotGraphSelectedIds.slice(-8),
    };
  }

  constructor(config: AppConfig = {}) {
    this.#config = config;
    this.#paint = config.paint ?? 0.85;
    const knobs = config.direction === 'knobs';
    this.#knobs = knobs ? new KnobDirector() : null;
    this.#scheduler = new CheckpointScheduler({
      keyframes: knobs ? false : config.keyframes ?? true,
      reseed: config.reseed ?? false,
    });

    const local = new LocalSystemOne();
    const engine: DecisionEngine =
      config.apiKey || config.proxyUrl
        ? new JevClient({ apiKey: config.apiKey, proxyUrl: config.proxyUrl })
        : local;

    this.#director = new Director({
      engine,
      fallback: local,
      // Knob mode decides every 3-5 s: each decision only moves targets that
      // are glided toward, so a faster cadence cannot jump the picture.
      ...(knobs ? { minIntervalMs: 3000, maxIntervalMs: 5000 } : {}),
      onPlan: (plan, features, ctx, baseline) => {
        this.#directionDecisions++;
        const scene = sceneFromPlan(plan, ctx, this.#sceneIndex++, this.#motifLedger);
        if (this.#knobs) {
          const targets = this.#knobs.decide(plan, ctx);
          this.#targets = targets;
          const knobScene = {
            ...scene,
            look: targets.look,
            world: {
              ...scene.world,
              visualIdentity: {
                ...scene.world.visualIdentity,
                look: targets.look,
                color: colorStateFromLook(targets.look),
                lighting: lightingStateFromLook(targets.look, plan.intensity / 4),
              },
            },
          };
          if (targets.cut) this.#scheduler.cut(knobScene);
          else this.#scheduler.setScene(knobScene); // only the initial keyframe uses it
          this.#stream?.sendBlend(targets.prompts, targets.weights, targets.tauSec);
          if (!targets.cut) this.#scene.setLook(targets.look, targets.tauSec);
        } else {
          // The graph owns semantic candidate staging. The scheduler still
          // owns the actual checkpoint commit, so a candidate cannot land
          // until the graph sees a safe musical boundary.
          const current = this.#scheduler.scene;
          if (!current) {
            this.#scheduler.setScene(scene);
          } else if (!sameSceneFingerprint(current, scene)) {
            const candidateId = `candidate-${this.#sceneIndex}`;
            const graph = addShotCandidate(
              compileShotGraph(current),
              candidateId,
              scene,
              8,
              scene.continuityContract.confidence,
              { section: ctx.sectionIndex, requiresDownbeat: true },
            );
            this.#shotRuntime = new ShotGraphRuntime(graph);
            this.#shotGraphStaged++;
            this.#shotGraphStagedIds.push(candidateId);
            const prefetched = this.#shotRuntime.prefetchCandidates();
            this.#shotGraphPrefetched += prefetched.length;
            this.#shotGraphPrefetchedIds.push(...prefetched.map((candidate) => candidate.id));
          }
          // Abstaining mode still needs strong visual chapters. Change the
          // procedural substrate on director cadence, but keep the diffusion
          // latent continuous: this gives a definite new look without a new
          // image/keyframe splice.
          if (!scene.semantic) this.#scene.setLook(scene.look, 0.8);
        }
        const directionKind = scene.semantic ? 'semantic-direction' : 'continuous-direction';
        console.log(`[director] [${directionKind}] ${scene.source} ${plan.origin} → ${scene.prompt}` +
          (scene.source === 'semantic-manifest' ? '' : '  [semantic abstained: no meaning manifest; perceptual direction active]') +
          (plan.motion.top !== baseline.motion.top || plan.palette.top !== baseline.palette.top
            ? `  [baseline would say: ${baseline.motion.top}/${baseline.palette.top}]`
            : '  [baseline agrees]'));
        this.#config.log?.(recordLine(plan, baseline, features, ctx, this.loopback.capturing, scene));
      },
      onError: (err) => {
        // Keep only the most recent; a failing key would otherwise fill the HUD.
        this.#errors = [`! ${err.message.slice(0, 64)}`];
        console.error(`[director] ${err.message}`);
      },
    });

    if (config.streamUrl) {
      this.#stream = new StreamClient(config.streamUrl, (bitmap) => this.#renderer?.pushFrame(bitmap, performance.now()));
    }
    if (config.meaningUrl) {
      this.#liveMeaning = new LiveMeaningClient(config.meaningUrl, (update) => {
        if (!this.#liveLyrics || update.trackId !== this.#liveLyrics.trackId || update.revision >= this.#liveLyrics.revision) {
          this.#liveLyrics = update;
          this.#liveMeaningState = this.#liveAccumulator.update(update.trackId, update.revision, update.hypotheses);
          const signature = this.#liveMeaningState.committed.map((item) => `${item.id}:${item.text}`).join('|');
          if (signature && signature !== this.#liveCommittedSignature) {
            this.#liveCommittedSignature = signature;
            this.#liveMeaningRevision++;
          }
        }
      });
    }

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

  get stream(): StreamClient | null {
    return this.#stream;
  }

  /** 0 = pure procedural, 1 = fully painted. */
  get paint(): number {
    return this.#paint;
  }

  set paint(v: number) {
    this.#paint = Math.min(Math.max(v, 0), 1);
  }

  async start(): Promise<void> {
    if (this.#running) return;
    this.overlay.show();

    if (!this.#renderer) {
      try {
        this.#renderer = new Renderer(this.overlay.canvas, { scale: this.#config.renderScale ?? 1 });
      } catch (err) {
        this.overlay.notice(`Renderer failed to start.\n\n${(err as Error).message}`);
        console.error(`[renderer] failed to start: ${(err as Error).message}`);
        return;
      }
    }

    this.#running = true;
    this.#stream?.connect();
    this.#liveMeaning?.connect();
    // The first scene is decided immediately rather than on the director's
    // section clock, so the sidecar has something to render on connect.
    void this.#director.refresh(this.bus.frame, this.#config.context?.() ?? {});
    this.#loop();
    // Chromium may suspend RAF for a hidden/background Electron window. Keep
    // the same frame function alive at a low rate in that case; visible RAF
    // remains the normal display clock and the watchdog is dormant.
    this.#loopWatchdog = window.setInterval(() => {
      if (this.#running && performance.now() - this.#lastLoopAt > 500) {
        this.#runFrame();
      }
    }, 250);

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
    if (this.#loopWatchdog !== null) {
      window.clearInterval(this.#loopWatchdog);
      this.#loopWatchdog = null;
    }
    this.#stream?.close();
    this.#liveMeaning?.close();
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
  #streamFramesAtWindow = 0;
  #lastStateLogAt = -Infinity;
  #lastBarPhase = 0;
  #barTrackId: string | null = null;

  #loop = (): void => {
    if (!this.#running) return;
    this.#raf = requestAnimationFrame(this.#loop);
    this.#runFrame();
  };

  #runFrame = (): void => {
    if (!this.#running) return;
    this.#lastLoopAt = performance.now();
    try {
      this.#loopFrame();
    } catch (error) {
      // A display-rate exception must not silently terminate the RAF chain.
      // Keep the browser/procedural path alive and rate-limit the diagnostic;
      // the next frame can recover from transient sidecar/canvas failures.
      const now = performance.now();
      if (now - this.#lastLoopErrorAt >= 1000) {
        const message = error instanceof Error ? error.message : String(error);
        this.#lastLoopErrorAt = now;
        this.#errors = [`! frame loop: ${message.slice(0, 96)}`];
        console.error(`[renderer] frame loop: ${message}`);
      }
    }
  };

  #loopFrame = (): void => {
    const now = performance.now();
    const frame = this.bus.update(now);
    const baseCtx = this.#config.context?.() ?? {};
    const trackKey = baseCtx.trackId ?? null;
    if (trackKey !== this.#barTrackId) {
      const previousTrack = this.#barTrackId;
      this.#barTrackId = trackKey;
      this.#lastBarPhase = frame.barPhase;
      // A song boundary starts a new realization session. Within the same
      // track, director revisions remain control-plane updates over the
      // continuous latent/raster state.
      if (previousTrack !== null || trackKey !== null) {
        this.#scheduler.resetTrack();
        this.#shotRuntime = null;
        this.#realizationTrackId = trackKey;
        if (previousTrack !== null && trackKey !== null) this.#trackTransitions++;
        this.#checkpoints = 0;
        this.#shotGraphStaged = 0;
        this.#shotGraphPrefetched = 0;
        this.#shotGraphSelected = 0;
        this.#shotGraphStagedIds = [];
        this.#shotGraphPrefetchedIds = [];
        this.#shotGraphSelectedIds = [];
        this.#lastCheckpointReason = null;
      }
    }
    const graphClock = shotGraphBoundary(frame.barPhase, this.#lastBarPhase, frame.onBeat, frame.hasStructure, frame.rhythmConfidence);
    this.#lastBarPhase = frame.barPhase;
    if (this.#liveMeaning?.connected && baseCtx.trackId && now - this.#lastMeaningSendAt >= 1500) {
      const window = this.loopback.audioWindow?.();
      if (window) {
        this.#liveMeaning.sendWindow(baseCtx.trackId, baseCtx.position ?? 0, window);
        this.#lastMeaningSendAt = now;
      }
    }
    const stream0 = this.#stream;
    // Song concepts: ask once per track (and again after a reconnect), and
    // hand them to the director with the rest of the track context.
    if (stream0?.connected && baseCtx.trackId && baseCtx.title && this.#conceptsRequestedFor !== `${baseCtx.trackId}@${stream0.info?.model}`) {
      stream0.sendTrack(baseCtx.trackId, baseCtx.title, baseCtx.artist ?? '');
      this.#conceptsRequestedFor = `${baseCtx.trackId}@${stream0.info?.model}`;
    }
    if (!stream0?.connected) this.#conceptsRequestedFor = null;
    const concepts = stream0?.concepts?.trackId === baseCtx.trackId ? stream0?.concepts?.words : undefined;
    const liveState = this.#liveMeaningState;
    const localMeaning = liveState && liveState.trackId === baseCtx.trackId
      ? meaningFromLive(liveState, this.#liveMeaningRevision, frame.sectionIndex)
      : undefined;
    const provisionalCue = liveState && liveState.trackId === baseCtx.trackId
      ? perceptualCueFromLive(liveState)
      : undefined;
    const meaning = stream0?.meaning?.trackId === baseCtx.trackId ? stream0?.meaning?.manifest : localMeaning;
    const ctx = concepts?.length || meaning || provisionalCue
      ? { ...baseCtx, ...(concepts?.length ? { concepts } : {}), ...(meaning ? { meaning } : {}), ...(provisionalCue ? { provisionalCue } : {}) }
      : baseCtx;
    this.#director.tick(frame, ctx);

    const plan = this.#director.plan;
    const raw = this.#mapper.map(frame, plan.intensity / 4);
    // Knob mode: the director's bend gains, glided at display rate, scale the
    // audio-driven bends. Splice mode leaves them at 1.
    const target = this.#targets?.bendGain;
    if (target) {
      const tau = this.#targets!.tauSec;
      for (const k of ['hue', 'swell', 'glass', 'lurch'] as const) this.#bendGain[k] = smooth(this.#bendGain[k], target[k], frame.dt, tau);
      const hs = this.#targets!.hspace;
      for (const k of ['energy', 'light', 'organic'] as const) this.#hspace[k] = smooth(this.#hspace[k], hs[k], frame.dt, tau);
    }
    const g = this.#bendGain;
    const h = this.#hspace;
    const mapped = {
      ...raw,
      hue: raw.hue * g.hue, swell: Math.min(raw.swell * g.swell, 0.4), glass: Math.min(raw.glass * g.glass, 0.9), lurch: Math.min(raw.lurch * g.lurch, 0.2),
      hsEnergy: h.energy, hsLight: h.light, hsOrganic: h.organic,
    };
    // Lower paint also lowers how far the sidecar reinterprets the frame, so
    // the painted layer stays closer to the structure it sits on.
    const baseControl = { ...mapped, strength: 0.2 + (mapped.strength - 0.2) * this.#paint };
    const control = this.#coupling.apply(baseControl, this.#stream?.meta ? {
      energy: frame.level,
      change: this.#stream.meta.change,
      jitter: this.#stream.meta.jitter,
      drift: this.#stream.meta.drift,
    } : null, frame.dt);
    this.#control = control;
    const scene = this.#scene.update(frame, mapped, this.#mapper.push, this.#mapper.energy);
    this.#sceneUniforms = scene;

    const stream = this.#stream;
    if (stream) {
      if (this.#shotRuntime && graphClock.eligible) {
        const candidate = this.#shotRuntime.choose({
          section: frame.sectionIndex,
          confidence: this.#scheduler.scene?.continuityContract.confidence ?? 0,
          downbeat: graphClock.downbeat || (!frame.hasStructure && frame.rhythmConfidence <= 0.5 && frame.onBeat),
        });
        if (candidate) {
          this.#scheduler.setScene(candidate.scene);
          this.#shotRuntime = null;
          this.#shotGraphSelected++;
          this.#shotGraphSelectedIds.push(candidate.id);
        }
      }
      stream.sendControl(control, now);
      // A slow GPU readback/encode can starve the display WebGL context. Once
      // it crosses the interactive budget, pause camera uploads temporarily;
      // the sidecar continues from its keyframe and the procedural display
      // remains responsive instead of turning into a slideshow.
      if (this.#paint > 0 && !this.#capturing && now >= this.#capturePausedUntil && stream.wantsSource(now)) {
        void this.#sendSource(now);
      }
      const request = this.#scheduler.update(frame, stream.observation());
      if (request) {
        if (request.reason === 'scene' || request.reason === 'initial') this.#scene.setLook(request.look);
        // A knob-mode session's first blend may have gone out before the
        // socket was up; re-send the current targets with each keyframe.
        if (this.#targets) stream.sendBlend(this.#targets.prompts, this.#targets.weights, this.#targets.tauSec);
        stream.requestCheckpoint(request, continuousForcesFrom(frame, control));
        this.#checkpoints++;
        console.log(`[checkpoint] ${request.id} ${request.reason} splice=${request.spliceFrames}f continuity=${request.continuity}`);
          this.#config.log?.(checkpointLine(frame.t, request));
        this.#lastCheckpointReason = request.reason;
      }
      if (!stream.connected && this.#renderer?.telemetry().stream) this.#renderer.clearStream();
    }

    this.#renderer?.render(now, this.#mapper.push, scene, stream?.connected ? this.#paint : 0);

    // Keep the five-second health record detailed, but add a compact one-Hz
    // state stream for phrase-scale analysis and future closed-loop control.
    if (frame.t - this.#lastStateLogAt >= 1) {
      this.#config.log?.(stateLine(frame.t, {
        track: { id: ctx.trackId ?? null, title: ctx.title ?? null, artist: ctx.artist ?? null },
        section: { index: frame.sectionIndex, label: ctx.sectionLabel ?? null },
        audio: { level: frame.level, bass: frame.bass, mid: frame.mid, treble: frame.treble, flux: frame.flux, tempo: frame.tempo },
        scene: {
          prompt: (this.#scheduler.scene?.prompt ?? '').slice(0, 160),
          index: this.#sceneIndex,
          fingerprint: this.#scheduler.scene?.fingerprint ?? null,
          meaningRevision: this.#scheduler.scene?.semantic?.meaningRevision ?? null,
          source: this.#scheduler.scene?.source ?? null,
          language: this.#scheduler.scene?.semantic?.language ?? null,
          shot: this.#scheduler.scene?.semantic?.shot ?? null,
        },
        stream: stream?.meta ? {
          buildHash: stream.info?.buildHash ?? null,
          input: stream.meta.input ?? null,
          checkpoint: stream.meta.checkpoint ?? null,
          change: stream.meta.change ?? null,
          jitter: stream.meta.jitter ?? null,
          drift: stream.meta.drift ?? null,
        } : null,
        meaning: this.#meaningTelemetry(),
        control: { strength: control.strength, feedback: control.feedback, noise: control.noise, flow: control.flow },
        shotGraph: this.#shotGraphTelemetry(),
        realization: {
          mode: 'continuous-song',
          trackId: this.#realizationTrackId,
          trackTransitions: this.#trackTransitions,
          reseedEnabled: this.#scheduler.reseed,
          keyframesEnabled: this.#scheduler.keyframes,
          directionDecisions: this.#directionDecisions,
          checkpoints: this.#checkpoints,
          lastCheckpointReason: this.#lastCheckpointReason,
        },
      }));
      this.#lastStateLogAt = frame.t;
    }

    this.#fpsFrames++;
    if (this.#fpsWindowStart === 0) this.#fpsWindowStart = now;
    const elapsed = now - this.#fpsWindowStart;
    if (elapsed >= 5000) {
      const fps = (this.#fpsFrames / elapsed) * 1000;
      const received = stream?.framesReceived ?? 0;
      const streamFps = ((received - this.#streamFramesAtWindow) / elapsed) * 1000;
      console.log(`[perf] display ${fps.toFixed(1)} fps  stream ${streamFps.toFixed(1)} fps` +
        (stream?.meta ? `  gen ${stream.meta.genMs}ms` : ''));
      this.#config.log?.(telemetryLine({
        t: frame.t,
        fps,
        streamFps,
        stream: stream ? { buildHash: stream.info?.buildHash ?? null, connected: stream.connected, waiting: stream.waiting, meta: stream.meta, received, dropped: stream.framesDropped, captureMs: Math.round(stream.captureMs * 10) / 10 } : null,
        paint: this.#paint,
        meaning: this.#meaningTelemetry(),
        control,
        checkpoints: this.#checkpoints,
        renderer: this.#renderer?.telemetry(),
        shotGraph: this.#shotGraphTelemetry(),
        realization: {
          mode: 'continuous-song',
          trackId: this.#realizationTrackId,
          trackTransitions: this.#trackTransitions,
          reseedEnabled: this.#scheduler.reseed,
          keyframesEnabled: this.#scheduler.keyframes,
          directionDecisions: this.#directionDecisions,
          checkpoints: this.#checkpoints,
          lastCheckpointReason: this.#lastCheckpointReason,
        },
        audio: { level: frame.level, bass: frame.bass, flux: frame.flux, tempo: frame.tempo, hasStructure: frame.hasStructure },
      }));
      this.#streamFramesAtWindow = received;
      this.#fpsFrames = 0;
      this.#fpsWindowStart = now;
    }

    this.overlay.update(frame, plan, [...this.#streamLines(), ...(this.#config.status?.() ?? []), ...this.#errors], ctx);
  };

  /** Render the procedural scene small and hand it to the sidecar as its camera. */
  async #sendSource(now: number): Promise<void> {
    const stream = this.#stream;
    const scene = this.#sceneUniforms;
    if (!stream?.info || !scene) return;
    this.#capturing = true;
    try {
      if (!this.#capture || this.#capture.width !== stream.info.width || this.#capture.height !== stream.info.height) {
        this.#capture = new ProceduralCapture(stream.info.width, stream.info.height);
      }
      const started = performance.now();
      const jpeg = await this.#capture.capture(scene);
      const elapsed = performance.now() - started;
      stream.captureMs = stream.captureMs * 0.9 + elapsed * 0.1;
      if (elapsed > 250) {
        // One bad capture is enough to protect the UI. A later retry is
        // allowed after 30 s so transient GPU pressure can recover.
        this.#capturePausedUntil = performance.now() + 30_000;
        this.#errors = [`! capture slow (${Math.round(elapsed)}ms); camera upload paused`];
      }
      if (elapsed <= 250) stream.sendSource(jpeg, now);
    } catch (err) {
      this.#errors = [`! capture: ${(err as Error).message.slice(0, 48)}`];
    } finally {
      this.#capturing = false;
    }
  }

  #streamLines(): string[] {
    // Sidecar meta is partial by design ({phase:'waiting'} before the first
    // keyframe, {phase:'error'} on a failed frame), so every number is
    // formatted defensively: the HUD must never throw in the frame loop.
    const n = (v: number | undefined | null, digits: number): string =>
      typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '?';
    const s = this.#stream;
    if (!s) return ['', 'stream    off (no streamUrl)'];
    if (s.waiting) return ['', 'stream    another window owns the sidecar; waiting to take over'];
    if (!s.connected) return ['', `stream    connecting ${s.url}  (npm run stream)`];
    const m = s.meta;
    const c = this.#control;
    const scene = this.#scheduler.scene;
    return [
      '',
      `stream    ${s.info?.model ?? '?'} ${s.info?.width ?? '?'}x${s.info?.height ?? '?'}  ${n(m?.fps, 1)} fps  gen ${n(m?.genMs, 0)}ms`,
      `key       ${m?.phase ?? '?'} ${m?.checkpoint ?? ''}  ${n(m ? m.progress * 100 : undefined, 0)}%  change ${n(m?.change, 3)}  jitter ${n(m?.jitter, 3)}`,
      m?.error ? `! sidecar: ${m.error.slice(0, 64)}` : '',
      `paint     ${n(this.#paint, 2)} over ${m?.input ?? '?'}  capture ${n(s.captureMs, 1)}ms  ([ / ] to adjust)`,
      c ? `physics   str ${n(c.strength, 2)} noise ${n(c.noise, 2)} detail ${n(c.detail, 2)} fb ${n(c.feedback, 2)} zoom ${n(c.zoom, 2)}` : '',
      c ? `bends     hue ${n(c.hue, 2)} swell ${n(c.swell, 2)} glass ${n(c.glass, 2)} lurch ${n(c.lurch, 2)}` : '',
      this.#targets ? `h-space   energy ${n(this.#hspace.energy, 2)} light ${n(this.#hspace.light, 2)} organic ${n(this.#hspace.organic, 2)}` : '',
      ...(this.#targets
        ? this.#targets.prompts.map((p, i) => `blend ${n((this.#targets!.weights[i] ?? 0) * 100, 0).padStart(3)}% ${p.slice(0, 64)}`)
        : [scene ? `scene     ${scene.prompt.slice(0, 72)}` : '']),
    ];
  }
}

function sameSceneFingerprint(a: Scene, b: Scene): boolean {
  return (Object.keys(a.fingerprint) as (keyof Scene['fingerprint'])[])
    .every((key) => a.fingerprint[key] === b.fingerprint[key]);
}

export type { AudioSource, TrackContext };
