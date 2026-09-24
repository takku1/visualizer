import type { FeatureFrame } from '../types';

/** A deliberately small, causal observation from System 0.
 *
 * This is shadow-mode structure memory: it reports evidence, but does not
 * drive section changes or renderer decisions yet. That boundary is
 * intentional because causal novelty detection is delayed and uncertain.
 */
export type StructureSource = 'system0' | 'abstain';
export type BoundaryCause = 'novelty' | 'repeat-start' | 'repeat-end';

export interface StructureSnapshot {
  segmentId: string | null;
  segmentOccurrence: number;
  repeatCount: number;
  confidence: number;
  predictedBoundaryAt: number | null;
  chorusHint: false;
  patternId: null;
  source: StructureSource;
  novelty: number;
  repeatSimilarity: number;
  eventCounts: { boundaries: number; repeatStarts: number; repeatEnds: number };
  events: StructureEvent[];
}

export type StructureEvent =
  | { kind: 'boundary'; t: number; confidence: number; causes: BoundaryCause[]; lateByTicks: number }
  | { kind: 'segment'; t: number; segmentId: string; repeatCount: number; confidence: number }
  | { kind: 'repeat-start' | 'repeat-end'; t: number; confidence: number; lagTicks: number };

interface TickSample {
  t: number;
  vector: number[];
  segmentId: string;
}

const MAX_TICKS = 512;
const MIN_REPEAT_LAG = 8;
const MIN_SEGMENT_TICKS = 16;
const REPEAT_FLOOR = 0.82;
const NOVELTY_FLOOR = 0.3;
const UNTRUSTED_TICK_SEC = 0.5;

export class StructureMemory {
  #ticks: TickSample[] = [];
  #nextUntrustedTick = 0;
  #segmentId = 'A';
  #segmentCount = 0;
  #repeatActive = false;
  #ticksSinceBoundary = MIN_SEGMENT_TICKS;
  #eventCounts = { boundaries: 0, repeatStarts: 0, repeatEnds: 0 };
  #lastSnapshot: StructureSnapshot = emptySnapshot();

  get snapshot(): StructureSnapshot {
    return this.#lastSnapshot;
  }

  reset(): void {
    this.#ticks = [];
    this.#nextUntrustedTick = 0;
    this.#segmentId = 'A';
    this.#segmentCount = 0;
    this.#repeatActive = false;
    this.#ticksSinceBoundary = MIN_SEGMENT_TICKS;
    this.#eventCounts = { boundaries: 0, repeatStarts: 0, repeatEnds: 0 };
    this.#lastSnapshot = emptySnapshot();
  }

  /** Observe a frame without changing the existing FeatureBus section clock. */
  observe(frame: FeatureFrame): StructureSnapshot {
    const trustedBeat = frame.hasStructure || frame.rhythmConfidence > 0.5;
    const due = trustedBeat ? frame.onBeat : frame.t >= this.#nextUntrustedTick;
    if (!due) return this.#lastSnapshot;

    if (!trustedBeat) this.#nextUntrustedTick = frame.t + UNTRUSTED_TICK_SEC;
    const vector = featureVector(frame);
    const previous = this.#ticks[this.#ticks.length - 1];
    const novelty = previous ? 1 - cosine(vector, previous.vector) : 0;
    let bestSimilarity = 0;
    let bestLag = 0;
    for (let i = Math.max(0, this.#ticks.length - 256); i <= this.#ticks.length - MIN_REPEAT_LAG; i++) {
      const candidate = this.#ticks[i];
      if (!candidate) continue;
      const similarity = cosine(vector, candidate.vector);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestLag = this.#ticks.length - i;
      }
    }

    const events: StructureEvent[] = [];
    const repeat = bestSimilarity >= REPEAT_FLOOR;
    if (repeat !== this.#repeatActive) {
      events.push({ kind: repeat ? 'repeat-start' : 'repeat-end', t: frame.t, confidence: bestSimilarity, lagTicks: bestLag });
      this.#repeatActive = repeat;
      if (repeat) this.#eventCounts.repeatStarts++;
      else this.#eventCounts.repeatEnds++;
    }

    const boundary = this.#ticks.length >= MIN_REPEAT_LAG
      && this.#ticksSinceBoundary >= MIN_SEGMENT_TICKS
      && novelty >= NOVELTY_FLOOR;
    if (boundary) {
      this.#segmentId = nextSegment(this.#segmentId);
      this.#segmentCount++;
      const causes: BoundaryCause[] = ['novelty'];
      if (repeat) causes.push('repeat-start');
      events.push({ kind: 'boundary', t: frame.t, confidence: clamp(Math.max(novelty, bestSimilarity - 0.5), 0, 1), causes, lateByTicks: 0 });
      events.push({ kind: 'segment', t: frame.t, segmentId: this.#segmentId, repeatCount: repeat ? 1 : 0, confidence: clamp(Math.max(novelty, bestSimilarity), 0, 1) });
      this.#ticksSinceBoundary = 0;
      this.#eventCounts.boundaries++;
    }

    this.#ticks.push({ t: frame.t, vector, segmentId: this.#segmentId });
    this.#ticksSinceBoundary++;
    if (this.#ticks.length > MAX_TICKS) this.#ticks.shift();
    this.#lastSnapshot = {
      segmentId: this.#segmentId,
      segmentOccurrence: this.#segmentCount,
      repeatCount: repeat ? 1 : 0,
      confidence: clamp(frame.hasStructure ? frame.confidence : frame.rhythmConfidence * 0.75, 0, 1),
      predictedBoundaryAt: null,
      chorusHint: false,
      patternId: null,
      source: 'system0',
      novelty: clamp(novelty, 0, 1),
      repeatSimilarity: clamp(bestSimilarity, 0, 1),
      eventCounts: { ...this.#eventCounts },
      events,
    };
    return this.#lastSnapshot;
  }
}

function emptySnapshot(): StructureSnapshot {
  return { segmentId: null, segmentOccurrence: 0, repeatCount: 0, confidence: 0, predictedBoundaryAt: null, chorusHint: false, patternId: null, source: 'abstain', novelty: 0, repeatSimilarity: 0, eventCounts: { boundaries: 0, repeatStarts: 0, repeatEnds: 0 }, events: [] };
}

function featureVector(frame: FeatureFrame): number[] {
  return [...frame.chroma, frame.bass, frame.lowMid, frame.mid, frame.highMid, frame.treble, frame.level, frame.flux, frame.spectralCentroid, frame.spectralFlatness];
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

function nextSegment(id: string): string {
  const code = id.charCodeAt(0);
  return String.fromCharCode(code >= 90 ? 65 : code + 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
