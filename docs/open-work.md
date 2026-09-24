# Implementation status

This is the evidence boundary for the specimen: a concept is marked implemented only when it has a runtime seam and a test or measurable log output.

## Implemented in this pass

- Typed scene continuity contracts accompany the legacy scalar `continuity` field.
- Checkpoint timing receipts record source, confidence, requested beat, commit time, phase error, and timeout fallback.
- A deterministic shot-graph seam supports candidate shots, weighted transitions, and prefetch intent.
- Scenes carry persistent `WorldState`; checkpoints expose renderer-independent `SceneDiff` data for future stateful backends.
- The current sidecar consumes `SceneDiff` identity-break/preserve intent and reports the diff summary in stream telemetry.
- Shot graphs now support guarded runtime selection, prefetch candidates, and cancellation epochs; GPU pre-rendering remains measurement-gated.
- Timed lyric import/provider interfaces now exist; `npm run meaning:import -- --lrc song.lrc --track <id> --out meaning/<id>.json` creates an evidence-bearing manifest.
- `npm run evaluate:logs -- <session.jsonl>` reports semantic source coverage, fingerprint changes, and timing fallback rate.
- The evaluator also reports structural world-transition metrics; visual identity/action verification remains explicitly unverified.
- `npm run app` starts the local ASR worker by default; use `npm run app -- --no-meaning` only for performance isolation. Committed live hypotheses promote into `SongMeaning` without blocking procedural rendering.

## Still deliberately deferred

- Licensed lyrics providers and CLAP-style semantic embeddings remain deferred; local ASR and timed imports are available, but neither is a universal catalog solution.
- Reference-image identity conditioning and a ground-truth visual identity/action evaluator remain deferred; the current sidecar now consumes continuity intent but cannot claim true object memory.
- TensorRT, batched inference, FiLM adapters, masked-token canvas updates, and distributed workers: these require a measured model/runtime decision rather than a safe local patch.

The evaluator's `identityVerified` and `actionVerified` fields remain false until an actual visual evaluator is connected.
