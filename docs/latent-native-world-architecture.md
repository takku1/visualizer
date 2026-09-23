# Latent-native world architecture

> **Architecture revision:** Latents are model-owned realization state. The
> application-owned authority is the structured world and spatial scene. A
> latent without entity/region identity is not sufficient continuity.

## The correction

The project should move away from treating an image as the visual world and
then manipulating its pixels. That approach is useful as a baseline, but it
has a hard ceiling: global warps can move a picture, not make its contents
flow, transform, persist, or respond as separate meaningful structures.

The target is:

```text
music / lyrics / artwork / metadata
              |
              v
       multimodal perception
              |
              v
           System One
              |
              v
        semantic WorldState
              |
              v
       model-specific adapter
              |
       valid latent / attention /
       control tensors for the model
              |
              v
    persistent latent world state
              |
       temporal generative model
              |
       latent feature maps / layers
              |
              v
       WebGL2 display runtime
```

## The critical boundary

System One must not invent arbitrary tensors:

```text
wrong:  WorldState -> reshape floats -> UNet tensor
right:  WorldState -> trained/supported adapter -> model conditioning
```

The model's text encoder, image encoder, cross-attention layers, ControlNet,
IP-Adapter, motion module, or other supported conditioning surface defines the
valid tensor space. A small adapter can learn the translation while the large
visual model remains frozen.

## Three coordinated loops

### Semantic loop — slow

System One runs at track/section cadence and changes:

- world identity and recurring motifs;
- entities and regions to preserve or transform;
- affect, form, space, behavior, coherence, persistence, and abstraction;
- a motion grammar;
- the strength and type of the next latent update.

It does not run at 60 FPS and does not choose pixels.

### Latent-world loop — medium

The learned sidecar owns a persistent latent/video state. It receives:

```text
previous latent state
semantic adapter output
audio/lyrics conditioning
beat/event impulse
memory and continuity constraints
```

It updates the latent state with a small number of denoising or recurrent
steps. The output should be latent feature maps or aligned channels such as
depth, region masks, motion hints, and material—not merely a disconnected PNG.

### Display loop — fast

WebGL2 decodes or displays the latest learned state at 60 FPS. It may perform
bounded interpolation, local layer motion, temporal upsampling, and compositing
but must not become the source of the visual identity. Its role is continuity
between learned updates and graceful fallback when the sidecar is unavailable.

## What “System1 controls the tensor” actually means

The control path should look like:

```text
WorldState
   |
   +--> semantic token adapter ------------+
   +--> motif/entity control adapter -----+|
   +--> motion/control feature adapter ---+|
   +--> event-strength scheduler ---------+|
                                            v
                         frozen temporal/image model
                                            |
                                    latent world update
```

This lets one semantic decision affect attention conditioning, spatial
structure, temporal motion, and persistence coherently. The decision is still
semantic; the model adapter owns the tensor details.

## Migration from the current implementation

### Current compatibility path

```text
WorldState -> prompt -> Tiny-SD PNG -> WebGL deformation
```

Keep this for A/B testing and offline fallback.

### First latent-native path

```text
WorldState -> ConditioningPacket
           -> sidecar text/image embeddings
           -> persistent VAE/UNet latent
           -> low-rate latent updates
           -> WebGL display
```

The sidecar should expose a stateful session rather than only
`POST /v1/substrate`:

```text
POST /v1/world/start
POST /v1/world/update
GET  /v1/world/state
POST /v1/world/reset
```

`/update` receives a versioned semantic delta and event packet. It returns a
new world revision, continuity score, and learned material channels. The
browser never needs to know the model's internal tensor shapes.

### Later temporal model path

If persistent image-to-image cannot preserve local identity, replace the
sidecar implementation behind the same interface with a temporal/video model
or motion adapter. This is where AnimateDiff, streaming diffusion, or a custom
small temporal adapter belongs. The interface should not change.

## Optimization rules

1. Keep the large model frozen first; train only a small semantic/motion
   adapter.
2. Cache track-level text, audio, artwork, and lyric embeddings.
3. Update semantic conditioning only when the world meaning changes.
4. Apply beat events as latent/control impulses, not image regeneration calls.
5. Keep a latent/world revision and reject stale asynchronous updates.
6. Require continuity and motif-survival checks before committing an update.
7. Return feature maps/channels when available; do not reduce every result to
   RGB prematurely.
8. Keep WebGL2 as the fast presentation loop, not the generative brain.

## First concrete experiment

Build a stateful sidecar interface that keeps the latent representation in the
Python process and accepts `WorldState` deltas. Initially use the existing
Tiny-SD components if they expose the required VAE/UNet modules. Log:

- world revision;
- conditioning revision;
- latent update time;
- continuity score;
- previous-state reuse;
- committed/rejected update;
- returned channels and dimensions.

If Tiny-SD cannot produce stable latent continuation, that is a useful result:
the next checkpoint must be selected for temporal/latent controllability, not
just image quality.
