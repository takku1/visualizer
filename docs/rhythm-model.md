# Rhythmic structure model

Rhythm is a top-level perceptual concept in the visualizer. It is the shared
interpretation consumed by the director, world model, and renderer. Individual
features such as BPM, `onBeat`, bass flux, and bar phase are observations or
projections of rhythmic structure; they are not the model itself.

## Scope

`RhythmicStructure` should eventually represent:

- pulse and tempo, including competing half-time/double-time interpretations;
- beat, bar, meter, time signature, and changing-meter hypotheses;
- subdivisions such as duple, triple, triplet, and irregular groupings;
- independent rhythmic layers and phase relationships for polyrhythms and
  polymeters;
- accents, syncopation, anticipation, rests, and onset density;
- expressive feel: straight, swing, shuffle, pushed, laid-back, and microtiming;
- structural events: pickup, fill, break, drop, stop, and rhythmic transition;
- source provenance, temporal validity, ambiguity, and confidence.

The model must distinguish measured timing from interpretation. For example,
120 BPM with a half-time interpretation is not the same evidence as measured
60 BPM, even if both can produce a similar visual pulse.

## Proposed shape

The eventual interface should remain small and deep. Callers should consume a
single rhythmic-structure snapshot plus event stream rather than knowing which
detector produced each field.

```ts
interface RhythmicStructure {
  primaryPulse: Pulse;
  meter: MeterHypothesis;
  subdivisions: Subdivision[];
  layers: RhythmicLayer[];
  feel: FeelEstimate;
  events: RhythmicEvent[];
  confidence: number;
  provenance: RhythmEvidence[];
}
```

This is a target domain shape, not yet a claim that all fields are implemented.
Missing or ambiguous fields should be represented explicitly rather than filled
with fabricated certainty.

## Runtime contract

The rhythm module should provide two outputs:

1. a continuously evolving structure snapshot for phase-aware rendering;
2. discrete typed events for beat, accent, subdivision, fill, break, and meter or
   feel changes.

The world model can then react differently to a kick accent, a bar boundary, a
polyrhythmic phase crossing, or a half-time reinterpretation without teaching
the renderer about audio-analysis providers.

## Delivery order

1. Normalize current Spotify beat/bar/section data and fallback onset timing
   behind the rhythm interface.
2. Preserve explicit meter and time-signature information instead of assuming
   four beats per bar.
3. Add tatum/subdivision tracking and separate bass/treble/energy onset layers.
4. Add tempo-hypothesis tracking for half-time/double-time ambiguity.
5. Add independent periodicity and phase tracking for polyrhythms and
   polymeters.
6. Add feel and microtiming estimates only after measured timing is stable.
7. Route the resulting snapshots and events into world-state impulses and
   evaluate them with tracks containing odd meter, swing, half-time, and
   polyrhythmic passages.

## Non-goals

This model is not intended to produce symbolic transcription, replace a DAW,
or assert musical intent from weak evidence. It exists to give the visualizer a
stable, honest abstraction for rhythm at multiple timescales.
