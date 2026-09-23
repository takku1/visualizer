# Open work

| Status | Work | Evidence needed |
| --- | --- | --- |
| ready | Phase 0 baseline comparison | Fresh real-track capture with current telemetry. |
| active | Multimodal perception | Non-null learned audio, artwork, lyrics, metadata, and structure records. |
| active | World identity | Stable track-scale scene bible represented as typed state, not prompt text. |
| active | WorldDelta / WorldMotion | Bounded `WorldMotion` projection and intervention probe now pass; entity-aware semantic edits and learned `VisualPlan` replacement remain. |
| next | Spatial scene prototype | One entity with masks/depth/pose and independently moving regions. |
| compatibility | Raster substrate | Keep Tiny-SD/img2img for A/B and fallback only. |
| next | Stateful world sidecar | `/v1/world/start`, `update`, `state`, `reset`; revision and continuity checks. |
| later | Supported model adapters | Depth, segmentation, pose, reference-image, and motion controls. |
| deferred | Learned semantic adapter | Requires stable explicit controls and intervention traces. |
| gated | Video/temporal backend | Only after local structured motion has a measured limitation. |
| deferred | Visual self-perception | Requires stable one-way dynamics and delayed-feedback evaluation. |
| active | Dynamic lyrics | `off`/`overlay`, lifecycle reload, typed cue events, and seed-preserving world participation pass; world-region raster realization remains after entity state. |

## Current evidence

TypeScript typecheck passes. Existing logs show local System One/baseline
divergence and causality infrastructure, but do not yet prove semantic quality
or multimodal track identity. The image path still lacks authoritative depth,
mask, entity, and pose state.
