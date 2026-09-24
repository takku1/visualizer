# Updating `metadata-fallback` into evidence-backed direction

Status: researched implementation plan.

## Current behavior

`metadata-fallback` is intentional: track concepts are available, but no
evidence-backed song event is available. The compiler allows metadata to steer
visual treatment while abstaining from literal narrative. The baseline text is
the deterministic comparison controller, not an error.

Spotify currently-playing data provides playback position and track identity,
including ISRC in the track's external IDs, but not lyric text. Spotify also
restricts synchronizing Spotify content with visual media. Use it for identity
and timing, not as a lyric source. See [currently playing](https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
and the [track reference](https://developer.spotify.com/documentation/web-api/reference/get-track).

## Recommended pipeline

```text
exact track identity -> imported/licensed timed lyrics or local manifest
                     -> local first-listen ASR for unknown tracks
                     -> explicit abstention when evidence is weak
```

The fastest deterministic path is a validated `meaning/<track-id>.json`
manifest. The existing `SongMeaning` contract already supports motifs,
relations, sections, language, evidence, and revision. Narrative evidence must
come from `lyrics` or `audio`; metadata is intentionally rejected by the
compiler.

For production catalog coverage, add a rights-aware lyrics adapter keyed by
ISRC/provider ID. It must validate exact recording match, language, timing,
region, and rights. Ambiguous or unauthorized results must remain abstention.
Do not scrape Spotify lyric endpoints.

## Important implementation gap found

The repository already contains `tools/meaning-server.py`, a local Whisper
worker, `LiveLyricHypothesis`, and `LiveLyricAccumulator`. However:

- Electron does not start the meaning worker by default;
- `core.ts` stores live updates but does not turn committed hypotheses into
  `SongMeaning`;
- the worker emits `language: "und"`, `confidence: 0.5`, and `stability: 0.0`;
- the accumulator requires confidence >= 0.65 and stability >= 0.6, so the
  current worker cannot produce a committed meaning.

Whisper supports multilingual recognition, language identification, and
timestamped segments; its official implementation also supports word
timestamps. See the [Whisper README](https://github.com/openai/whisper/blob/main/README.md)
and [transcription implementation](https://github.com/openai/whisper/blob/main/whisper/transcribe.py).

For a later GPU benchmark, NVIDIA NeMo's cache-aware streaming ASR and
Parakeet family are credible alternatives. NeMo documents streaming inference
and timestamps, while the Parakeet model card describes lyric transcription
and word timestamps. See [NeMo ASR models](https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/models.html),
[NeMo timestamps](https://github.com/NVIDIA-NeMo/Speech/blob/main/docs/source/asr/intro.rst),
and the [Parakeet model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2).

## Update sequence

1. Add a `LiveMeaningAccumulator` to `SongMeaning` adapter using only committed
   hypotheses and `source: "audio"` evidence.
2. Reset it on track changes and expire stale hypotheses.
3. Start the worker explicitly with an opt-in app flag or `MEANING_URL`; keep
   it separate from the real-time procedural loop and default to CPU until GPU
   contention is measured.
4. Return detected language and calibrated confidence; do not use fixed values.
5. Promote meaning only at section/downbeat boundaries. Procedural rendering
   remains immediate and never waits for ASR.
6. Log time-to-first-hypothesis, time-to-first-commit, ASR latency, language,
   false commits, and semantic checkpoint count.
7. Compare imported manifests, ASR, and abstention on the same tracks before
   switching ASR models.

The correct next implementation is therefore the missing live-ASR promotion
path plus an opt-in launcher, not a change that forces every metadata track to
claim a story.
