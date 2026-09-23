# Implementation roadmap

The roadmap is ordered by evidence, not by model novelty.

## Phase 0 — runtime truth

Log the active director, perception providers, track context, world revision,
realization revision, continuity mode, renderer path, latency, FPS, and memory.

**Exit:** a fresh real-track session proves which inputs and models are active.

## Phase 1 — multimodal identity

Connect learned audio, artwork, lyrics, metadata, and structure. Construct a
stable `WorldIdentity` before the first section.

**Exit:** repeated runs produce the same track identity and meaningful section
deltas with provenance and confidence.

## Phase 2 — structured world

Replace learned-world dependence on `VisualPlan` with `WorldIdentity`,
`WorldDelta`, `SpatialScene`, `WorldMotion`, entities, regions, and lifecycle.
Keep `VisualPlan` for fallback comparison.

**Exit:** fixed audio/seed plus a single semantic intervention changes the
predicted entity, region, or motion policy without changing unrelated state.

## Phase 3 — region-aware browser prototype

Use deterministic masks/depth/pose proxies if necessary. Render at least one
persistent entity and one environment layer independently. Apply event impulses
to selected regions.

**Exit:** a motif or person persists while its local surroundings move
independently; no global swirl is required.

## Phase 4 — stateful realization sidecar

Replace `/v1/substrate` with `/v1/world/*`. Retain prior material/latent state,
accept semantic deltas, reject stale updates, and return aligned material,
depth, masks, motion hints, and continuity evidence.

**Exit:** accepted updates are descendants of the same world and rejected
updates do not replace the current result.

## Phase 5 — supported model controls

Add reference-image, depth, segmentation, pose, and motion-module controls
through model-supported adapters. Cache track-level conditioning and keep the
large checkpoint frozen initially.

**Exit:** identity and spatial structure survive controlled changes better than
prompt-only continuation.

## Phase 6 — learned semantic adapter

Train a small adapter from `WorldState`, audio context, and memory into the
chosen model's supported conditioning space. Start by imitating the explicit
motion adapter, then test causal interventions and motif survival.

## Phase 7 — temporal/video backend

Evaluate AnimateDiff, streaming diffusion, or another temporal model behind the
same realization interface only if the structured and persistent image paths
cannot provide adequate local motion.

**Exit:** the temporal backend materially improves continuity/music alignment
while meeting target latency, VRAM, and failure-recovery budgets.

## Non-goals

- per-frame LLM, diffusion, or video inference;
- arbitrary semantic-vector tensor reshaping;
- crossfading unrelated images as the main continuity mechanism;
- making the video model the source of truth for identity;
- adding shaders to compensate for missing perception or scene structure.

