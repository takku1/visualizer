import type { FeatureFrame } from '../types';
import type {
  FeelEstimate, MeterHypothesis, RhythmEvidence, RhythmicEvent, RhythmicLayer,
  RhythmicStructure, RhythmObservation, Subdivision, TempoHypothesis,
} from './types';

const MAX_HISTORY = 48;
const ONSET_COOLDOWN = 0.12;
const EPSILON = 1e-6;

/**
 * Stateful, provider-independent rhythm interpretation.
 *
 * This is deliberately conservative: it reports competing interpretations and
 * confidence instead of pretending that a single BPM explains every track.
 * The public seam is `update`; all detector state stays inside this module.
 */
export class RhythmAnalyzer {
  #lastT = 0;
  #lastOnset = -Infinity;
  #lastBassOnset = -Infinity;
  #lastTrebleOnset = -Infinity;
  #lastBeatPhase = 0;
  #lastBarPhase = 0;
  #pulseBpm = 120;
  #pulseConfidence = 0;
  #intervals: number[] = [];
  #bassIntervals: number[] = [];
  #trebleIntervals: number[] = [];
  #onsetTimes: number[] = [];
  #bassTimes: number[] = [];
  #trebleTimes: number[] = [];
  #previous: RhythmicStructure = emptyStructure();

  get structure(): RhythmicStructure {
    return this.#previous;
  }

  reset(): void {
    this.#lastT = 0;
    this.#lastOnset = -Infinity;
    this.#lastBassOnset = -Infinity;
    this.#lastTrebleOnset = -Infinity;
    this.#lastBeatPhase = 0;
    this.#lastBarPhase = 0;
    this.#pulseBpm = 120;
    this.#pulseConfidence = 0;
    this.#intervals = [];
    this.#bassIntervals = [];
    this.#trebleIntervals = [];
    this.#onsetTimes = [];
    this.#bassTimes = [];
    this.#trebleTimes = [];
    this.#previous = emptyStructure();
  }

  update(frame: FeatureFrame, timeSignature?: number): RhythmicStructure {
    return this.observe({
      t: frame.t, dt: frame.dt, flux: frame.flux, bassFlux: frame.bassFlux,
      trebleFlux: frame.trebleFlux, level: frame.level,
      beatPhase: frame.beatPhase, barPhase: frame.barPhase, tempo: frame.tempo,
      confidence: frame.confidence, hasStructure: frame.hasStructure,
    }, timeSignature);
  }

  observe(input: RhythmObservation, timeSignature?: number): RhythmicStructure {
    const t = Number.isFinite(input.t) ? input.t : this.#lastT + Math.max(input.dt, 1 / 60);
    const dt = Math.max(0, Math.min(input.dt, 0.25));
    const events: RhythmicEvent[] = [];
    const onset = input.flux >= 0.55 && t - this.#lastOnset >= ONSET_COOLDOWN;
    const bass = input.bassFlux >= 0.48 && t - this.#lastBassOnset >= ONSET_COOLDOWN;
    const treble = input.trebleFlux >= 0.48 && t - this.#lastTrebleOnset >= ONSET_COOLDOWN;

    if (onset) this.recordOnset(t, this.#onsetTimes, this.#intervals, 'all', events, input.flux);
    if (bass) this.recordOnset(t, this.#bassTimes, this.#bassIntervals, 'bass', events, input.bassFlux);
    if (treble) this.recordOnset(t, this.#trebleTimes, this.#trebleIntervals, 'treble', events, input.trebleFlux);

    const providerBpm = validBpm(input.tempo) ? input.tempo ?? 0 : 0;
    const measuredBpm = bpmFromIntervals(this.#intervals);
    const bpm = providerBpm > 0 && input.hasStructure ? providerBpm : measuredBpm || this.#pulseBpm;
    const providerConfidence = input.hasStructure ? clamp(input.confidence ?? 0, 0, 1) : 0;
    const changed = Math.abs(bpm - this.#pulseBpm) > 8;
    this.#pulseBpm = blend(this.#pulseBpm, bpm, providerConfidence > 0 ? 0.45 : 0.2);
    this.#pulseConfidence = clamp(Math.max(providerConfidence, confidenceFromIntervals(this.#intervals)), 0, 1);

    const phase = input.beatPhase != null && input.hasStructure
      ? clamp(input.beatPhase, 0, 1)
      : advancePhase(this.#lastBeatPhase, dt, this.#pulseBpm);
    const barPhase = input.barPhase != null && input.hasStructure
      ? clamp(input.barPhase, 0, 1)
      : advancePhase(this.#lastBarPhase, dt, this.#pulseBpm / 4);
    const beatCrossed = phase < this.#lastBeatPhase && dt > 0;
    const barCrossed = barPhase < this.#lastBarPhase && dt > 0;
    if (beatCrossed) events.push({ kind: 'beat', time: t, strength: 1, phase });
    if (barCrossed) events.push({ kind: 'bar', time: t, strength: 1, phase: barPhase });
    if (changed) events.push({ kind: 'tempo-change', time: t, strength: 0.7, phase });

    const meter = meterFor(timeSignature, input.hasStructure ? providerConfidence : 0, this.#previous.meter);
    const subdivisions = inferSubdivisions(this.#intervals, this.#pulseBpm, phase);
    const layers = buildLayers(this.#pulseBpm, phase, this.#intervals, this.#bassIntervals, this.#trebleIntervals);
    const polyrhythm = detectPolyrhythm(layers);
    if (polyrhythm) {
      layers.push(polyrhythm);
      events.push({ kind: 'subdivision', time: t, strength: polyrhythm.confidence, phase, layerId: polyrhythm.id });
    }
    const feel = inferFeel(this.#intervals, this.#pulseBpm, this.#onsetTimes);
    const hypotheses = tempoHypotheses(this.#pulseBpm, this.#pulseConfidence, this.#intervals);
    const provenance: RhythmEvidence[] = [
      { source: input.hasStructure ? 'spotify-analysis' : 'onset-dsp', confidence: this.#pulseConfidence, observedAt: t },
      { source: 'inferred', confidence: feel.confidence, observedAt: t, note: 'subdivision, layer, and feel inference' },
    ];

    this.#lastT = t;
    this.#lastBeatPhase = phase;
    this.#lastBarPhase = barPhase;
    this.#previous = {
      primaryPulse: { bpm: this.#pulseBpm, phase, confidence: this.#pulseConfidence, source: input.hasStructure ? 'spotify-analysis' : 'onset-dsp' },
      tempoHypotheses: hypotheses, meter, subdivisions, layers, feel, events,
      confidence: overallConfidence(this.#pulseConfidence, meter.confidence, layers), provenance,
    };
    return this.#previous;
  }

  private recordOnset(
    t: number, times: number[], intervals: number[], layerId: 'all' | 'bass' | 'treble',
    events: RhythmicEvent[], strength: number,
  ): void {
    const previous = times[times.length - 1];
    if (previous != null) pushBounded(intervals, t - previous, MAX_HISTORY);
    pushBounded(times, t, MAX_HISTORY);
    if (layerId === 'all') this.#lastOnset = t;
    if (layerId === 'bass') this.#lastBassOnset = t;
    if (layerId === 'treble') this.#lastTrebleOnset = t;
    events.push({ kind: layerId === 'all' ? 'accent' : `${layerId}-onset`, time: t, strength: clamp(strength, 0, 1), phase: this.#lastBeatPhase, layerId });
  }
}

function emptyStructure(): RhythmicStructure {
  return {
    primaryPulse: { bpm: 120, phase: 0, confidence: 0, source: 'inferred' },
    tempoHypotheses: [{ bpm: 120, ratio: 1, label: 'primary', confidence: 0 }],
    meter: { beatsPerBar: 4, beatUnit: 4, confidence: 0, source: 'inferred', changing: false },
    subdivisions: [], layers: [], feel: { style: 'ambiguous', swingRatio: 1, syncopation: 0, microtiming: 0, confidence: 0 },
    events: [], confidence: 0, provenance: [],
  };
}

function meterFor(timeSignature: number | undefined, confidence: number, previous: MeterHypothesis): MeterHypothesis {
  if (timeSignature != null && Number.isInteger(timeSignature) && timeSignature >= 2 && timeSignature <= 12) {
    return { beatsPerBar: timeSignature, beatUnit: 4, confidence, source: 'spotify-analysis', changing: previous.beatsPerBar !== timeSignature && previous.confidence > 0.5 };
  }
  return { ...previous, source: 'inferred', confidence: Math.min(previous.confidence, 0.35) };
}

function inferSubdivisions(intervals: number[], bpm: number, phase: number): Subdivision[] {
  const beat = 60 / Math.max(bpm, 1);
  const median = medianOf(intervals);
  if (!median || median <= 0) return [];
  const ratio = beat / median;
  const nearest = [2, 3, 4, 6, 8].reduce((a, b) => Math.abs(b - ratio) < Math.abs(a - ratio) ? b : a, 2);
  const error = Math.abs(ratio - nearest) / nearest;
  if (error > 0.2) return [];
  return [{ pulsesPerBeat: nearest, phase: clamp(phase * nearest % 1, 0, 1), confidence: clamp(1 - error * 4, 0, 1), kind: nearest === 3 || nearest === 6 ? 'triple' : nearest === 2 || nearest === 4 || nearest === 8 ? 'duple' : 'irregular' }];
}

function buildLayers(bpm: number, phase: number, all: number[], bass: number[], treble: number[]): RhythmicLayer[] {
  return [
    layer('all', 'all', medianOf(all), bpm, phase),
    layer('bass', 'bass', medianOf(bass), bpm, phase),
    layer('treble', 'treble', medianOf(treble), bpm, phase),
  ].filter((x): x is RhythmicLayer => x !== null);
}

function detectPolyrhythm(layers: RhythmicLayer[]): RhythmicLayer | null {
  const bass = layers.find((x) => x.kind === 'bass');
  const treble = layers.find((x) => x.kind === 'treble');
  if (!bass || !treble || !bass.pulsesPerBeat || !treble.pulsesPerBeat) return null;
  const slower = Math.max(bass.pulsesPerBeat, treble.pulsesPerBeat);
  const faster = Math.min(bass.pulsesPerBeat, treble.pulsesPerBeat);
  const ratio = slower / Math.max(faster, EPSILON);
  const candidates = [1.5, 2, 2.5, 3];
  const nearest = candidates.reduce((a, b) => Math.abs(b - ratio) < Math.abs(a - ratio) ? b : a, candidates[0] ?? 1.5);
  const error = Math.abs(ratio - nearest) / nearest;
  if (error > 0.14 || bass.confidence < 0.35 || treble.confidence < 0.35) return null;
  return {
    id: 'polyrhythm', kind: 'polyrhythm', periodSeconds: Math.min(bass.periodSeconds, treble.periodSeconds),
    phase: bass.phase, confidence: clamp((1 - error * 5) * Math.min(bass.confidence, treble.confidence), 0, 1),
    pulsesPerBeat: nearest,
  };
}

function layer(id: string, kind: RhythmicLayer['kind'], period: number, bpm: number, phase: number): RhythmicLayer | null {
  if (!period || period <= 0) return null;
  const beat = 60 / Math.max(bpm, 1);
  const pulses = beat / period;
  const nearest = Math.round(pulses * 6) / 6;
  return { id, kind, periodSeconds: period, phase, confidence: clamp(1 - Math.abs(pulses - nearest), 0, 1), pulsesPerBeat: nearest > 0 ? nearest : null };
}

function inferFeel(intervals: number[], bpm: number, onsetTimes: number[]): FeelEstimate {
  if (intervals.length < 6) return { style: 'ambiguous', swingRatio: 1, syncopation: 0, microtiming: 0, confidence: 0 };
  const beat = 60 / Math.max(bpm, 1);
  const pairs = intervals.slice(-12);
  const swing = pairs.filter((x) => x > beat * 0.55 && x < beat * 0.9).length / Math.max(pairs.length, 1);
  const deviation = medianOf(pairs.map((x) => Math.abs(x - beat) / beat));
  const offBeat = onsetTimes.filter((t) => Math.abs((t / beat) % 1 - 0.5) < 0.16).length / Math.max(onsetTimes.length, 1);
  const swingRatio = clamp(1 + swing * 0.66, 1, 1.66);
  const style: FeelEstimate['style'] = swing > 0.55 ? (swingRatio > 1.45 ? 'shuffle' : 'swing') : deviation > 0.12 ? 'pushed' : 'straight';
  return { style, swingRatio, syncopation: clamp(1 - offBeat, 0, 1), microtiming: clamp(deviation, 0, 1), confidence: clamp(intervals.length / 24, 0, 1) };
}

function tempoHypotheses(bpm: number, confidence: number, intervals: number[]): TempoHypothesis[] {
  const ambiguity = intervals.length < 12 ? 0.45 : 0.25;
  return [
    { bpm, ratio: 1, label: 'primary', confidence },
    { bpm: bpm / 2, ratio: 0.5, label: 'half-time', confidence: confidence * ambiguity },
    { bpm: bpm * 2, ratio: 2, label: 'double-time', confidence: confidence * ambiguity },
  ];
}

function overallConfidence(pulse: number, meter: number, layers: RhythmicLayer[]): number {
  const layerConfidence = layers.length ? layers.reduce((sum, x) => sum + x.confidence, 0) / layers.length : 0;
  return clamp(pulse * 0.55 + meter * 0.2 + layerConfidence * 0.25, 0, 1);
}

function bpmFromIntervals(intervals: number[]): number {
  const interval = medianOf(intervals.filter((x) => x >= 0.3 && x <= 1));
  return interval ? clamp(60 / interval, 40, 240) : 0;
}

function confidenceFromIntervals(intervals: number[]): number {
  if (intervals.length < 2) return 0;
  const median = medianOf(intervals);
  const spread = medianOf(intervals.map((x) => Math.abs(x - median) / Math.max(median, EPSILON)));
  return clamp(Math.min(intervals.length / 18, 1) * (1 - spread), 0, 1);
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function pushBounded(values: number[], value: number, max: number): void {
  if (Number.isFinite(value) && value > 0 && value < 4) values.push(value);
  while (values.length > max) values.shift();
}

function advancePhase(previous: number, dt: number, bpm: number): number {
  return (previous + dt * bpm / 60) % 1;
}

function validBpm(value: number | undefined): boolean {
  return value != null && Number.isFinite(value) && value >= 40 && value <= 240;
}

function blend(a: number, b: number, amount: number): number {
  return a + (b - a) * clamp(amount, 0, 1);
}

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

export type { FeatureFrame };
