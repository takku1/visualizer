/**
 * Causal beat tracker over a fixed-rate onset detection function (ODF).
 *
 * Replaces the onset-interval clock, which had two failures seen in live
 * sessions: tempo from inter-onset gaps wanders on syncopated or expressive
 * music (113 -> 61 BPM within one song), and the phase free-ran at that
 * tempo with no correction, so even a right tempo drifted off the beat.
 *
 * Method, in the lineage of Davies & Plumbley (2007, context-dependent beat
 * tracking) and BTrack (Stark, Davies & Plumbley, DAFx 2009):
 *  - tempo: autocorrelation of the adaptively-thresholded ODF, a shift-invariant
 *    comb over the first four multiples of each lag, a log-Gaussian prior
 *    around 120 BPM, and a Viterbi-style transition that keeps the tempo from
 *    hopping between metrical levels;
 *  - phase: a decaying comb template over the last few beats of the ODF;
 *  - clock: a phase-locked loop that nudges the running beat grid toward each
 *    phase estimate instead of jumping, so the visuals never stutter;
 *  - downbeat: bass onset energy per beat-in-bar position, the strongest
 *    being "1". Weak evidence, reported with its own confidence.
 *
 * Confidence is honest by construction: it multiplies tempo salience (how
 * much the chosen lag stands out), tempo stability (recent estimates agree)
 * and phase contrast (the grid actually lines up with onsets). Silence,
 * rubato and beatless ambient music all read low, and downstream code must
 * then fall back to onset-driven, not grid-driven, motion.
 */

export interface BeatEstimate {
  tempo: number;
  /** 0..1 position within the current beat. */
  beatPhase: number;
  /** 0..1 position within the current bar (4 beats). */
  barPhase: number;
  beatIndex: number;
  /** 0..1: how far to trust tempo and phase together. */
  confidence: number;
  /** 0..1: how far to trust which beat is the downbeat. */
  downbeatConfidence: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 0.75;
const HISTORY_SEC = 8;
const ANALYSIS_SEC = 6;
const UPDATE_EVERY_SEC = 0.25;
const PHASE_BEATS = 6;
const PLL_GAIN = 0.35;

export class BeatTracker {
  readonly rate: number;
  #odf: Float32Array;
  #bass: Float32Array;
  #write = 0;
  #count = 0;
  #sinceUpdate = 0;

  // Tempo state: a score per candidate lag, carried between updates.
  #lagMin: number;
  #lagMax: number;
  #tempoScore: Float64Array;
  #period = 0; // seconds per beat; 0 until the first estimate
  #recentPeriods: number[] = [];

  // The running beat grid: a beat landed at `#anchor` (audio seconds) with index `#anchorIndex`.
  #anchor = 0;
  #anchorIndex = 0;
  #confidence = 0;

  // Downbeat evidence: bass onset energy at each beat-in-bar slot.
  #slot = new Float64Array(4);
  #lastSlotBeat = -1;
  #downbeatOffset = 0;
  #downbeatConfidence = 0;

  constructor(rate = 100) {
    this.rate = rate;
    const n = Math.round(rate * HISTORY_SEC);
    this.#odf = new Float32Array(n);
    this.#bass = new Float32Array(n);
    this.#lagMin = Math.floor((60 / MAX_BPM) * rate);
    this.#lagMax = Math.ceil((60 / MIN_BPM) * rate);
    this.#tempoScore = new Float64Array(this.#lagMax + 1);
  }

  reset(): void {
    this.#odf.fill(0);
    this.#bass.fill(0);
    this.#write = 0;
    this.#count = 0;
    this.#sinceUpdate = 0;
    this.#tempoScore.fill(0);
    this.#period = 0;
    this.#recentPeriods = [];
    this.#anchor = 0;
    this.#anchorIndex = 0;
    this.#confidence = 0;
    this.#slot.fill(0);
    this.#lastSlotBeat = -1;
    this.#downbeatOffset = 0;
    this.#downbeatConfidence = 0;
  }

  get confidence(): number {
    return this.#confidence;
  }

  /** Add one ODF sample whose hop ended at `time` (audio-clock seconds). */
  push(time: number, odf: number, bassOdf = 0): void {
    const n = this.#odf.length;
    this.#odf[this.#write] = Number.isFinite(odf) ? Math.max(0, odf) : 0;
    this.#bass[this.#write] = Number.isFinite(bassOdf) ? Math.max(0, bassOdf) : 0;
    this.#write = (this.#write + 1) % n;
    this.#count = Math.min(this.#count + 1, n);
    this.#sinceUpdate += 1 / this.rate;
    if (this.#sinceUpdate >= UPDATE_EVERY_SEC) {
      this.#sinceUpdate = 0;
      this.#update(time);
    }
  }

  /** The beat grid evaluated at `time` (audio-clock seconds). */
  estimate(time: number): BeatEstimate {
    if (this.#period <= 0) {
      return { tempo: PRIOR_BPM, beatPhase: 0, barPhase: 0, beatIndex: 0, confidence: 0, downbeatConfidence: 0 };
    }
    const beats = (time - this.#anchor) / this.#period;
    const whole = Math.floor(beats);
    const beatIndex = this.#anchorIndex + whole;
    const beatPhase = beats - whole;
    const inBar = (((beatIndex - this.#downbeatOffset) % 4) + 4) % 4;
    return {
      tempo: 60 / this.#period,
      beatPhase,
      barPhase: (inBar + beatPhase) / 4,
      beatIndex,
      confidence: this.#confidence,
      downbeatConfidence: this.#downbeatConfidence,
    };
  }

  /** Oldest-first copy of the last `len` samples of a ring. */
  #recent(ring: Float32Array, len: number): Float32Array {
    const n = ring.length;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = ring[(this.#write - len + i + n * 2) % n] ?? 0;
    return out;
  }

  #update(now: number): void {
    const len = Math.min(this.#count, Math.round(this.rate * ANALYSIS_SEC));
    // Need at least two slow beats plus some context before saying anything.
    if (len < this.#lagMax * 2.5) return;
    const raw = this.#recent(this.#odf, len);
    const x = adaptiveThreshold(raw, Math.round(this.rate * 0.08));
    let energy = 0;
    for (let i = 0; i < len; i++) energy += (x[i] ?? 0) ** 2;
    if (energy < 1e-9) {
      this.#decayConfidence();
      return;
    }

    // ---- tempo ----
    const maxLag = Math.min(len - 1, this.#lagMax * 4 + 3);
    const acf = new Float64Array(maxLag + 1);
    for (let lag = 1; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = lag; i < len; i++) s += (x[i] ?? 0) * (x[i - lag] ?? 0);
      acf[lag] = s / (len - lag); // unbiased: long lags are not penalised for having fewer terms
    }
    const comb = new Float64Array(this.#lagMax + 1);
    let combSum = 0;
    let combCount = 0;
    for (let lag = this.#lagMin; lag <= this.#lagMax; lag++) {
      let c = 0;
      for (let k = 1; k <= 4; k++) {
        let best = 0;
        let sum = 0;
        for (let j = -(k - 1); j <= k - 1; j++) {
          const v = acf[k * lag + j] ?? 0;
          sum += v;
          best = Math.max(best, v);
        }
        c += 0.5 * best + 0.5 * (sum / (2 * k - 1));
      }
      const bpm = (60 * this.rate) / lag;
      const octaves = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;
      comb[lag] = Math.max(0, c) * Math.exp(-0.5 * octaves * octaves);
      combSum += comb[lag]!;
      combCount++;
    }
    const combMean = combSum / Math.max(combCount, 1);

    // Viterbi-style carry: each lag keeps the best nearby previous score, so a
    // tempo needs sustained evidence to take over from the current one.
    const next = new Float64Array(this.#lagMax + 1);
    let bestLag = this.#lagMin;
    let bestScore = -1;
    const norm = combMean > 0 ? combMean : 1;
    for (let lag = this.#lagMin; lag <= this.#lagMax; lag++) {
      let carry = 0;
      const width = Math.max(1, lag * 0.06);
      for (let prev = Math.max(this.#lagMin, Math.floor(lag - 3 * width)); prev <= Math.min(this.#lagMax, Math.ceil(lag + 3 * width)); prev++) {
        const d = (prev - lag) / width;
        carry = Math.max(carry, (this.#tempoScore[prev] ?? 0) * Math.exp(-0.5 * d * d));
      }
      const score = 0.7 * carry + (comb[lag] ?? 0) / norm;
      next[lag] = score;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    this.#tempoScore = next;
    const salience = clamp01(((comb[bestLag] ?? 0) / norm - 1.3) / 1.7);

    // Sub-sample refinement of the lag on the comb curve.
    const a = comb[bestLag - 1] ?? 0;
    const b = comb[bestLag] ?? 0;
    const c = comb[bestLag + 1] ?? 0;
    const denom = a - 2 * b + c;
    const refined = bestLag + (denom < 0 ? clamp(0.5 * (a - c) / denom, -0.5, 0.5) : 0);
    let period = refined / this.rate;

    // Autocorrelation cannot, by itself, distinguish a beat from a strong
    // subdivision or its double-time interpretation.  On the live Queen
    // trace this appeared as a confident 157 -> 78 BPM flip, which made the
    // same song feel like it had suddenly changed metre.  Once a stable grid
    // exists, keep octave-related candidates on that grid; a genuine tempo
    // change still has to leave the octave neighbourhood before it is
    // accepted.  This is metrical hysteresis, not a hard 120 BPM prior.
    if (this.#period > 0 && this.#confidence > 0.45) {
      const ratio = period / this.#period;
      if (ratio > 1.82 && ratio < 2.2) period *= 0.5;
      else if (ratio > 0.455 && ratio < 0.55) period *= 2;
    }

    this.#recentPeriods.push(period);
    if (this.#recentPeriods.length > 8) this.#recentPeriods.shift();
    const agreeing = this.#recentPeriods.filter((p) => Math.abs(p - period) / period < 0.04).length;
    const stability = this.#recentPeriods.length < 4 ? 0 : agreeing / this.#recentPeriods.length;

    // ---- phase ----
    // Score every offset (in samples back from the newest ODF sample) by the
    // onset strength a beat grid with that offset would sit on.
    const periodSamples = period * this.rate;
    const offsets = Math.max(1, Math.round(periodSamples));
    let bestOffset = 0;
    let bestPhaseScore = -1;
    let phaseSum = 0;
    let phaseSq = 0;
    for (let o = 0; o < offsets; o++) {
      let s = 0;
      for (let k = 0; k < PHASE_BEATS; k++) {
        const pos = len - 1 - o - k * periodSamples;
        if (pos < 1) break;
        s += sampleAt(x, pos) * Math.pow(0.8, k);
      }
      phaseSum += s;
      phaseSq += s * s;
      if (s > bestPhaseScore) {
        bestPhaseScore = s;
        bestOffset = o;
      }
    }
    const phaseMean = phaseSum / offsets;
    const phaseStd = Math.sqrt(Math.max(phaseSq / offsets - phaseMean * phaseMean, 1e-12));
    const contrast = clamp01(((bestPhaseScore - phaseMean) / phaseStd - 1.2) / 1.8);
    const measuredBeat = now - bestOffset / this.rate;

    // ---- clock (PLL) ----
    if (this.#period <= 0 || stability < 0.5 && Math.abs(period - this.#period) / this.#period > 0.15) {
      // First lock, or the tempo has genuinely moved: re-anchor outright.
      const predicted = this.#period > 0 ? this.#anchorIndex + Math.round((measuredBeat - this.#anchor) / this.#period) : 0;
      this.#anchor = measuredBeat;
      this.#anchorIndex = predicted;
      this.#period = period;
    } else {
      // Move the anchor to the beat nearest `now`, then correct toward the measurement.
      const elapsed = Math.floor((now - this.#anchor) / this.#period);
      this.#anchor += elapsed * this.#period;
      this.#anchorIndex += elapsed;
      let error = (measuredBeat - this.#anchor) / this.#period;
      error -= Math.round(error);
      this.#anchor += PLL_GAIN * error * this.#period;
      this.#period += 0.25 * (period - this.#period);
    }

    const target = salience * (0.35 + 0.65 * stability) * (0.4 + 0.6 * contrast);
    this.#confidence += (target - this.#confidence) * 0.35;
    this.#updateDownbeat(now);
  }

  #decayConfidence(): void {
    this.#confidence *= 0.7;
    this.#downbeatConfidence *= 0.7;
  }

  /** Accumulate bass onset energy per beat-in-bar slot, once per new beat. */
  #updateDownbeat(now: number): void {
    const est = this.estimate(now);
    if (est.beatIndex === this.#lastSlotBeat || this.#period <= 0) return;
    // Look at the most recent completed beat: bass ODF within ±60 ms of it.
    const beatTime = now - est.beatPhase * this.#period;
    const window = Math.round(0.06 * this.rate);
    const centre = this.#count - 1 - Math.round((now - beatTime) * this.rate);
    const len = Math.min(this.#count, this.#bass.length);
    const bass = this.#recent(this.#bass, len);
    let energy = 0;
    for (let i = centre - window; i <= centre + window; i++) energy = Math.max(energy, bass[i - (this.#count - len)] ?? 0);
    const slot = ((est.beatIndex % 4) + 4) % 4;
    for (let s = 0; s < 4; s++) this.#slot[s] = (this.#slot[s] ?? 0) * 0.97;
    this.#slot[slot] = (this.#slot[slot] ?? 0) + energy;
    this.#lastSlotBeat = est.beatIndex;

    let best = 0;
    let total = 0;
    for (let s = 0; s < 4; s++) {
      total += this.#slot[s] ?? 0;
      if ((this.#slot[s] ?? 0) > (this.#slot[best] ?? 0)) best = s;
    }
    const share = total > 0 ? (this.#slot[best] ?? 0) / total : 0;
    // 0.25 is no preference; a clear kick-on-one pattern sits well above 0.4.
    const contrast = clamp01((share - 0.3) / 0.2);
    // Only move the downbeat when the evidence is decisive, so bars do not flip.
    if (contrast > 0.5) this.#downbeatOffset = best;
    this.#downbeatConfidence = contrast * this.#confidence;
  }
}

/** Subtract a centred moving mean and half-wave rectify (peaks above the local level). */
function adaptiveThreshold(x: Float32Array, half: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    while (hi < Math.min(n - 1, i + half)) sum += x[++hi] ?? 0;
    while (lo < i - half) sum -= x[lo++] ?? 0;
    const mean = sum / (hi - lo + 1);
    const v = (x[i] ?? 0) - mean;
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

function sampleAt(x: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  const f = pos - i;
  // A beat grid rarely lands exactly on the onset sample: take the local max
  // over a ±1 sample neighbourhood, interpolated.
  const a = Math.max(x[i - 1] ?? 0, x[i] ?? 0);
  const b = Math.max(x[i + 1] ?? 0, x[i] ?? 0);
  return a + (b - a) * f;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
