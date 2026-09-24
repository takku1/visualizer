/**
 * Onset strength at a fixed hop, independent of the display frame rate.
 *
 * The render loop samples an AnalyserNode once per animation frame, so every
 * display stall (a slow capture, a GC pause) silently drops onsets, and the
 * onset times inherit the frame jitter. Beat tracking needs neither: it wants
 * an onset detection function (ODF) on a steady clock. This runs inside an
 * AudioWorklet (see `onsetWorkletSource`) at a 10 ms hop and is also plain
 * enough to test in Node.
 *
 * The ODF is log-compressed spectral flux with a small frequency max-filter on
 * the reference frame - the "SuperFlux" recipe (Böck & Widmer, DAFx 2013)
 * without its multi-frame lag. Log compression keeps loud sustained bass from
 * swamping hi-hats and snares; the max-filter suppresses vibrato.
 *
 * SELF-CONTAINED ON PURPOSE: the worklet is built from `OnsetDetector.toString()`,
 * so this class must not reference anything outside its own body.
 */
export class OnsetDetector {
  readonly sampleRate: number;
  readonly hop: number;
  readonly size: number;
  #ring: Float32Array;
  #write = 0;
  #filled = 0;
  #sinceHop = 0;
  #window: Float32Array;
  #re: Float32Array;
  #im: Float32Array;
  #prev: Float32Array;
  #bassBins: number;
  #bins: number;
  #frames = 0;

  constructor(sampleRate: number, hopSec = 0.01, size = 2048) {
    this.sampleRate = sampleRate;
    this.hop = Math.max(64, Math.round(sampleRate * hopSec));
    this.size = size;
    this.#ring = new Float32Array(size);
    this.#window = new Float32Array(size);
    for (let i = 0; i < size; i++) this.#window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    this.#re = new Float32Array(size);
    this.#im = new Float32Array(size);
    // Up to ~11 kHz: above that there is little rhythmic information and a
    // lot of broadband hiss.
    this.#bins = Math.min(size / 2, Math.ceil((11000 / sampleRate) * size));
    this.#prev = new Float32Array(this.#bins);
    this.#bassBins = Math.max(2, Math.ceil((150 / sampleRate) * size));
  }

  /** Seconds of audio represented by one ODF sample. */
  get hopSec(): number {
    return this.hop / this.sampleRate;
  }

  /**
   * Feed mono samples. `onFrame(odf, bassOdf, rms, sampleOffset)` fires once per
   * hop; `sampleOffset` is the index into `samples` just after that hop ended.
   */
  push(samples: Float32Array, onFrame: (odf: number, bassOdf: number, rms: number, sampleOffset: number) => void): void {
    for (let i = 0; i < samples.length; i++) {
      this.#ring[this.#write] = samples[i] ?? 0;
      this.#write = (this.#write + 1) % this.size;
      if (this.#filled < this.size) this.#filled++;
      if (++this.#sinceHop >= this.hop) {
        this.#sinceHop = 0;
        const out = this.#analyze();
        onFrame(out[0], out[1], out[2], i + 1);
      }
    }
  }

  #analyze(): [number, number, number] {
    const n = this.size;
    const re = this.#re;
    const im = this.#im;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const s = this.#ring[(this.#write + i) % n] ?? 0;
      energy += s * s;
      re[i] = s * (this.#window[i] ?? 0);
      im[i] = 0;
    }
    OnsetDetector.fft(re, im);

    let flux = 0;
    let bassFlux = 0;
    const prev = this.#prev;
    const first = this.#frames === 0;
    for (let k = 1; k < this.#bins; k++) {
      const mag = Math.log1p(100 * Math.hypot(re[k] ?? 0, im[k] ?? 0));
      // Reference = max over neighbouring bins of the previous frame.
      const ref = Math.max(prev[k - 1] ?? 0, prev[k] ?? 0, prev[k + 1] ?? 0);
      const rise = mag - ref;
      if (rise > 0 && !first) {
        flux += rise;
        if (k < this.#bassBins) bassFlux += rise;
      }
      // The previous frame's bin k is still needed as the k+1 neighbour of the
      // next iteration's reference, so write it one bin late.
      if (k > 1) prev[k - 1] = this.#pending;
      this.#pending = mag;
    }
    prev[this.#bins - 1] = this.#pending;
    this.#frames++;
    const rms = Math.sqrt(energy / n);
    // An all-but-silent input produces log-domain noise, not onsets.
    if (rms < 1e-4) return [0, 0, rms];
    return [flux / this.#bins, bassFlux / this.#bassBins, rms];
  }

  #pending = 0;

  /** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
  static fft(re: Float32Array, im: Float32Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
        const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j;
          const b = a + len / 2;
          const xr = re[b]! * cr - im[b]! * ci;
          const xi = re[b]! * ci + im[b]! * cr;
          re[b] = re[a]! - xr;
          im[b] = im[a]! - xi;
          re[a] = re[a]! + xr;
          im[a] = im[a]! + xi;
          const nr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = nr;
        }
      }
    }
  }
}

/** One ODF sample, stamped with the audio-clock time at the end of its hop. */
export interface OnsetSample {
  time: number;
  odf: number;
  bassOdf: number;
  rms: number;
}

/**
 * AudioWorklet module source. Built from the class above so the worklet and
 * the tests run the same code, and shipped as a Blob URL because the
 * Spicetify build is a single classic script with nowhere to put a second file.
 * Posts batches of `OnsetSample` roughly every 40 ms.
 */
export function onsetWorkletSource(): string {
  return `const OnsetDetector = ${OnsetDetector.toString()};
class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.detector = new OnsetDetector(sampleRate);
    this.batch = [];
  }
  process(inputs) {
    const input = inputs[0];
    const left = input && input[0];
    if (!left) return true;
    const right = input[1];
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = right ? 0.5 * (left[i] + right[i]) : left[i];
    const blockStart = currentTime;
    this.detector.push(mono, (odf, bassOdf, rms, offset) => {
      this.batch.push({ time: blockStart + offset / sampleRate, odf, bassOdf, rms });
    });
    if (this.batch.length >= 4) {
      this.port.postMessage(this.batch);
      this.batch = [];
    }
    return true;
  }
}
registerProcessor('s1-onset', OnsetProcessor);
`;
}
