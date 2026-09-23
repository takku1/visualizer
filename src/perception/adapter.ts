import type { PerceptualState } from './state';
import type { AudioWindow } from '../audio/source';

/** The learned checkpoint seam. Adapters run at track/section cadence, never per frame. */
export interface LearnedAudioPerception {
  readonly name: string;
  readonly version: string;
  readonly configured: boolean;
  embed(input: PerceptualState, audio?: AudioWindow | null): Promise<PerceptualState['learned']>;
  /** Optional operational counters for session telemetry. */
  telemetry?(): PerceptionTelemetry;
}

export interface PerceptionTelemetry {
  configured: boolean;
  requests: number;
  successes: number;
  failures: number;
  lastMs: number;
  lastModel: string;
  lastVectorLength: number;
}

/** Explicit no-op adapter for offline playback and deterministic A/B runs. */
export class DisabledAudioPerception implements LearnedAudioPerception {
  readonly name = 'disabled';
  readonly version = 'none';
  readonly configured = false;

  async embed(_input: PerceptualState, _audio?: AudioWindow | null): Promise<PerceptualState['learned']> {
    return null;
  }

  telemetry(): PerceptionTelemetry {
    return { configured: false, requests: 0, successes: 0, failures: 0, lastMs: 0, lastModel: 'none', lastVectorLength: 0 };
  }
}

/** Optional sidecar adapter, sampled at semantic-decision cadence only. */
export class SidecarAudioPerception implements LearnedAudioPerception {
  readonly name = 'audio-perception-sidecar';
  readonly version = 'http-v1';
  readonly configured = true;
  #requests = 0;
  #successes = 0;
  #failures = 0;
  #lastMs = 0;
  #lastModel = 'none';
  #lastVectorLength = 0;

  constructor(
    private readonly endpoint = 'http://127.0.0.1:8767/v1/audio-perception',
    private readonly timeoutMs = 4000,
  ) {}

  async embed(input: PerceptualState, audio?: AudioWindow | null): Promise<PerceptualState['learned']> {
    this.#requests++;
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input,
          ...(audio ? { audio: { sampleRate: audio.sampleRate, channels: audio.channels, samples: Array.from(audio.samples) } } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`audio perception sidecar returned ${response.status}`);
      const result = await response.json() as { learned?: PerceptualState['learned'] };
      if (!validLearned(result.learned)) {
        this.#failures++;
        return null;
      }
      this.#successes++;
      this.#lastModel = `${result.learned.model}@${result.learned.version}`;
      this.#lastVectorLength = result.learned.vector.length;
      return result.learned;
    } catch (err) {
      this.#failures++;
      throw err;
    } finally {
      this.#lastMs = Math.round(performance.now() - started);
      clearTimeout(timer);
    }
  }

  telemetry(): PerceptionTelemetry {
    return {
      configured: true,
      requests: this.#requests,
      successes: this.#successes,
      failures: this.#failures,
      lastMs: this.#lastMs,
      lastModel: this.#lastModel,
      lastVectorLength: this.#lastVectorLength,
    };
  }
}

function validLearned(value: PerceptualState['learned'] | undefined): value is NonNullable<PerceptualState['learned']> {
  return Boolean(
    value && value.kind === 'audio-embedding' && value.model && value.version
      && Array.isArray(value.vector) && value.vector.length > 0 && value.vector.length <= 4096
      && value.vector.every((entry) => Number.isFinite(entry)),
  );
}
