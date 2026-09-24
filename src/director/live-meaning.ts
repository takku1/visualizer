import type { LiveMeaningState } from './live-accumulator';
import type { SongMeaning } from './semantic';
import { groundMotifs, groundedAction, hasGroundedCue } from './grounding';

/** Low-risk cue from current ASR; it cannot create or replace world entities. */
export interface ProvisionalPerceptualCue {
  behavior: string[];
  materiality: string[];
  motion: string[];
  lighting: string[];
  confidence: number;
}

export interface LiveEvidenceSummary {
  committed: number;
  groundedMotifs: number;
  actionOnly: number;
  symbolsOnly: number;
  abstained: boolean;
}

/**
 * Classify committed ASR without exposing transcript text. This is telemetry,
 * not a second promotion path: only the existing bounded vocabulary can make
 * a phrase grounded.
 */
export function liveEvidenceSummary(state: LiveMeaningState): LiveEvidenceSummary {
  const committed = state.committed.filter((item) => item.status === 'committed');
  let groundedMotifs = 0;
  let actionOnly = 0;
  let symbolsOnly = 0;
  for (const item of committed) {
    const grounded = groundMotifs(item.text, item.language, item.confidence, `live-0-${item.id}`, 'audio')
      .some((motif) => motif.kind !== 'symbol');
    if (grounded) groundedMotifs++;
    else if (groundedAction(item.text)) actionOnly++;
    else symbolsOnly++;
  }
  return {
    committed: committed.length,
    groundedMotifs,
    actionOnly,
    symbolsOnly,
    abstained: committed.length > 0 && groundedMotifs === 0,
  };
}

export function perceptualCueFromLive(state: LiveMeaningState): ProvisionalPerceptualCue | null {
  const candidates = state.provisional
    .filter((item) => item.status === 'provisional' && item.confidence >= 0.6)
    .slice(-4);
  if (!candidates.length) return null;
  const text = candidates.map((item) => item.text).join(' ');
  const action = groundedAction(text);
  const weather = /\b(rain|rainy|snow|wind|fog|mist|fire|wave|water)\b/iu.test(text)
    || /雨|雪|風|霧|煙|火|波|水/u.test(text);
  if (!action && !weather) return null;
  const behavior = action === 'walks through the environment' || action === 'runs through the environment'
    ? ['traveling', 'rhythmic', 'forward-pulling']
    : action === 'moves rhythmically' ? ['gathering', 'pulsing', 'expressive']
      : action === 'waits in place' ? ['suspended', 'gathered', 'restrained']
        : action === 'converges with another form' ? ['gathering', 'reaching', 'converging']
          : ['drifting', 'revealing', 'becoming'];
  return {
    behavior,
    materiality: weather ? ['wet', 'atmospheric'] : [],
    motion: action === 'runs through the environment' ? ['accelerating', 'urgent'] : ['flowing', 'responsive'],
    lighting: weather ? ['diffuse', 'reflective'] : [],
    confidence: Math.max(...candidates.map((item) => item.confidence)),
  };
}

/** Promote only accumulator-approved ASR phrases into the normal meaning contract. */
export function meaningFromLive(state: LiveMeaningState, revision: number, sectionIndex: number): SongMeaning | null {
  const committed = state.committed.filter((item) => item.status === 'committed');
  if (!committed.length) return null;
  const motifs = committed.slice(-4).flatMap((item, index) => groundMotifs(item.text, item.language, item.confidence, `live-${index}-${item.id}`, 'audio'));
  const confidence = committed.reduce((sum, item) => sum + item.confidence, 0) / committed.length;
  const extractedAction = committed.map((item) => groundedAction(item.text)).find(Boolean);
  const action = extractedAction ?? 'the vocal motif moves through the frame';
  const hasGroundedMotif = motifs.some((motif) => motif.kind !== 'symbol');
  return {
    revision,
    thesis: 'meaning discovered from committed live audio evidence',
    language: committed[0]!.language,
    // A committed ASR phrase is evidence that sound was heard, not proof that
    // its content was grounded. Keep action/perceptual information available,
    // but require at least one recognized motif before compiling a literal
    // semantic scene or persistent world entity.
    abstained: !hasGroundedMotif,
    motifs,
    relations: [],
    sections: [{
      index: sectionIndex,
      startSec: Math.min(...committed.map((item) => item.startSec)),
      action,
      activeMotifs: motifs.map((motif) => motif.id),
      affect: [],
      confidence,
    }],
    evidence: committed.map((item) => ({
      source: 'audio' as const,
      text: item.text,
      confidence: item.confidence,
      startSec: item.startSec,
      endSec: item.endSec,
    })),
  };
}

/**
 * Evidence gate helper shared with the rolling ASR accumulator. A Japanese
 * phrase may only use the shorter two-window confirmation path when it
 * contains a vocabulary/action cue that this compiler can ground; unknown
 * lyrics still require the normal three observations.
 */
export function hasRecognizedLiveCue(text: string): boolean {
  return hasGroundedCue(text);
}
