import type { FeatureFrame } from '../types';
import type { Scene } from './scenes';
import { hash } from './scenes';

export type CheckpointReason = 'initial' | 'scene' | 'reseed' | 'stagnant';

export interface CheckpointRequest extends Scene {
  id: string;
  reason: CheckpointReason;
  /** Fast-loop frames the latent crossfade lasts. */
  spliceFrames: number;
  timing: TimingReceipt;
}

export interface TimingReceipt {
  source: 'spotify-analysis' | 'onset-inference' | 'fallback-timeout';
  confidence: number;
  requestedTargetBeat: number | null;
  actualCommitTime: number;
  phaseError: number | null;
  fallbackUsed: boolean;
}

/** What the scheduler needs to know about the live stream. */
export interface StreamObservation {
  connected: boolean;
  /** Measured fast-loop frame rate. */
  fps: number;
  /** Sidecar phase: 'idle' when no checkpoint is in flight. */
  phase: string;
  /** Mean per-frame latent change; low for long means the picture has stalled. */
  change: number;
}

export interface SchedulerOptions {
  /** Re-seed the current scene with a new seed after this many bars. Drift bound. */
  barsPerReseed?: number;
  /** Allow periodic/stagnation re-seeds. False keeps one continuous animation state. */
  reseed?: boolean;
  /** Re-seed when the picture has barely changed for this long, seconds. */
  stagnantSec?: number;
  stagnantBelow?: number;
  /** Never checkpoint more often than this, seconds. */
  minGapSec?: number;
  /**
   * false: only the initial keyframe is spliced (the sidecar needs one to
   * start). Scene changes, reseeds and stagnation splices are all off, so the
   * procedural camera alone has to keep the loop grounded
   * (docs/live-knob-direction.md, experiment 1).
   */
  keyframes?: boolean;
}

/**
 * The realization clock: decides *when* a new shot is spliced in, and lands
 * it on a downbeat. The director decides *what* (via `setScene`).
 *
 * Re-seeding remains available for the drift problem, but the application
 * default keeps one continuous diffusion state; callers opt in through
 * `reseed: true` when evaluating long-run drift bounds.
 */
export class CheckpointScheduler {
  readonly barsPerReseed: number;
  readonly reseed: boolean;
  readonly stagnantSec: number;
  readonly stagnantBelow: number;
  readonly minGapSec: number;
  readonly keyframes: boolean;

  #scene: Scene | null = null;
  #current: Scene | null = null;
  #sceneChanged = false;
  #count = 0;
  #bars = 0;
  #lastBarPhase = 0;
  #lastAt = -Infinity;
  #stagnantFor = 0;
  #waitingSince = -1;
  #forced = false;

  constructor(opts: SchedulerOptions = {}) {
    this.barsPerReseed = opts.barsPerReseed ?? 16;
    this.reseed = opts.reseed ?? true;
    this.stagnantSec = opts.stagnantSec ?? 8;
    this.stagnantBelow = opts.stagnantBelow ?? 0.02;
    this.minGapSec = opts.minGapSec ?? 4;
    this.keyframes = opts.keyframes ?? true;
  }

  get scene(): Scene | null {
    return this.#current;
  }

  /** The director's latest scene. A different prompt schedules a splice on the next downbeat. */
  setScene(scene: Scene): void {
    // Compared against what is on screen, so a pending change survives the
    // director repeating itself before the downbeat arrives.
    this.#sceneChanged = !sameSceneMeaning(this.#current, scene);
    this.#scene = scene;
  }

  /**
   * Knob mode's escape hatch: splice this scene on the next downbeat even
   * with keyframes off. For confident hard cuts only; everything else glides.
   */
  cut(scene: Scene): void {
    this.#scene = scene;
    this.#sceneChanged = true;
    this.#forced = true;
  }

  /** Call every frame. Returns a request at most once per checkpoint. */
  update(f: FeatureFrame, s: StreamObservation): CheckpointRequest | null {
    const downbeat = f.barPhase + 0.5 < this.#lastBarPhase;
    this.#lastBarPhase = f.barPhase;
    if (downbeat) this.#bars++;
    if (!s.connected || !this.#scene) return null;

    // A new session always starts clean: the sidecar may hold a previous client's frame.
    if (!this.#current) return this.#emit('initial', f, s, { ...this.#scene, continuity: 0 }, 0, false);

    if (!this.keyframes && !this.#forced) return null;

    this.#stagnantFor = s.phase === 'idle' && s.change < this.stagnantBelow ? this.#stagnantFor + f.dt : 0;
    if (s.phase !== 'idle' || f.t - this.#lastAt < this.minGapSec) return null;

    const reason: CheckpointReason | null = this.#sceneChanged
      ? 'scene'
      : this.reseed && this.#bars >= this.barsPerReseed
        ? 'reseed'
        : this.reseed && this.#stagnantFor >= this.stagnantSec
          ? 'stagnant'
          : null;
    if (!reason) {
      this.#waitingSince = -1;
      return null;
    }

    // Land on a downbeat when the beat grid is trustworthy; otherwise on any
    // beat; and never wait more than two seconds for either.
    if (this.#waitingSince < 0) this.#waitingSince = f.t;
    const trusted = f.hasStructure || f.rhythmConfidence > 0.5;
    const onGrid = trusted ? downbeat : f.onBeat;
    if (!onGrid && f.t - this.#waitingSince < 2) return null;

    const scene = reason === 'scene'
      ? this.#scene
      : { ...this.#scene, seed: hash(`${this.#scene.seed}:${this.#count}`), continuity: Math.max(this.#scene.continuity, 0.6) };
    return this.#emit(reason, f, s, scene, reason === 'scene' ? 1 : 2,
      this.#waitingSince >= 0 && f.t - this.#waitingSince >= 2);
  }

  #emit(reason: CheckpointReason, f: FeatureFrame, s: StreamObservation, scene: Scene, bars: number, fallbackUsed: boolean): CheckpointRequest {
    this.#count++;
    this.#current = scene;
    this.#sceneChanged = false;
    this.#forced = false;
    this.#bars = 0;
    this.#stagnantFor = 0;
    this.#waitingSince = -1;
    this.#lastAt = f.t;
    const secondsPerBar = (60 / Math.max(f.tempo, 40)) * 4;
    const fps = s.fps > 0 ? s.fps : 10;
    const trustedStructure = f.hasStructure;
    const inferredGrid = !trustedStructure && f.rhythmConfidence > 0.5;
    const phase = trustedStructure ? f.barPhase : inferredGrid ? f.beatPhase : null;
    return {
      ...scene,
      id: `k${this.#count}`,
      reason,
      spliceFrames: bars === 0 ? 1 : Math.round(Math.min(Math.max(secondsPerBar * bars * fps, 6), 60)),
      timing: {
        source: trustedStructure ? 'spotify-analysis' : inferredGrid ? 'onset-inference' : 'fallback-timeout',
        confidence: trustedStructure ? 1 : inferredGrid ? Math.max(0, Math.min(1, f.rhythmConfidence)) : 0,
        requestedTargetBeat: trustedStructure || inferredGrid ? f.beatIndex : null,
        actualCommitTime: f.t,
        phaseError: phase == null ? null : Math.min(phase, 1 - phase),
        fallbackUsed,
      },
    };
  }
}

function sameSceneMeaning(a: Scene | null, b: Scene): boolean {
  if (!a) return false;
  return (Object.keys(a.fingerprint) as (keyof Scene['fingerprint'])[])
    .every((key) => a.fingerprint[key] === b.fingerprint[key]);
}
