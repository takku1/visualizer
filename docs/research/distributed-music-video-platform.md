# Research: theoretical distributed music-video platform

This document describes a future platform, not the current `npm run app`
deployment. The current Electron app and local Python sidecar remain the
reference implementation for the renderer contract.

## Goal

Turn a song into a coherent procedural music video by distributing the work
across specialized services while keeping musical timing and visual continuity
under one authoritative director.

## Proposed topology

```text
client / Electron / web player
        │ audio features, playback clock, user controls
        ▼
session gateway
        │ authenticated session + clock authority
        ├──────────────► semantic control plane
        │                lyrics, metadata, audio-language reasoning
        │                world model, story state, shot plan
        │
        └──────────────► realtime render plane
                         procedural renderer
                         diffusion GPU worker
                         compositor / frame gateway
                                  │
                                  ▼
                         preview stream + receipts
```

The platform should not make every service a director. One session director
owns the semantic state and publishes versioned plans. Render workers are
replaceable executors of those plans.

## Control plane

The control plane works at slow timescales:

- ingest lyrics, title, artist, genres, artwork, and available audio analysis;
- extract motifs, entities, relationships, and section actions;
- maintain the Motif Ledger and world/story/film memory;
- compile a versioned shot plan;
- precompute prompt embeddings, reference assets, and transition recipes;
- publish a checkpoint command with a musical target time.

Every output should be versioned and reproducible:

```text
session_id
track_id
meaning_revision
world_revision
shot_id
checkpoint_id
target_beat
renderer_profile
seed_policy
```

Workers should be able to reject stale commands by revision or target time.

## Realtime render plane

The render plane works at frame and beat timescales:

1. The procedural renderer produces a deterministic camera/structure field.
2. The diffusion worker paints or reprojects that field.
3. The compositor applies paint amount, beat kick, and display timing.
4. The frame gateway sends the newest usable frame and drops obsolete frames.

The render plane should be latest-wins. A late frame is less valuable than a
newer frame that arrives on time. Checkpoint jobs may be queued, but live frame
work must have a bounded queue and explicit cancellation.

## Service boundaries

### Session gateway

Owns authentication, playback clock, client capabilities, and session lease.
It never chooses story content.

### Semantic director

Owns evidence-backed meaning, Motif Ledger, story state, and shot planning. It
can use different models behind an adapter: a local model, hosted model, or
human-authored plan.

### Asset and embedding cache

Stores immutable artifacts keyed by content hash:

- lyrics/transcript segments;
- audio and artwork embeddings;
- motif identity anchors;
- prompt embeddings;
- reference images or control maps;
- compiled shot manifests.

This avoids paying for the same interpretation or text encoding across users
and repeated plays.

### GPU render scheduler

Chooses a worker based on model profile, resolution, VRAM, queue age, and
latency target. It should support warm pools for common profiles and a cold
path for expensive models.

### Renderer worker

Receives a typed `SemanticScene`, procedural controls, and a renderer profile.
It does not call a language model or rewrite the story. This keeps GPU workers
deterministic and horizontally scalable.

### Receipt and evaluation service

Collects semantic, timing, continuity, and quality receipts. It should support
replaying a session from the same plan, seeds, model versions, and audio-clock
events.

## Event model

Use two separate streams:

```text
semantic events: meaning revision, motif reveal, shot plan, checkpoint commit
realtime events: beat, bar, feature frame, paint target, frame receipt
```

Semantic events are durable and replayable. Realtime events are ephemeral and
latest-wins. Mixing them in one durable queue would make a reconnecting client
replay stale frames and could cause a visual jump.

## Distributed optimizations

### Predictive preparation

The semantic director can prepare the next likely shot before the section
boundary. The renderer only commits it when the session clock reaches the
target beat. Wrong predictions are cancelled or retained in cache without
being shown.

### Content-addressed reuse

Two sessions using the same track, semantic model, renderer profile, and
meaning revision can share expensive semantic artifacts. User-specific seeds,
preferences, and continuity state remain separate.

### Capability-aware rendering

Publish renderer profiles such as:

```text
local-low-latency: 448×256, low paint, procedural-first
balanced:          576×320, normal paint, one-step diffusion
quality:           remote GPU, higher checkpoint budget
```

The semantic plan should be resolution-independent. Only the renderer profile
changes.

### Graceful degradation

The platform should degrade in this order:

1. remote semantic model → cached semantic plan;
2. cached plan → local director;
3. diffusion worker unavailable → procedural renderer;
4. remote renderer unavailable → local Electron sidecar;
5. network unstable → latest stable checkpoint plus audio physics.

The video should keep its world and musical timing even when visual richness
falls back.

### Clock discipline

The player or session gateway owns the playback clock. Workers receive target
timestamps and beat indices, not independent wall clocks. Every frame receipt
should include capture time, target time, render time, and display deadline.

## State and consistency

The semantic director is authoritative for:

- world identity;
- story transitions;
- shot order;
- checkpoint versions.

The client is authoritative for:

- local playback position;
- user paint/quality controls;
- display availability.

The renderer is authoritative only for:

- worker health;
- frame generation metadata;
- actual latency and quality receipts.

This prevents a worker from silently inventing a new character or scene when a
checkpoint arrives late.

## Security and privacy considerations

- Treat lyrics and uploaded audio as user content with explicit retention
  rules.
- Keep API credentials in the gateway, never in renderer workers or browser
  prompts.
- Separate tenant/session cache keys when semantic artifacts may reveal user
  tracks or annotations.
- Make external model calls opt-in and record model/provider provenance.

## Platform success metrics

```text
time-to-first-coherent-shot
cue-to-visible-change latency
frame age at display
semantic churn per minute
motif/relationship coverage
anchor survival across checkpoints
GPU utilization per useful visual change
fallback continuity
```

The key platform metric is not raw generated frames. It is **coherent visual
progress per unit of latency and GPU cost**.

## Migration from the current app

The local Electron app already provides the first render-plane contract:

```text
FeatureBus → Director → Scene → CheckpointScheduler → sidecar → Renderer
```

The distributed platform should preserve that contract and move boundaries
outward gradually:

1. persist scene/checkpoint receipts locally;
2. extract the semantic plan into a versioned manifest;
3. make the sidecar consume manifests instead of ad hoc prompts;
4. add remote semantic planning behind the same director interface;
5. add remote GPU workers behind the same stream protocol;
6. add shared caches and session scheduling only after local replay is stable.

The local app is therefore not a throwaway prototype. It is the single-session,
single-worker reference topology for the future platform.
