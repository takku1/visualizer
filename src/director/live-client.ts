import { isLiveLyricUpdate, type LiveLyricUpdate } from './live';
import type { AudioWindow } from '../audio/source';

/** Low-rate transport from the renderer's PCM ring to the local ASR worker. */
export class LiveMeaningClient {
  #url: string;
  #ws: WebSocket | null = null;
  #closed = false;
  #retryMs = 1000;
  #inFlight = false;
  #onUpdate: (update: LiveLyricUpdate) => void;
  updatesReceived = 0;
  hypothesesReceived = 0;
  lastLanguage: string | null = null;
  configuredLanguage: string | null = null;
  workerBuildHash: string | null = null;
  lastRevision: number | null = null;

  constructor(url: string, onUpdate: (update: LiveLyricUpdate) => void) {
    this.#url = url;
    this.#onUpdate = onUpdate;
  }

  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.#closed = false;
    if (this.#ws) return;
    const ws = new WebSocket(this.#url);
    this.#ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const value: unknown = JSON.parse(event.data);
        if (isRecord(value) && value.type === 'meaning-ready') {
          this.configuredLanguage = typeof value.language === 'string' ? value.language : null;
          this.workerBuildHash = typeof value.buildHash === 'string' ? value.buildHash : null;
          if (!this.lastLanguage) this.lastLanguage = this.configuredLanguage;
        }
        if (isLiveLyricUpdate(value)) {
          this.#inFlight = false;
          this.updatesReceived++;
          this.hypothesesReceived += value.hypotheses.length;
          const detected = value.hypotheses[0]?.language;
          if (detected && detected !== 'und') this.lastLanguage = detected;
          this.lastRevision = value.revision;
          this.#onUpdate(value);
        }
      } catch {
        // A malformed optional ASR message must never affect rendering.
      }
    };
    ws.onopen = () => { this.#retryMs = 1000; };
    ws.onclose = () => {
      this.#ws = null;
      this.#inFlight = false;
      this.workerBuildHash = null;
      if (this.#closed) return;
      setTimeout(() => this.connect(), this.#retryMs);
      this.#retryMs = Math.min(this.#retryMs * 2, 10000);
    };
    ws.onerror = () => ws.close();
  }

  telemetry(): { connected: boolean; updates: number; hypotheses: number; language: string | null; configuredLanguage: string | null; workerBuildHash: string | null; revision: number | null } {
    return {
      connected: this.connected,
      updates: this.updatesReceived,
      hypotheses: this.hypothesesReceived,
      language: this.lastLanguage,
      configuredLanguage: this.configuredLanguage,
      workerBuildHash: this.workerBuildHash,
      revision: this.lastRevision,
    };
  }

  close(): void {
    this.#closed = true;
    this.#ws?.close();
    this.#ws = null;
    this.#inFlight = false;
    this.workerBuildHash = null;
  }

  sendWindow(trackId: string, playheadSec: number, window: AudioWindow): void {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.#inFlight || !window.samples.length) return;
    this.#inFlight = true;
    ws.send(JSON.stringify({
      type: 'audio-window',
      trackId,
      playheadSec,
      windowStartSec: Math.max(0, playheadSec - window.samples.length / window.sampleRate),
      sampleRate: window.sampleRate,
      channels: window.channels,
    }));
    ws.send(window.samples.slice().buffer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
