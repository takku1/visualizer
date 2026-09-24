# Implementation status

This is the evidence boundary for the specimen: a concept is marked implemented only when it has a runtime seam and a test or measurable log output.

## Implemented in this pass

- Typed scene continuity contracts accompany the legacy scalar `continuity` field.
- Checkpoint timing receipts record source, confidence, requested beat, commit time, phase error, and timeout fallback.
- A deterministic shot-graph seam supports candidate shots, weighted transitions, and prefetch intent.
- Scenes carry persistent `WorldState`; checkpoints expose renderer-independent `SceneDiff` data for future stateful backends.
- `WorldState` transitions now have a pure `applySceneDiff` reducer; checkpoint commits calculate against the prior committed world and expose the committed world to callers.
- Persistent `ColorState` and `LightingState` now live with world visual identity and compile deterministically to the existing `Look`; knob blending updates both representations.
- `Shot` and `RealizationRequest` now separate presentation/backend compilation from authoritative world state; the current sidecar remains a legacy-compatible adapter.
- Continuous audio is now mapped into bounded renderer-neutral forces and transported separately from semantic content; ShotGraph nodes carry world/shot diffs instead of only prompt candidates.
- The current sidecar compiles structured `WorldState`/`Shot`/`SceneDiff` into a backend-specific conditioning prompt (`structured-world-v1`), while preserving the legacy fields and reporting the diff summary in stream telemetry.
- `PerceptualIntent` and anonymous `EmergentWorldState` now exist as typed seams; a measured backend observer still needs to provide correspondence handles before emergent hypotheses can be populated from pixels.
- `RealizationTelemetry` now has an optional correspondence-observation channel and a pure adapter into `EmergentWorldState`; scalar identity/action confidence, prompt text, and raster drift still cannot create or preserve an emergent form.
- Shot graphs now support guarded runtime selection, prefetch candidates, and cancellation epochs; GPU pre-rendering remains measurement-gated.
- Timed lyric import/provider interfaces now exist; `npm run meaning:import -- --lrc song.lrc --track <id> --out meaning/<id>.json` creates an evidence-bearing manifest.
- `npm run evaluate:logs -- <session.jsonl>` reports semantic source coverage, fingerprint changes, and timing fallback rate.
- The same evaluator reports live ASR update/provisional/committed counts and structured-realization conditioning versions, making post-restart runtime validation reproducible.
- The evaluator also reports structural world-transition metrics; visual identity/action verification remains explicitly unverified.
- Opt-in frame capture plus `tools/evaluate-world.py` provides a CLIP-based identity/action measurement seam without adding work to the real-time loop. It now also reports pairwise image-embedding consistency for manifest identity groups across checkpoints; this is diagnostic evidence, not identity verification.
- Live ASR now enforces one in-flight audio window, preventing slow transcription from queueing behind itself.
- `npm run app` starts the local ASR worker by default; use `npm run app -- --no-meaning` only for performance isolation. Committed live hypotheses promote into `SongMeaning` without blocking procedural rendering.
- Multilingual ASR now supports `MEANING_ASR_LANGUAGE=ja` (or another Whisper language code), preserves detected language, and retains timestamp-bounded whole-window evidence when Whisper provides no chunk timestamps. Reproduce the contract check with `python tools/test-meaning-asr.py`.
- Rolling live ASR stabilization now tolerates conservative same-language, time-overlapping wording revisions instead of requiring exact repeated strings; telemetry reports provisional and committed hypothesis counts.
- `npm run app -- --meaning-language ja` can force Japanese Whisper decoding for a validation session; omitting it preserves automatic language detection.
- Automatic language detection now recovers Japanese from Hiragana/Katakana when Whisper returns `und`; live extraction covers a broader conservative Japanese vocabulary and action set without inventing unsupported narrative.
- Whisper pipeline failures now produce an empty live update and keep the optional ASR worker alive; they no longer tear down the WebSocket or the renderer's semantic connection.
- The diffusion control hot path reuses CPU staging buffers instead of allocating tensors per frame. A controlled 40-frame CUDA comparison at 576×320 measured 62.4 ms median / 63.9 ms p90 after the change versus 63.2 ms / 65.1 ms before it, with peak VRAM unchanged at about 2.48 GB. Reproduce with `npm run stream:bench -- --bench-json output/stream-bench/current.json`.

## Still deliberately deferred

- Licensed lyrics providers and CLAP-style semantic embeddings remain deferred; local ASR and timed imports are available, but neither is a universal catalog solution.
- Reference-image identity conditioning and a ground-truth visual identity/action evaluator remain deferred; the current sidecar now consumes continuity intent but cannot claim true object memory.
- TensorRT, batched inference, FiLM adapters, masked-token canvas updates, and distributed workers: these require a measured model/runtime decision rather than a safe local patch.

The evaluator's `identityVerified` and `actionVerified` fields remain false until an actual visual evaluator is connected.

## Research basis

The reducer and persistent-entity direction is documented in
[`docs/research/persistent-world-realization-research.md`](research/persistent-world-realization-research.md).
The academic evidence supports explicit object-centric state and temporal
correspondence/memory, but does not imply that the current prompt-driven
SD-Turbo backend provides true object permanence.
