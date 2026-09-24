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
        if (isLiveLyricUpdate(value)) {
          this.#inFlight = false;
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
      if (this.#closed) return;
      setTimeout(() => this.connect(), this.#retryMs);
      this.#retryMs = Math.min(this.#retryMs * 2, 10000);
    };
    ws.onerror = () => ws.close();
  }

  close(): void {
    this.#closed = true;
    this.#ws?.close();
    this.#ws = null;
    this.#inFlight = false;
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
