# End-to-end architecture v2

> **Superseded direction:** Keep this as audit history, but use
> [architecture.md](architecture.md) as the current contract. The major
> addition is an application-owned structured scene between WorldState and
> image/video realization: entities, regions, depth, pose, and correspondence.

## The audit finding

The current renderer is not yet exercising the intended multimodal AI
architecture. The latest live telemetry shows:

- `perception.learned: null` — no learned audio/image semantic signal is active;
- track title, artist, artwork, and lyrics are empty in the harness;
- `system1.engine: local` — no external semantic reasoner is active;
- the image sidecar is producing material, but continuity is still reported as
  `unknown` until the sidecar is restarted with the continuation build;
- the world begins with fixed priors and only later receives a section update.

That explains why the result still feels like a simple heartbeat. We have been
improving the realization layer while most of the semantic input and learned
control loop remain unconnected.

## The optimized target

The target is not:

```text
audio -> prompt -> image -> warp image
```

It is:

```text
TRACK INPUT
  audio + DSP + rhythm + lyrics + artwork + metadata
                |
                v
       MULTIMODAL PERCEPTUAL STATE
       measured facts + learned embeddings
                |
                v
       TRACK WORLD IDENTITY / SCENE BIBLE
       motif, entities, space, material, visual memory
                |
                v
       SYSTEM ONE WORLD DIRECTOR
       semantic distributions + deltas + motion grammar
                |
        +-------+-------------------+
        |                           |
        v                           v
  PERSISTENT WORLD STATE       AI REALIZATION STATE
  entities, memory, events     image/video latent, depth, masks, flow
        |                           |
        +-------------+-------------+
                      v
             WORLD REALIZER
       depth-aware layers, local motion,
       semantic events, temporal continuity
                      |
                      v
        Electron / Chromium / WebGL2
        presentation and bounded 60 FPS evolution
```

## The major architectural correction

An image checkpoint is not a motion model. A global UV transform cannot create
meaningful character motion from a still raster; it can only move the entire
image. Therefore the image checkpoint should provide visual identity and
material, while motion must operate on a richer representation:

```text
base image or latent
depth / subject masks / semantic regions
local motion field
motif memory
section delta
beat impulse
```

The WebGL path should deform regions or layers, not rotate the whole canvas.
The later learned adapter should target model-supported conditioning or motion
features, not arbitrary reshaping of WorldState into hidden tensors.

## Responsibilities by layer

### Perception layer

Run once per track or section, not per frame:

- learned audio embedding;
- lyrics/text embedding and timed lyric windows;
- artwork/image embedding;
- title, artist, genre, and track metadata;
- DSP/rhythm trends and confidence.

This layer must expose provenance and confidence. If the learned adapter is not
configured, the telemetry must say so clearly instead of making the world look
AI-driven by implication.

### Track world identity

Construct a stable identity before the first section:

```text
WorldIdentity
  motif: recurring visual subject or structure
  space: vast / intimate / enclosed / planar distribution
  material: organic / architectural / atmospheric distribution
  palette: semantic color family distribution
  entities: bounded persistent regions or subjects
  seed: stable track seed
  visual_memory: prior material and motif summaries
```

This prevents every section from inventing a new image universe.

### System One

System One should output a semantic delta and a motion grammar, not shader
uniforms:

```text
WorldDelta
  meaning distributions
  entities to create / preserve / erode
  motif emphasis
  motion grammar
  event response
  material-generation request
```

The motion grammar can include drift, skew, rotation, breathing, local warp,
settling, fracture, reveal, and recovery. These remain bounded semantic
targets. The renderer adapter owns the actual implementation.

### AI realization layer

The immediate Tiny-SD path remains a material prototype. The next useful
realization output is not only an RGB image, but a packet of aligned channels:

```text
RGB material
depth or pseudo-depth
subject/region masks
motion hint or correspondence map
motif confidence
```

That lets the realtime renderer move a face, architecture, fog, or branches
independently. It avoids the current “entire image gets swirled” failure.

### WebGL2 world runtime

WebGL2 remains the 60 FPS layer, but its job changes:

- display the AI material;
- animate masks/layers locally;
- apply semantic motion grammar;
- apply short beat impulses to selected regions;
- preserve temporal memory;
- provide graceful fallback when AI generation is unavailable.

The old reaction-diffusion, particle, bloom, HDR, and global curl stack should
remain an explicitly ablatable fallback, not the default learned-world path.

## Recommended implementation order

### Gate 1 — make the AI inputs real

Connect the learned audio adapter, artwork embedding, lyrics state, and track
metadata. Confirm the logs show non-null learned perception and a non-empty
track identity before judging visual quality.

### Gate 2 — replace VisualPlan as the learned-world control surface

Keep `VisualPlan` for A/B compatibility, but add a `WorldDelta` and
`WorldMotion` contract. Log both the semantic distributions and the resulting
motion policy.

### Gate 3 — replace global image movement with region-aware material

Start with deterministic masks/depth proxies if necessary. The first pass can
use low-resolution channels and WebGL texture layers. It should demonstrate
that a motif persists while its surrounding space changes.

### Gate 4 — upgrade the sidecar realization

Use persistent image-to-image continuation first. If it cannot preserve
identity and local motion, test a temporal/video model in a separate sidecar.
AnimateDiff-style motion modules and streaming diffusion are candidates, but
they are not drop-in 60 FPS browser renderers. See the [motion-control
research](motion-control-research.md).

### Gate 5 — train a small adapter

Once the explicit `WorldMotion` and `WorldDelta` logs are stable, train a small
adapter to map WorldState, audio, lyrics, and memory into supported model
conditioning. Keep the large visual model frozen. Evaluate with semantic
interventions and motif survival, not prompt attractiveness.

## Optimization principles

1. Do not spend more shader complexity compensating for missing AI inputs.
2. Do not ask a still-image model to invent temporal physics.
3. Do not let System One emit raw renderer parameters.
4. Do not call heavy AI on every beat or frame.
5. Do not accept a generated update unless it passes continuity checks.
6. Log active model, perception availability, world identity, motion policy,
   continuity mode, and effective renderer path on every evaluation interval.

The next milestone is therefore not “make the warp more complex.” It is:

> **Make one song produce a stable, multimodally grounded world with a
> persistent motif whose local motion changes according to System One's
> semantic decisions.**
