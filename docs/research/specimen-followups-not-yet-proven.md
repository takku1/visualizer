# Specimen follow-ups: proposals not yet proven

This document deliberately does **not** modify the specimen preprint. The
specimen describes the current project and its current evidence boundary.
These are architectural proposals to be tested first and promoted into the
specimen only after the project produces supporting evidence.

## Status update: implementation has begun

The project now contains a first local-only implementation of part of this
proposal:

- `src/director/semantic.ts` defines `SongMeaning`, evidence, motifs,
  relations, sections, `MotifLedger`, and `SemanticScene`.
- `meaning/README.md` defines the opt-in manifest contract and explicit
  abstention when no manifest is present.
- `src/stream/scenes.ts` compiles a manifest into a semantic scene and a typed
  fingerprint.
- `src/stream/checkpoint.ts` compares typed scene meaning rather than only raw
  prompt text.
- `src/eval/recorder.ts` records semantic revision, shot, and fingerprint
  information.

This changes the status of the seam from `unbuilt` to **implemented, not yet
validated visually**. It does not establish that the manifest improves visual
quality, that identity survives checkpoints, or that the generated action matches
a song. At the time of this note's original implementation snapshot,
`npm run typecheck`, `npm test` (35 tests), and the production build passed on
2026-09-24. The current suite has since grown to 63 tests; no semantic runtime
quality result is promoted here. The initial restricted-shell esbuild access
error was an environment issue.

## 1. Formalize the director input `q`

The current director is structurally real, but its semantic input is sparse.
In the shipped code, `TrackContext` can contain:

```text
trackId, title, artist, genres
tempo, key, mode, loudness, sectionLabel
concepts
album-art color/luminance/saturation/contrast
```

`FeatureFrame` contributes windowed audio and rhythm features. The current
`concepts` path is a thin list of image-bearing words requested from the
sidecar from track metadata; it is not lyrics, a CLAP embedding, or a full
audio-language interpretation.

The honest future interface should make provenance explicit:

```ts
interface DirectorContext {
  track: {
    id: string | null;
    title: string | null;
    artist: string | null;
    genres: string[];
  };
  structure: {
    section: number;
    label: string | null;
    tempo: number;
    key: number | null;
    mode: 'major' | 'minor' | null;
    confidence: number;
  };
  meaning: {
    concepts: Array<{
      label: string;
      source: 'metadata' | 'artwork' | 'lyrics' | 'audio-model' | 'inference';
      confidence: number;
      startSec?: number;
      endSec?: number;
    }>;
    thesis: string | null;
    confidence: number;
  };
  artwork: {
    color: [number, number, number];
    luminance: number;
    saturation: number;
    contrast: number;
  } | null;
}
```

The first implementation should not assume lyrics or CLAP are available. It
should support `meaning.concepts = []` and preserve the source distinction.
That creates a stable seam for later experiments:

1. metadata and artwork only;
2. metadata + lyrics/line timestamps;
3. metadata + audio-language caption;
4. fused evidence with abstention.

The current code implements the narrower `SongMeaning` seam in
`src/director/semantic.ts`, a local manifest loader in the stream sidecar, and
an opt-in local Whisper ASR path. It still does not implement a licensed lyric
provider, translation, or calibrated audio-language understanding; absent or
uncommitted evidence remains an explicit abstention.

The comparison must measure whether each added source improves semantic
coherence rather than merely making prompts longer.

## 2. Make weighted plans explicit in the formal model

The implementation does not always produce one-hot choices. `Weighted<T>`
keeps a top label, a probability map, and confidence. The vocabulary layer
blends parameter vectors over that distribution.

The formal model should therefore distinguish the director answer from the
compiled parameters:

```text
director answer:  p_k = {weighted motion, weighted palette, ...}
compiled look:   L_k = Blend(V, p_k)
compiled prompt: P_k = Prompt(p_k, q_k)
fast controls:   c_t = M(f_t, L_k)
```

This matters because a 60/40 semantic answer is not the same artifact as an
argmax scene with a hidden hard switch. The weighted behavior is currently
implemented in the vocabulary/compiler path; it should be evaluated for visual
quality before being described as a benefit.

## 3. State the trusted-downbeat assumption

Checkpoint timing depends on a beat grid. The scheduler uses trusted Spotify
structure or sufficiently confident inferred rhythm, then waits for a downbeat
or falls back after a bounded delay.

The explicit assumption is:

```text
If beat/bar confidence is wrong, a semantically correct scene may commit at
the wrong musical instant. Semantic quality does not repair timing error.
```

The future receipt should record:

```text
timing_source: spotify-analysis | onset-inference
timing_confidence
requested_target_beat
actual_commit_time
commit_phase_error
fallback_used
```

The first timing experiment should use deliberately difficult material:
half-time, swing, syncopation, tempo changes, odd meter, and tracks without
provider analysis. This should remain a research note until measured.

## 4. Name continuity as a placeholder mechanism

The current `Scene.continuity` value is a scalar passed into the checkpoint
path. It expresses how strongly a new keyframe should grow from the live frame,
but it is not an identity guarantee and does not identify what is being
preserved.

Until identity experiments exist, describe it as:

```text
continuity: a renderer initialization/transition parameter;
not a measured subject-preservation mechanism.
```

The proposed replacement is a typed contract:

```ts
interface ContinuityContract {
  preserve: string[];
  mayChange: string[];
  breakOn: string[];
  rendererStrength: number;
}
```

The contract should only replace the scalar after an experiment demonstrates
that its fields predict or improve identity survival.

## 5. Separate current architecture from future music-video architecture

The current project is accurately described as:

```text
windowed audio + sparse track context
        → visual plan
        → prompt/look scene
        → downbeat checkpoint
        → diffusion paint over procedural structure
```

The future system is a proposal:

```text
audio + lyrics + metadata + artwork
        → evidence-backed meaning manifest
        → world/story/film state
        → shot graph
        → continuity contract
        → checkpoint realization
```

The second diagram belongs in research docs until it has an implementation and
measured result. The first belongs in the specimen.

## Promotion rule

A proposal may enter the specimen only when there is a traceable artifact:

- code path and interface;
- executed test or benchmark;
- dated log or controlled comparison;
- explicit result, including null or adverse result.

Until then, research notes should use labels such as `proposed`, `unbuilt`,
`hypothesis`, and `not yet evaluated` rather than presenting the concept as a
shipped capability.
