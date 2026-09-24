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
- Abstaining realization now compiles perceptual constraints (form, behavior, space, material, motion, and tension) before legacy procedural vocabulary; geometry remains a continuous motion substrate rather than authoritative scene content.
- `PerceptualIntent` and anonymous `EmergentWorldState` now exist as typed seams; a measured backend observer still needs to provide correspondence handles before emergent hypotheses can be populated from pixels.
- `RealizationTelemetry` now has an optional correspondence-observation channel and a pure adapter into `EmergentWorldState`; scalar identity/action confidence, prompt text, and raster drift still cannot create or preserve an emergent form.
- Shot graphs now support guarded runtime selection, prefetch candidates, and cancellation epochs; GPU pre-rendering remains measurement-gated.
- Timed lyric import/provider interfaces now exist; `npm run meaning:import -- --lrc song.lrc --track <id> --out meaning/<id>.json` creates an evidence-bearing manifest.
- `npm run evaluate:logs -- <session.jsonl>` reports semantic source coverage, fingerprint changes, and timing fallback rate.
- The same evaluator reports live ASR update/provisional/committed counts and structured-realization conditioning versions, making post-restart runtime validation reproducible.
- The evaluator also reports structural world-transition metrics; visual identity/action verification remains explicitly unverified.
- Opt-in frame capture plus `tools/evaluate-world.py` provides a CLIP-based identity/action measurement seam without adding work to the real-time loop. It reports pairwise image-embedding consistency and, when a manifest supplies reference images, reference-image similarity for identity groups; these are diagnostic evidence, not identity verification.
- The evaluator also accepts unlabeled `sequenceGroup` manifests for honest temporal-only diagnostics; a real eight-frame capture measured mean adjacent image cosine `0.724` and minimum `0.512`, while correctly reporting zero identity/action evidence.
- The next identity/action gate is a curated capture with an independently selected reference image, at least two human-annotated identity frames, and action labels only where visible; the current abstract line-field capture is intentionally not promoted to that status.
- `docs/evaluation/identity-action-protocol.md` and its example manifest make the offline capture/annotation contract reproducible; no existing benchmark is labeled as identity proof without annotations and independent references.
- Live ASR now enforces one in-flight audio window, preventing slow transcription from queueing behind itself.
- `npm run app` starts the local ASR worker by default; use `npm run app -- --no-meaning` only for performance isolation. Committed live hypotheses promote into `SongMeaning` without blocking procedural rendering.
- Multilingual ASR now supports `MEANING_ASR_LANGUAGE=ja` (or another Whisper language code), preserves detected language, and retains timestamp-bounded whole-window evidence when Whisper provides no chunk timestamps. Reproduce the contract check with `python tools/test-meaning-asr.py`.
- Rolling live ASR stabilization now tolerates conservative same-language, time-overlapping wording revisions instead of requiring exact repeated strings; telemetry reports provisional and committed hypothesis counts.
- Recognized provisional live actions and weather cues now compile into bounded perceptual pressure (behavior, material, motion, and lighting) without adding entities, changing identity, or triggering a checkpoint.
- `npm run app -- --meaning-language ja` can force Japanese Whisper decoding for a validation session; omitting it preserves automatic language detection.
- Automatic language detection now recovers Japanese from Hiragana/Katakana when Whisper returns `und`; live extraction covers a broader conservative Japanese vocabulary and action set without inventing unsupported narrative.
- Whisper pipeline failures now produce an empty live update and keep the optional ASR worker alive; they no longer tear down the WebSocket or the renderer's semantic connection.
- ASR now rejects configurable low-RMS windows (`MEANING_MIN_RMS`, default `0.003`) before Whisper inference, preventing silence hallucinations from becoming repeated semantic evidence.
- The diffusion control hot path reuses CPU staging buffers instead of allocating tensors per frame. The current isolated 150-frame CUDA benchmark at 576×320 measures 88.2 ms median / 89.9 ms p90 (~11.3 FPS), with peak VRAM 2476 MB of 6144 MB. Reproduce with the live app stopped using `npm run stream:bench -- --bench-json output/stream-bench/current.json`; concurrent sidecars contaminate the GPU measurement. The older 62.4 ms figure came from a different benchmark/runtime state and is not treated as the current baseline.

## Still deliberately deferred

- Licensed lyrics providers and CLAP-style semantic embeddings remain deferred; local ASR and timed imports are available, but neither is a universal catalog solution.
- Reference-image conditioning inside the real-time sidecar and a ground-truth visual identity/action evaluator remain deferred. The offline evaluator now supports optional reference-image diagnostics, adjacent temporal consistency, and explicit capture preflight; it cannot claim true object memory from CLIP scores alone.
- TensorRT, batched inference, FiLM adapters, masked-token canvas updates, and distributed workers: these require a measured model/runtime decision rather than a safe local patch.

The evaluator's `identityVerified` and `actionVerified` fields remain false until an actual visual evaluator is connected.

## Research basis

The reducer and persistent-entity direction is documented in
[`docs/research/persistent-world-realization-research.md`](research/persistent-world-realization-research.md).
The academic evidence supports explicit object-centric state and temporal
correspondence/memory, but does not imply that the current prompt-driven
SD-Turbo backend provides true object permanence.
