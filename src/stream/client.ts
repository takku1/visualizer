import type { SamplerControl } from './control';
import { realizationRequestFromCheckpoint, type CheckpointRequest, type StreamObservation } from './checkpoint';
import type { SongMeaning } from '../director/semantic';
import { isLiveLyricUpdate, type LiveLyricUpdate } from '../director/live';
import type { ContinuousForces } from '../realization/backend';
import type { WorldResonance } from '../world/resonance';

/**
 * Idle observation cadence. The procedural renderer remains 60 Hz; the
 * appearance backend only needs a fresh spatial observation often enough to
 * correct drift. Checkpoints still force their own realization path.
 */
export const PROCEDURAL_SOURCE_INTERVAL_MS = 800;

/** Per-frame header the sidecar prepends to each JPEG. */
export interface StreamMeta {
  frame: number;
  fps: number;
  genMs: number;
  phase: 'idle' | 'denoising' | 'splicing' | 'waiting' | 'error';
  checkpoint: string | null;
  progress: number;
  keyMs: number;
  strength: number;
  change: number;
  drift: number;
  jitter: number;
  /** Current prompt-blend weights (first 40 chars of each prompt), when a blend is active. */
  blend: Record<string, number> | null;
  /** What the loop is painting over: the browser's procedural frame, or the keyframe alone. */
  input: 'procedural' | 'keyframe';
  controlSeq: number;
  width: number;
  height: number;
  error?: string;
  /** Extra sidecar telemetry carried through but not interpreted here. */
  worldDiff: unknown;
  realization: unknown;
  resonance: unknown;
}

/**
 * Procedural camera frames are useful while the sidecar is idle, but they
 * compete with the GPU during its expensive keyframe transition. Deferring
 * them preserves the last valid realization and lets the display stay on its
 * 60 Hz path; the next idle frame will provide a fresh camera source.
 */
export function sourceCaptureAllowed(meta: Pick<StreamMeta, 'phase'> | null): boolean {
  return meta?.phase !== 'splicing' && meta?.phase !== 'denoising';
}

export interface StreamInfo {
  width: number;
  height: number;
  model: string;
  device: string;
  vramMB: number;
  unetBackend?: 'pytorch' | 'tensorrt';
  benderEnabled?: boolean;
  buildHash?: string;
}

/**
 * The browser end of tools/stream-server.py.
 *
 * Controls go out at most `controlHz` times a second and only the latest one
 * matters, so nothing queues. Frames come back as `[u32 headerLen][json][jpeg]`;
 * a frame that finishes decoding after a newer one is dropped. The sidecar
 * reconnects are silent and backed off, so starting the app before the model
 * has loaded is fine.
 */
export class StreamClient {
  #url: string;
  #ws: WebSocket | null = null;
  #retryMs = 500;
  #closed = false;
  #retryTimer: number | null = null;
  #lastControlAt = 0;
  #seq = 0;
  #newestShown = 0;
  #controlInterval: number;
  #sourceSentAt = 0;
  #onFrame: (bitmap: ImageBitmap, meta: StreamMeta) => void;

  info: StreamInfo | null = null;
  /** Latest non-narrative metadata concepts from the sidecar; never song events. */
  concepts: { trackId: string | null; words: string[] } | null = null;
  /** Explicit local meaning manifest; absent means semantic direction abstains. */
  meaning: { trackId: string | null; manifest: SongMeaning } | null = null;
  /** Latest local-ASR update; never used as committed meaning by itself. */
  liveLyrics: LiveLyricUpdate | null = null;
  meta: StreamMeta | null = null;
  framesReceived = 0;
  framesDropped = 0;
  /** Another client owns the sidecar; this one is waiting to take over. */
  waiting = false;
  /** Milliseconds the last procedural capture took (render + JPEG encode). */
  captureMs = 0;

  constructor(url: string, onFrame: (bitmap: ImageBitmap, meta: StreamMeta) => void, controlHz = 30) {
    this.#url = url;
    this.#onFrame = onFrame;
    this.#controlInterval = 1000 / controlHz;
  }

  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN && this.info !== null;
  }

  get url(): string {
    return this.#url;
  }

  observation(): StreamObservation {
    return {
      connected: this.connected,
      fps: this.meta?.fps ?? 0,
      phase: this.meta?.phase ?? 'waiting',
      change: this.meta?.change ?? 1,
    };
  }

  connect(): void {
    if (this.#closed) return;
    this.#closed = false;
    if (this.#ws) return;
    const ws = new WebSocket(this.#url);
    ws.binaryType = 'arraybuffer';
    this.#ws = ws;
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const raw = JSON.parse(e.data) as unknown;
        if (isLiveLyricUpdate(raw)) {
          if (!this.liveLyrics || raw.trackId !== this.liveLyrics.trackId || raw.revision >= this.liveLyrics.revision) {
            this.liveLyrics = raw;
          }
          return;
        }
        const msg = raw as { type: string; trackId?: string | null; words?: string[]; meaning?: SongMeaning } & StreamInfo;
        if (msg.type === 'concepts') {
          this.concepts = { trackId: msg.trackId ?? null, words: msg.words ?? [] };
          console.log(`[stream] song concepts: ${this.concepts.words.join(', ') || '(none)'}`);
          return;
        }
        if (msg.type === 'meaning') {
          if (msg.meaning) {
            this.meaning = { trackId: msg.trackId ?? null, manifest: msg.meaning };
            console.log(`[stream] local song meaning revision ${msg.meaning.revision}`);
          } else {
            this.meaning = null;
            console.log('[stream] sidecar has no local meaning manifest; renderer lyric evidence may still provide direction');
          }
          return;
        }
        if (msg.type === 'ready') {
          this.info = msg;
          this.waiting = false;
          this.#retryMs = 500;
          console.log(`[stream] connected: ${msg.model} ${msg.width}x${msg.height} on ${msg.device} (${msg.vramMB} MB, build ${msg.buildHash ?? 'unknown'})`);
        }
        return;
      }
      void this.#receive(e.data as ArrayBuffer);
    };
    ws.onclose = (e) => {
      if (this.info) console.warn('[stream] disconnected');
      this.#ws = null;
      this.info = null;
      this.concepts = null;
      this.meaning = null;
      this.liveLyrics = null;
      // Do not expose the last sidecar frame as current generation telemetry.
      // The procedural renderer may continue, but realization is disconnected.
      this.meta = null;
      if (this.#closed) return;
      if (e.reason.startsWith('busy')) {
        // The sidecar has one driver and it is someone else. Retry calmly:
        // when that client leaves, this one takes over.
        if (!this.waiting) console.warn('[stream] another client owns the sidecar; waiting');
        this.waiting = true;
        this.#scheduleRetry(3000);
        return;
      }
      this.#scheduleRetry(this.#retryMs);
      this.#retryMs = Math.min(this.#retryMs * 2, 5000);
    };
    ws.onerror = () => ws.close();
  }

  close(): void {
    this.#closed = true;
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#ws?.close();
    this.#ws = null;
    this.info = null;
    this.liveLyrics = null;
    this.meta = null;
  }

  #scheduleRetry(delayMs: number): void {
    if (this.#closed || this.#retryTimer !== null) return;
    this.#retryTimer = window.setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#closed) this.connect();
    }, delayMs);
  }

  /** Send the latest sampler control; rate-limited, never queued. */
  sendControl(c: SamplerControl, now: number, resonance: WorldResonance | null = null): void {
    if (!this.connected || now - this.#lastControlAt < this.#controlInterval) return;
    this.#lastControlAt = now;
    this.#ws!.send(JSON.stringify({ type: 'control', seq: ++this.#seq, ...c, resonance: resonance ?? undefined }));
  }

  /**
   * Whether a new procedural source frame should be sent now. One in flight:
   * the next goes out when a stream frame comes back (the sidecar consumed
   * the last one) or after the source interval, so a stall never wedges the
   * pipeline. Painted frames do not reset this timer: a returned keyframe is
   * not evidence that the procedural source was consumed.
   */
  wantsSource(now: number): boolean {
    return this.connected && now - this.#sourceSentAt > PROCEDURAL_SOURCE_INTERVAL_MS;
  }

  /** Send the procedural scene frame (JPEG) the sidecar paints over. */
  sendSource(jpeg: ArrayBuffer, now: number): void {
    if (!this.connected) return;
    this.#sourceSentAt = now;
    this.#ws!.send(jpeg);
  }

  /**
   * Continuous prompt travel: the sidecar glides its embedding toward this
   * weighted mix of prompts with time constant `tauSec` (a live knob, not a
   * keyframe splice). An empty list hands the prompt back to keyframes.
   */
  sendBlend(prompts: string[], weights: number[], tauSec: number): void {
    if (!this.connected) return;
    this.#ws!.send(JSON.stringify({ type: 'blend', prompts, weights, tau: tauSec }));
  }

  /** Ask the sidecar for this track's concepts (answered with a 'concepts' message). */
  sendTrack(trackId: string, title: string, artist = ''): void {
    if (!this.connected) return;
    this.#ws!.send(JSON.stringify({ type: 'track', trackId, title, artist }));
  }

  requestCheckpoint(r: CheckpointRequest, continuousForces?: ContinuousForces): void {
    if (!this.connected) return;
    this.#ws!.send(JSON.stringify({
      type: 'checkpoint',
      ...r,
      continuousForces,
      realization: continuousForces ? realizationRequestFromCheckpoint(r, continuousForces) : undefined,
    }));
  }

  async #receive(buf: ArrayBuffer): Promise<void> {
    const view = new DataView(buf);
    const headLen = view.getUint32(0, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headLen))) as StreamMeta;
    this.meta = { ...this.meta, ...meta };
    const jpeg = new Uint8Array(buf, 4 + headLen);
    if (!jpeg.byteLength) return;
    this.framesReceived++;
    if (meta.frame <= this.#newestShown) {
      // Stale frame: drop before the async JPEG decode, which is the
      // expensive step (Blob + createImageBitmap). Counters and liveness
      // semantics above are preserved; only the wasted decode is skipped.
      this.framesDropped++;
      return;
    }
    const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
    if (meta.frame <= this.#newestShown) {
      this.framesDropped++;
      bitmap.close();
      return;
    }
    this.#newestShown = meta.frame;
    this.#onFrame(bitmap, meta);
  }
}
