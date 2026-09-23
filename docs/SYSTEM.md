# System specification: structured persistent visual worlds

## Intent

Translate track perception and System One judgments into a persistent,
entity-aware world that can be realized by procedural, image, or temporal AI
backends and displayed continuously by WebGL2.

## Contracts

Inputs:

- `FeatureFrame`, rhythm, and beat/onset events;
- `TrackContext`, artwork, lyrics, and structure;
- versioned learned perception with provenance;
- `WorldIdentity`, `WorldDelta`, `SpatialScene`, and event impulses.

Outputs:

- committed `WorldState` revision;
- optional realization revision with material, depth, masks, pose,
  correspondence, motion hints, and continuity metadata;
- WebGL2 presentation and fallback telemetry.

`VisualPlan` is supported only as deterministic fallback/A-B behavior.

## Invariants

- World identity and entity IDs persist across ordinary section changes.
- Semantic distributions remain observable; no silent argmax collapse.
- System One emits semantic state, not shader uniforms or arbitrary tensors.
- Events are typed impulses with bounded duration and recovery.
- Heavy learned inference never runs on the browser frame loop.
- Realization updates are versioned and stale updates are rejected.
- Failed updates never replace the current committed world.
- Masks, depth, pose, and correspondence are optional but provenance-labeled.
- Procedural rendering remains available when AI realization is unavailable.
- Image-primary mode does not expose the old procedural demo stack as its identity.

## Required telemetry

Log input provenance, active model/provider, world revision, realization
revision, preserved entity IDs, continuity score, accepted/rejected updates,
latency, returned channels, renderer path, frame time, and GPU memory.

## Technology resolution

- Contracts/world state: build in TypeScript.
- Semantic reasoner: local fallback plus optional external adapter.
- Spatial perception: optional localhost segmentation/tracking/pose sidecar.
- Realization: wrap model-specific pipelines behind a stateful localhost API.
- Large visual model: frozen initially; small adapter later.
- Presentation: existing WebGL2 runtime.
- Procedural stack: compatibility fallback and diagnostic branch.

