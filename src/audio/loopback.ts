import type { FeatureFrame } from '../types';
import { type AudioSource, type AudioWindow, BINS, AutoGain, smooth } from './source';

/**
 * Real spectrum, captured from whatever the machine is playing.
 *
 * Spotify's playback is DRM-protected, so there is no AudioContext node to tap
 * and no way to read its samples directly. Screen capture is the documented
 * path to system audio in a browser: the user picks a tab or the whole screen
 * and ticks "share audio", and we take the audio track and discard the video.
 *
 * Chrome will not offer an audio checkbox for an audio-only request, so we
 * must ask for video as well and immediately stop the video track. This looks
 * wasteful and is not: without it, `getDisplayMedia` returns no audio at all.
 */
export class LoopbackSource implements AudioSource {
  readonly name = 'loopback';

  #ctx: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #analyserL: AnalyserNode | null = null;
  #analyserR: AnalyserNode | null = null;
  #stream: MediaStream | null = null;

  #freq = new Float32Array(BINS);
  #prevMag = new Float32Array(BINS);
  /** Positive delta per bin, captured once per frame before #prevMag is overwritten. */
  #posDelta = new Float32Array(BINS);
  #raw = new Float32Array(BINS);
  #norm = new Float32Array(BINS);
  #timeL = new Float32Array(1024);
  #timeR = new Float32Array(1024);
  #timeMono = new Float32Array(2048);
  #audioRing = new Float32Array(16000 * 6);
  #audioWrite = 0;
  #audioCount = 0;
  #audioRms = 0;
  #chroma = new Float32Array(12);

  // Each band gets its own gain, tracking its own history. A single shared
  // peak (the earlier approach) is wrong for anything but the spectrum
  // texture's visuals: real music's linear FFT magnitude rolls off toward
  // high frequencies almost regardless of genre, so the loudest bin is
  // consistently in the bass. Normalizing every band against that one peak
  // structurally crushes treble toward zero no matter how audible it is -
  // it was never an audio problem, it was this normalization choice.
  #gain = {
    level: new AutoGain(), flux: new AutoGain(0.5),
    bass: new AutoGain(), lowMid: new AutoGain(), mid: new AutoGain(),
    highMid: new AutoGain(), treble: new AutoGain(),
    bassFlux: new AutoGain(0.5), trebleFlux: new AutoGain(0.5),
  };
  #bands = {
    bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, level: 0, flux: 0, centroid: 0,
    bassFlux: 0, trebleFlux: 0, width: 0,
  };
  #ready = false;

  get ready(): boolean {
    return this.#ready;
  }

  /** True once the capture has been granted; used to drive the HUD prompt. */
  get capturing(): boolean {
    return this.#stream?.active ?? false;
  }

  /** Recent PCM energy, distinct from a merely active capture permission. */
  get audioRms(): number {
    return this.#audioRms;
  }

  get hasAudioSignal(): boolean {
    return this.#audioRms >= 0.003;
  }

  /** Return the most recent six seconds at the model-friendly 16 kHz rate. */
  audioWindow(): AudioWindow | null {
    if (!this.#audioCount) return null;
    const samples = new Float32Array(this.#audioCount);
    const start = (this.#audioWrite - this.#audioCount + this.#audioRing.length) % this.#audioRing.length;
    for (let i = 0; i < this.#audioCount; i++) samples[i] = this.#audioRing[(start + i) % this.#audioRing.length] ?? 0;
    return { sampleRate: 16000, channels: 1, samples };
  }

  async start(): Promise<void> {
    if (this.#stream?.active) return;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        // Every hint that would "clean up" a voice call destroys music.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: true,
    });

    const [audio] = stream.getAudioTracks();
    if (!audio) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio track in the capture. Re-share and tick "Share tab audio" / "Share system audio".');
    }

    for (const v of stream.getVideoTracks()) v.stop();

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([audio]));

    // Frequency-domain analysis: unchanged, fed from the source directly.
    // AnalyserNode downmixes a stereo input to mono for its own FFT, which is
    // fine here - bands/flux/chroma do not need channel separation.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = BINS * 2;
    // Smoothing is applied per-band below with a proper time constant, so the
    // analyser's own frame-rate-dependent smoothing is left off.
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -95;
    analyser.maxDecibels = -10;
    source.connect(analyser);

    // Stereo width needs the two channels kept apart, which a plain analyser
    // never gives you - so a second, parallel tap splits them before either
    // one reaches an AnalyserNode. A mono source leaves the R tap silent,
    // which the correlation below already treats as width 0, not a NaN.
    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 2048;
    analyserR.fftSize = 2048;
    source.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    await ctx.resume();

    audio.addEventListener('ended', () => this.stop());

    this.#stream = stream;
    this.#ctx = ctx;
    this.#analyser = analyser;
    this.#analyserL = analyserL;
    this.#analyserR = analyserR;
    this.#audioWrite = 0;
    this.#audioCount = 0;
    this.#audioRms = 0;
    this.#audioRing.fill(0);
    this.#ready = true;
  }

  stop(): void {
    this.#stream?.getTracks().forEach((t) => t.stop());
    void this.#ctx?.close();
    this.#stream = null;
    this.#ctx = null;
    this.#analyser = null;
    this.#analyserL = null;
    this.#analyserR = null;
    this.#audioWrite = 0;
    this.#audioCount = 0;
    this.#ready = false;
  }

  sample(frame: FeatureFrame, _now: number): void {
    const analyser = this.#analyser;
    if (!analyser) return;

    analyser.getFloatFrequencyData(this.#freq);
    analyser.getFloatTimeDomainData(this.#timeMono);
    const sourceRate = this.#ctx?.sampleRate ?? 48000;
    const step = sourceRate / 16000;
    const maxNewSamples = Math.max(1, Math.floor(this.#timeMono.length / step));
    const newSamples = Math.min(maxNewSamples, Math.max(1, Math.round(16000 * Math.max(frame.dt, 1 / 240))));
    const sourceSpan = Math.min(this.#timeMono.length, Math.ceil(newSamples * step));
    const sourceStart = this.#timeMono.length - sourceSpan;
    let squareSum = 0;
    for (let i = 0; i < newSamples; i++) {
      const sourceIndex = sourceStart + Math.min(sourceSpan - 1, Math.floor(i * sourceSpan / newSamples));
      const sample = this.#timeMono[sourceIndex] ?? 0;
      squareSum += sample * sample;
      this.#audioRing[this.#audioWrite] = sample;
      this.#audioWrite = (this.#audioWrite + 1) % this.#audioRing.length;
      this.#audioCount = Math.min(this.#audioCount + 1, this.#audioRing.length);
    }
    this.#audioRms = Math.sqrt(squareSum / Math.max(newSamples, 1));
    const dt = Math.max(frame.dt, 1 / 240);
    const nyquist = (this.#ctx?.sampleRate ?? 48000) / 2;

    // dB to linear, and positive spectral flux in the same pass.
    let flux = 0;
    let sum = 0;
    for (let i = 0; i < BINS; i++) {
      const db = this.#freq[i] ?? -100;
      const mag = db <= -100 ? 0 : 10 ** (db / 20);
      const prev = this.#prevMag[i] ?? 0;
      const delta = mag > prev ? mag - prev : 0;
      flux += delta;
      this.#posDelta[i] = delta;
      this.#prevMag[i] = mag;
      this.#raw[i] = mag;
      this.#norm[i] = mag;
      sum += mag;
    }

    // Normalize the spectrum texture against its own peak so the visuals stay
    // legible across wildly different masters. This copy (#norm) is for the
    // shader only; #raw stays untouched for the per-band descriptive values
    // below, which need their own independent normalization instead.
    let peak = 0;
    for (let i = 0; i < BINS; i++) peak = Math.max(peak, this.#norm[i] ?? 0);
    if (peak > 0) for (let i = 0; i < BINS; i++) this.#norm[i] = (this.#norm[i] ?? 0) / peak;

    // Spectral centroid: the energy-weighted mean bin, normalized to 0..1.
    // Where bass/mid/treble say how loud each region is, this says where the
    // balance of the sound actually sits - a dark, bass-heavy mix and a thin,
    // treble-forward one can carry the same broadband level and read
    // completely differently here.
    let centroidNum = 0;
    let centroidDen = 0;
    let logSum = 0;
    let rolloffTarget = sum * 0.85;
    let rolloffAccum = 0;
    let rolloffBin = BINS - 1;
    for (let i = 0; i < BINS; i++) {
      const m = this.#raw[i] ?? 0;
      centroidNum += i * m;
      centroidDen += m;
      logSum += Math.log(Math.max(m, 1e-8));
      rolloffAccum += m;
      if (rolloffAccum >= rolloffTarget && rolloffBin === BINS - 1) rolloffBin = i;
    }
    const centroidRaw = centroidDen > 0 ? centroidNum / centroidDen / BINS : 0;
    const arithmeticMean = sum / Math.max(BINS, 1);
    const geometricMean = Math.exp(logSum / Math.max(BINS, 1));
    const flatnessRaw = arithmeticMean > 1e-8 ? geometricMean / arithmeticMean : 0;
    const rolloffRaw = rolloffBin / Math.max(BINS - 1, 1);

    const b = this.#bands;
    b.bass = smooth(b.bass, this.#band(20, 120, nyquist, this.#gain.bass, dt), dt, 0.06);
    b.lowMid = smooth(b.lowMid, this.#band(120, 500, nyquist, this.#gain.lowMid, dt), dt, 0.08);
    b.mid = smooth(b.mid, this.#band(500, 2000, nyquist, this.#gain.mid, dt), dt, 0.1);
    b.highMid = smooth(b.highMid, this.#band(2000, 6000, nyquist, this.#gain.highMid, dt), dt, 0.12);
    b.treble = smooth(b.treble, this.#band(6000, 16000, nyquist, this.#gain.treble, dt), dt, 0.14);
    b.level = smooth(b.level, this.#gain.level.push(sum / BINS, dt), dt, 0.12);
    b.flux = smooth(b.flux, this.#gain.flux.push(flux, dt), dt, 0.04);
    b.centroid = smooth(b.centroid, centroidRaw, dt, 0.15);

    // Per-band onset: the same positive-delta trick as global flux, but
    // restricted to one frequency range, so a kick drum and a hi-hat produce
    // distinguishable onsets instead of collapsing into one number.
    b.bassFlux = smooth(b.bassFlux, this.#bandFlux(20, 150, nyquist, this.#gain.bassFlux, dt), dt, 0.05);
    b.trebleFlux = smooth(b.trebleFlux, this.#bandFlux(4000, 14000, nyquist, this.#gain.trebleFlux, dt), dt, 0.05);

    // Chromagram: fold spectral energy into 12 pitch classes by mapping each
    // bin's frequency to the nearest equal-tempered note. Bounded to a
    // musical range so sub-bass rumble and hiss above ~5kHz - neither of
    // which carries reliable pitch information - do not dominate the fold.
    const chroma = this.#chroma;
    for (let i = 0; i < 12; i++) chroma[i] = (chroma[i] ?? 0) * 0.85; // decay before re-accumulating
    const loBin = Math.max(1, Math.floor((55 / nyquist) * BINS));
    const hiBin = Math.min(BINS, Math.ceil((5000 / nyquist) * BINS));
    for (let i = loBin; i < hiBin; i++) {
      const freqHz = (i / BINS) * nyquist;
      const midi = 69 + 12 * Math.log2(freqHz / 440);
      const pc = (((Math.round(midi) % 12) + 12) % 12);
      chroma[pc] = (chroma[pc] ?? 0) + (this.#raw[i] ?? 0);
    }
    const { key, mode, confidence } = estimateKey(chroma);

    // Stereo width from the L/R time-domain correlation: identical channels
    // (mono content, or a mono source) correlate near 1 and read as width 0;
    // decorrelated channels (real stereo mixing/reverb) pull it up.
    let width = 0;
    if (this.#analyserL && this.#analyserR) {
      this.#analyserL.getFloatTimeDomainData(this.#timeL);
      this.#analyserR.getFloatTimeDomainData(this.#timeR);
      let num = 0, denL = 0, denR = 0;
      for (let i = 0; i < this.#timeL.length; i++) {
        const l = this.#timeL[i] ?? 0;
        const r = this.#timeR[i] ?? 0;
        num += l * r;
        denL += l * l;
        denR += r * r;
      }
      const corr = denL > 1e-8 && denR > 1e-8 ? num / Math.sqrt(denL * denR) : 1;
      width = Math.min(Math.max(1 - Math.max(corr, 0), 0), 1);
    }
    b.width = smooth(b.width, width, dt, 0.2);

    frame.spectralCentroid = b.centroid;
    frame.spectralFlatness = Math.min(Math.max(flatnessRaw, 0), 1);
    frame.spectralRolloff = Math.min(Math.max(rolloffRaw, 0), 1);
    frame.harmonicity = Math.min(Math.max(1 - frame.spectralFlatness, 0), 1);
    frame.transientness = Math.min(Math.max(flux / Math.max(sum, 1e-6), 0), 1);
    frame.bass = b.bass;
    frame.lowMid = b.lowMid;
    frame.mid = b.mid;
    frame.highMid = b.highMid;
    frame.treble = b.treble;
    frame.level = b.level;
    frame.flux = b.flux;
    frame.bassFlux = b.bassFlux;
    frame.trebleFlux = b.trebleFlux;
    frame.stereoWidth = b.width;
    frame.chroma = chroma;
    frame.estimatedKey = key;
    frame.estimatedMode = mode;
    frame.keyConfidence = confidence;
    frame.spectrum = this.#norm;
  }

  /**
   * Mean raw magnitude across a frequency range, run through that band's own
   * `AutoGain` so it uses the full 0..1 range against its own recent history
   * - not against whichever band happens to be loudest in absolute terms.
   */
  #band(loHz: number, hiHz: number, nyquist: number, gain: AutoGain, dt: number): number {
    const lo = Math.max(0, Math.floor((loHz / nyquist) * BINS));
    const hi = Math.min(BINS, Math.ceil((hiHz / nyquist) * BINS));
    if (hi <= lo) return 0;
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += this.#raw[i] ?? 0;
    return gain.push(sum / (hi - lo), dt);
  }

  /**
   * Positive-delta onset energy within one frequency range, gain-controlled.
   * Reads `#posDelta`, captured once per frame in `sample()` before
   * `#prevMag` gets overwritten with the current values - comparing against
   * `#prevMag` here directly would compare this frame against itself.
   */
  #bandFlux(loHz: number, hiHz: number, nyquist: number, gain: AutoGain, dt: number): number {
    const lo = Math.max(0, Math.floor((loHz / nyquist) * BINS));
    const hi = Math.min(BINS, Math.ceil((hiHz / nyquist) * BINS));
    if (hi <= lo) return 0;
    let flux = 0;
    for (let i = lo; i < hi; i++) flux += this.#posDelta[i] ?? 0;
    return gain.push(flux, dt);
  }
}

/** Standard Krumhansl-Kessler key profiles, C-rooted. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Correlates a chromagram against all 24 rotated major/minor key profiles
 * and returns the best match. This is a well-known, well-worn technique
 * (Krumhansl-Schmuckler) chosen deliberately over anything fancier: it is
 * cheap, has no training step, and its failure modes are well understood.
 * Treat the result as a rough lean, not a transcription - short windows and
 * heavily produced music both degrade it.
 */
function estimateKey(chroma: Float32Array): { key: number; mode: 'major' | 'minor'; confidence: number } {
  let bestScore = -Infinity;
  let bestKey = 0;
  let bestMode: 'major' | 'minor' = 'major';

  for (let root = 0; root < 12; root++) {
    for (const [profile, mode] of [[MAJOR_PROFILE, 'major'], [MINOR_PROFILE, 'minor']] as const) {
      let dot = 0, cNorm = 0, pNorm = 0;
      for (let i = 0; i < 12; i++) {
        const c = chroma[i] ?? 0;
        const p = profile[(i - root + 12) % 12] ?? 0;
        dot += c * p;
        cNorm += c * c;
        pNorm += p * p;
      }
      const score = cNorm > 0 && pNorm > 0 ? dot / Math.sqrt(cNorm * pNorm) : 0;
      if (score > bestScore) {
        bestScore = score;
        bestKey = root;
        bestMode = mode;
      }
    }
  }

  return { key: bestKey, mode: bestMode, confidence: Math.min(Math.max(bestScore, 0), 1) };
}
