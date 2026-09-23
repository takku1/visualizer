export type RhythmEvidenceSource = 'spotify-analysis' | 'onset-dsp' | 'inferred';

export type FeelStyle = 'straight' | 'swing' | 'shuffle' | 'laid-back' | 'pushed' | 'ambiguous';

export interface Pulse {
  bpm: number;
  phase: number;
  confidence: number;
  source: RhythmEvidenceSource;
}

export interface TempoHypothesis {
  bpm: number;
  /** Relative to the primary pulse: 0.5 = half-time, 2 = double-time. */
  ratio: number;
  label: 'primary' | 'half-time' | 'double-time' | 'alternative';
  confidence: number;
}

export interface MeterHypothesis {
  beatsPerBar: number;
  beatUnit: number;
  confidence: number;
  source: RhythmEvidenceSource;
  changing: boolean;
}

export interface Subdivision {
  pulsesPerBeat: number;
  phase: number;
  confidence: number;
  kind: 'duple' | 'triple' | 'compound' | 'irregular';
}

export type RhythmicLayerKind = 'all' | 'bass' | 'treble' | 'energy' | 'polyrhythm';

export interface RhythmicLayer {
  id: string;
  kind: RhythmicLayerKind;
  periodSeconds: number;
  phase: number;
  confidence: number;
  /** The layer's relationship to the primary pulse, when measurable. */
  pulsesPerBeat: number | null;
}

export interface FeelEstimate {
  style: FeelStyle;
  swingRatio: number;
  syncopation: number;
  microtiming: number;
  confidence: number;
}

export type RhythmicEventKind =
  | 'beat' | 'bar' | 'subdivision' | 'accent'
  | 'bass-onset' | 'treble-onset' | 'fill' | 'break'
  | 'tempo-change' | 'meter-change' | 'feel-change';

export interface RhythmicEvent {
  kind: RhythmicEventKind;
  time: number;
  strength: number;
  phase: number;
  layerId?: string;
}

export interface RhythmEvidence {
  source: RhythmEvidenceSource;
  confidence: number;
  observedAt: number;
  note?: string;
}

export interface RhythmicStructure {
  primaryPulse: Pulse;
  tempoHypotheses: TempoHypothesis[];
  meter: MeterHypothesis;
  subdivisions: Subdivision[];
  layers: RhythmicLayer[];
  feel: FeelEstimate;
  events: RhythmicEvent[];
  confidence: number;
  provenance: RhythmEvidence[];
}

export interface RhythmObservation {
  t: number;
  dt: number;
  flux: number;
  bassFlux: number;
  trebleFlux: number;
  level: number;
  beatPhase?: number;
  barPhase?: number;
  tempo?: number;
  confidence?: number;
  hasStructure?: boolean;
  /** Optional authoritative meter from a provider such as track analysis. */
  timeSignature?: number;
}
