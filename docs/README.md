# System One visual world architecture

This documentation defines the migration from a procedural music visualizer to
a persistent, entity-aware visual world.

## Canonical documents

- [Architecture](architecture.md) — governing system shape and ownership.
- [Architecture research](architecture-research.md) — primary-source evidence and technology resolution.
- [Semantic world model](semantic-world-model.md) — typed state and boundaries.
- [Visual control layers](control-layers.md) — semantic vocabulary for meaning and behavior.
- [Dynamic lyrics architecture](lyrics-architecture.md) — lyric timing and world participation.
- [Implementation roadmap](roadmap.md) — evidence-gated build sequence.
- [Architecture decisions](decisions.md) — decisions not to reopen casually.
- [System specification](SYSTEM.md) — contracts and invariants.
- [Open work](open-work.md) — current readiness checklist.
- [Live log review](log-review-2026-09-22.md) — what current sessions prove.
- [Research review](research-review.md) — project audit and risks.
- [Motion control research](motion-control-research.md) — local motion and temporal backends.
- [Image model research](image-model-research.md) — realization roles.
- [Image conditioning research](image-conditioning-research.md) — supported conditioning progression.

## North star

One song should establish one world. A recognizable entity or motif should
persist through the song. Musical and semantic changes should alter that entity
and its environment locally without destroying identity.

The key boundary is:

```text
perception -> System One -> structured WorldState -> realization -> WebGL2
```

The image/video model is a renderer or sparse world updater. It is not the
world database. The procedural renderer remains a fallback while the structured
world and realization sidecar are built.

## Current implementation anchors

- `src/audio/analysis.ts`: DSP and structure features.
- `src/perception/`: learned perception seam.
- `src/director/`: System One decision seam and fallback.
- `src/world/`: semantic world, controls, conditioning, and substrate seams.
- `src/render/renderer.ts`: WebGL2 display runtime.
- `tools/image-substrate-server.py`: compatibility raster sidecar.
- `tools/audio-perception-server.py`: optional learned audio sidecar.

## Current reality

The semantic/procedural foundation is credible. Learned multimodal identity,
structured spatial state, stateful realization, and meaningful people/entity
motion remain unfinished. Do not interpret a generated image or a crossfade as
evidence of persistent world continuity.

