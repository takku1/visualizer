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
- The current sidecar compiles structured `WorldState`/`Shot`/`SceneDiff` into a backend-specific conditioning prompt (`structured-world-v1`), while preserving the legacy fields and reporting the diff summary, conditioned field set, and prompt hash in stream telemetry. This makes the current text bridge auditable without pretending SD-Turbo has object-level reference conditioning.
- ShotGraph candidate insertion now supports true alternate branches from the current shot (with an explicit `fromId` escape hatch for chained transitions), so prefetch and weighted selection operate on competing production candidates rather than accidentally forming a candidate chain.
- ShotGraph telemetry now includes recent staged, prefetched, and selected candidate IDs in addition to counts, making live production selection auditable from JSONL rather than inferred from aggregate counters.
- Abstaining realization now compiles perceptual constraints (form, behavior, space, material, motion, and tension) before legacy procedural vocabulary; geometry remains a continuous motion substrate rather than authoritative scene content.
- `PerceptualIntent` and anonymous `EmergentWorldState` now exist as typed seams; a measured backend observer still needs to provide correspondence handles before emergent hypotheses can be populated from pixels.
- `RealizationTelemetry` now has an optional correspondence-observation channel and a pure adapter into `EmergentWorldState`; scalar identity/action confidence, prompt text, and raster drift still cannot create or preserve an emergent form.
- Shot graphs now support guarded runtime selection, prefetch candidates, and cancellation epochs; GPU pre-rendering remains measurement-gated.
- State/telemetry now records ShotGraph candidates staged, prefetch intent, selections, and pending state so production use is distinguishable from unit-test-only coverage.
- Timed lyric import/provider interfaces now exist; `npm run meaning:import -- --lrc song.lrc --track <id> --out meaning/<id>.json` creates an evidence-bearing manifest.
- `npm run evaluate:logs -- <session.jsonl>` reports semantic source coverage, fingerprint changes, and timing fallback rate.
- The same text report now includes live language/configuration coverage, structured-conditioning build hashes, and stream health (zero-FPS windows split by connection state, disconnects, and dropped frames) so startup gaps are not confused with renderer or world-state failures.
- The same evaluator reports live ASR update/provisional/committed counts and structured-realization conditioning versions, making post-restart runtime validation reproducible.
- The evaluator also reports structural world-transition metrics; visual identity/action verification remains explicitly unverified.
- Log evaluation now separates semantic decisions from grounded semantic decisions; symbol/action-only promotions are reported as ungrounded instead of inflating evidence coverage.
- Opt-in frame capture plus `tools/evaluate-world.py` provides a CLIP-based identity/action measurement seam without adding work to the real-time loop. It reports pairwise image-embedding consistency and, when a manifest supplies reference images, reference-image similarity for identity groups; these are diagnostic evidence, not identity verification.
- The same offline evaluator now accepts `--optical-flow` and reports dense Farneback motion magnitude and directional coherence for labeled or sequence-grouped frames. This is an action/motion diagnostic only; it cannot separate camera motion from subject motion or verify an action label. The existing 22-frame abstract capture measured mean magnitude `3.40` and mean directional coherence `0.131`, so it has motion but no stable directional-action evidence.
- The evaluator also accepts unlabeled `sequenceGroup` manifests for honest temporal-only diagnostics; a real eight-frame capture measured mean adjacent image cosine `0.724` and minimum `0.512`, while correctly reporting zero identity/action evidence.
- The next identity/action gate is a curated capture with an independently selected reference image, at least two human-annotated identity frames, and action labels only where visible; the current abstract line-field capture is intentionally not promoted to that status. Preflight now rejects missing per-group references, references that reuse captured-frame paths, and action coverage with fewer than two labeled frames in one identity group.
- `docs/evaluation/identity-action-protocol.md` and its example manifest make the offline capture/annotation contract reproducible; no existing benchmark is labeled as identity proof without annotations and independent references.
- Live ASR now enforces one in-flight audio window, preventing slow transcription from queueing behind itself.
- `npm run app` starts the local ASR worker by default; use `npm run app -- --no-meaning` only for performance isolation. Committed live hypotheses promote into `SongMeaning` without blocking procedural rendering.
- Multilingual ASR now supports `MEANING_ASR_LANGUAGE=ja` (or another Whisper language code), preserves detected language, and retains timestamp-bounded whole-window evidence when Whisper provides no chunk timestamps. Reproduce the contract check with `python tools/test-meaning-asr.py`.
- Rolling live ASR stabilization now tolerates conservative same-language, time-overlapping wording revisions instead of requiring exact repeated strings; telemetry reports provisional and committed hypothesis counts.
- Japanese live ASR now uses script-aware character-overlap matching for common inflectional revisions (for example, a stem plus a changed verb ending). Recognized Japanese entity/action cues may commit after two overlapping windows; unknown lyrics retain the normal three-window gate and cannot create world entities. This is a bounded evidence improvement, not a claim of full Japanese lyric transcription.
- Recognized provisional live actions and weather cues now compile into bounded perceptual pressure (behavior, material, motion, and lighting) without adding entities, changing identity, or triggering a checkpoint.
- `npm run app -- --meaning-language ja` can force Japanese Whisper decoding for a validation session; omitting it preserves automatic language detection.
- Automatic language detection now recovers Japanese from Hiragana/Katakana when Whisper returns `und`; live extraction covers a broader conservative Japanese vocabulary and action set without inventing unsupported narrative.
- Whisper ASR requests its explicit decoder language metadata in addition to
  script-based recovery, preventing noisy sung text from being treated as the
  language decision; the semantic evidence gate remains unchanged.
- Committed live audio now remains abstained unless the bounded extractor
  grounds at least one motif (for example a person/object/place/force) rather
  than only recognizing that speech or an action was present. Action-only and
  symbol-only evidence can still drive provisional perceptual pressure, but it
  cannot be mislabeled as a literal semantic world.
- Whisper pipeline failures now produce an empty live update and keep the optional ASR worker alive; they no longer tear down the WebSocket or the renderer's semantic connection.
- ASR now rejects configurable low-RMS windows (`MEANING_MIN_RMS`, default `0.003`) before Whisper inference, preventing silence hallucinations from becoming repeated semantic evidence.
- The diffusion control hot path reuses CPU staging buffers instead of allocating tensors per frame. The default 448×256 profile now measures 68.2 ms median / 69.5 ms p90 (~14.7 FPS), with peak VRAM 2435 MB of 6144 MB. The 576×320 quality profile measures 88.2 ms median / 89.9 ms p90 (~11.3 FPS), with peak VRAM 2476 MB. Reproduce with the live app stopped; in PowerShell use `$env:STREAM_WIDTH='448'; $env:STREAM_HEIGHT='256'; npm run stream:bench -- --bench-json output/stream-bench/448x256.json`. Concurrent sidecars contaminate the GPU measurement. The older 62.4 ms figure came from a different benchmark/runtime state and is not treated as the current baseline.
- The offline identity/action protocol now accepts explicit human direction/axis annotations and reports coarse optical-flow agreement per adjacent pair. This strengthens action evidence without pretending dense flow is a subject/action classifier; identity/action verification remains intentionally false until annotated correspondence is reviewed.
- An isolated cuDNN-autotune experiment measured 85.0 ms median / 86.4 ms p90, but raised peak VRAM to 4080 MB and retains batch-shape autotuning stalls. It is rejected for the 6 GB live target; the default remains `cudnn.benchmark=False`.

## Still deliberately deferred

- Licensed lyrics providers and CLAP-style semantic embeddings remain deferred; local ASR and timed imports are available, but neither is a universal catalog solution.
- Reference-image conditioning inside the real-time sidecar and a ground-truth visual identity/action evaluator remain deferred. The offline evaluator now supports optional reference-image diagnostics, adjacent temporal consistency, and explicit capture preflight; it cannot claim true object memory from CLIP scores alone.
- TensorRT, batched inference, FiLM adapters, masked-token canvas updates, and distributed workers: these require a measured model/runtime decision rather than a safe local patch.

The evaluator's `identityVerified` and `actionVerified` fields remain false
until an actual visual evaluator is connected; every offline report now emits
those fields explicitly with `evaluationMode: diagnostic`.

## Research basis

The reducer and persistent-entity direction is documented in
[`docs/research/persistent-world-realization-research.md`](research/persistent-world-realization-research.md).
The academic evidence supports explicit object-centric state and temporal
correspondence/memory, but does not imply that the current prompt-driven
SD-Turbo backend provides true object permanence.
