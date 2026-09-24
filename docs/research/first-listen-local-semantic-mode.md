# First-listen mode without external lyric APIs

Status: architecture plan; local lyric/ASR worker not implemented yet.

## The honest constraint

For an unknown streaming song, the future lyric content does not exist at the
system boundary yet. No architecture can provide a complete lyric arc before
the audio arrives. The first-listen system therefore optimizes for graceful
semantic discovery, not fictional advance knowledge.

The visual experience should have three guarantees:

1. The procedural layer is full quality immediately and never waits for
   semantic understanding.
2. Meaning sharpens as audio arrives, with provisional hypotheses kept
   separate from committed motifs.
3. Repeated musical structure can reuse motifs that have already been learned,
   even when the lyric text for the return has not arrived yet.

## What the current code already provides

The Electron/Spicetify path already captures system audio through loopback and
keeps a six-second, 16 kHz mono PCM ring buffer in
`src/audio/loopback.ts#audioWindow()`. The feature bus uses the same signal for
live spectrum/rhythm while the renderer stays independent of semantic work.

The missing piece is a local consumer of that short PCM window. The existing
window is intentionally optional and does not block the display loop, making it
the correct seam for a local singing-ASR worker.

## Proposed first-listen architecture

```text
system audio loopback
       |
       +--> FFT/rhythm --> procedural renderer (always live, 60 Hz)
       |
       +--> 6 s PCM ring --> local ASR worker
                              |
                              v
                       rolling lyric hypotheses
                              |
                              v
                   evidence gate + motif ledger
                       |                    |
          low-risk provisional motion       committed meaning
          and camera only                    at section boundary
```

The local worker runs on-device, preferably in the existing local Python
sidecar process so model memory and GPU ownership are explicit. It receives
overlapping windows, performs language identification/ASR, returns timestamps
and confidence, and never writes prompts directly.

## State model

### Provisional layer

The worker may report a hypothesis such as `dog`, `field`, or `running` with:

- source: `live-asr`;
- language and model identifier;
- start/end timestamps;
- word/phrase confidence;
- stability across overlapping windows;
- whether the phrase is currently active or has expired.

Provisional hypotheses may influence abstract motion, camera pressure, palette,
or a non-literal silhouette. They may not introduce a stable literal subject,
replace an existing motif identity, or trigger an irreversible scene splice.

### Committed layer

A hypothesis becomes committed only when:

- it survives multiple overlapping windows;
- confidence clears a calibrated threshold;
- the phrase is not contradicted by the next window;
- it aligns to a trusted section/phrase boundary; and
- the evidence gate accepts `source: "audio"`.

The existing `SongMeaning` and `MotifLedger` are the right destination. A
commit increments `meaningRevision`, records the original language, and gives
the director a durable subject/relation rather than a raw lyric fragment.

## Horizon behavior

The director should expose its current horizon explicitly:

- `abstaining`: no stable semantic evidence yet;
- `provisional`: current audio suggests a meaning but it is not committed;
- `committed`: evidence has survived the gate and can drive a literal shot;
- `reprise-prediction`: a prior section/motif is predicted to return from
  repeated musical structure, but is still marked as a prediction;
- `semantic-manifest`: a user-provided or licensed full manifest exists.

With Spotify analysis, section boundaries can be known ahead of the playhead,
but lyric meaning still cannot. Without analysis, the local rhythm tracker can
create approximate sections; those boundaries must be treated as lower-trust.

When a musical section repeats, the system can reuse its prior motif and shot
grammar as a reversible prediction. If later audio contradicts it, the scene
returns to the current committed ledger instead of forcing the old story.

## What “first time” should feel like

At the beginning, the viewer sees an intentional music video with procedural
continuity—not a loading screen. As the song reveals itself:

1. motion follows the live audio immediately;
2. a tentative visual cue appears while ASR is uncertain;
3. a stable subject becomes visible only after evidence accumulates;
4. the camera and action become more specific at the next boundary;
5. repeated sections recall established motifs, creating apparent planning;
6. contradictions cause a graceful reinterpretation, not a hard reset.

This is the correct demo for an unknown track: the system visibly locks onto
meaning over time while never breaking visual continuity.

## Implementation order

1. Define `LiveLyricHypothesis` and a sidecar message type. Do not change
   renderer prompts yet.
2. Add a local ASR probe that consumes `audioWindow()` and reports timestamps,
   language, confidence, and latency. Measure English, Japanese, and mixed
   vocal tracks before choosing a model.
3. Add an evidence accumulator with overlap stability, expiration, and
   contradiction handling.
4. Add provisional low-risk controls only: motion, camera, and shot pressure.
5. Add section-boundary commits into the existing meaning compiler and motif
   ledger.
6. Add repeated-section detection and reversible reprise prediction.
7. Evaluate first-listen behavior against annotated tracks: subject accuracy,
   time-to-first-correct-motif, false literal commits, recovery time, visual
   continuity, and frame-rate impact.

## Non-goals

- No Spotify lyric scraping.
- No external lyric API dependency.
- No claim that live ASR reconstructs the full song in advance.
- No direct prompt injection from an uncertain transcript.
- No semantic worker allowed to block the 60 Hz procedural loop.

## Decision

Make local first-listen mode the default for unknown tracks. Keep the current
procedural scene active, use the existing loopback PCM ring as the local ASR
input, and promote meaning from provisional to committed only through the
evidence gate. Full-arc manifests remain an optional enhancement for tracks
whose text is available before playback, not a requirement for the product to
work.
