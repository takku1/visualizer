# Image-model research addendum

> **Architecture revision:** The authoritative state is now structured
> entities/regions/pose/depth plus world memory. Images are one realization
> backend; persistent image-to-image is compatibility, not the destination.

> This note records the earlier sparse-RGB substrate experiment. The current
> target is latent-native persistent realization; see
> [latent-native world architecture](latent-native-world-architecture.md).

## The semantic waist

The architecture becomes more general if all perception flows into one shared intermediate representation:

```text
audio · lyrics · artwork · metadata · visual observations
                         |
                         v
              probabilistic semantic world
                         |
             +-----------+-----------+
             |                       |
             v                       v
     procedural realization    learned realization
     CPPN · SDF · RD · GPU     image substrate / latent
             |                       |
             +-----------+-----------+
                         v
                   persistent world
```

This semantic waist is the real research target. The visualizer is the first application, not the limit of the representation.

## Three possible roles for an image model

### 1. Dream substrate generator — practical first implementation

The learned model should receive semantic world state through a model-specific
adapter and maintain persistent latent/video state. It may return material,
latent features, depth, masks, or motion hints. RGB substrate consumed by the
old flow/reaction-diffusion/particle stack is retained only as a compatibility
experiment.

```text
WorldState -> image conditioning -> image model -> substrate -> simulation -> pixels
```

The model runs at track or section cadence, perhaps once every 20–60 seconds. It is never part of the 60 FPS dependency and never directly produces the finished music video.

This was the recommended compatibility experiment before the latent-native
architecture was selected. It remains useful for fallback and measurement,
but the active target is the stateful latent-world sidecar.

The runtime now exposes an optional `ImageSubstrateProvider` hook, refreshed at
section cadence and uploaded to WebGL outside the frame loop. The provider can
blend with or replace the procedural base material without changing the
semantic or audio contracts.

The first implementation uses a localhost Python sidecar with Segmind Tiny-SD
as an intentionally small checkpoint. It generates a 256px soft substrate, not
an HD frame. The WebGL simulation can upscale, warp, diffuse, recolor, and
retain it through feedback. Crispness is therefore not the objective: the
useful signal is broad structure, palette, silhouette, and motif.

This is also why a soft image is preferable to a crisp one in the first test:
sharp details are likely to become distracting stale pixels after flow and
feedback. Detail belongs to the procedural realization; the learned model
supplies a visual prior.

The sidecar contract is `POST /v1/substrate` with a serialized `WorldState` and
returns a base64 PNG. It is optional and isolated behind
`SidecarSubstrateProvider`; a failed or absent sidecar must leave the
semantic/audio pipeline intact. Larger models such as SD-Turbo or SDXL-Turbo remain upgrade
paths only after this low-resolution experiment proves value.

The first end-to-end CUDA smoke test succeeded at 128×128 on the local RTX
A3000. The sidecar is intentionally single-threaded: diffusion is serialized
to keep VRAM bounded and never competes with the 60 FPS Electron/Chromium
WebGL2 renderer.

### Continuity requirement

Independent section images are only a bootstrap. If each new image replaces
the previous one, the result reads as an AI slideshow with a liquid transition.
The renderer therefore keeps two substrate states: the current material and a
target material. New material is uploaded into the target and crossfaded over
roughly 12–24 seconds, while semantic velocity, feedback, and memory continue
to act on both. The next experiment should also condition generation on prior
material or a compact world memory so the checkpoint evolves the same visual
world instead of inventing unrelated scenes.

A video checkpoint is not the immediate answer. It may become useful when
single-image generation remains discontinuous after persistent substrate
transitions and image-to-image conditioning. Video generation would still be
sparse and offline from the 60 FPS path; it is not a replacement for the
WebGL2 simulation.

### 2. Learned semantic projection — longer-term research option

Rather than turning the world into an English prompt, learn or engineer a projection from `WorldState` into the conditioning representation of an image model:

```text
WorldState -> learned conditioning adapter -> image-model conditioning -> substrate
```

This allows procedural and neural realization to share the same semantic causes. It is attractive because the image model does not need to understand music; System One has already interpreted the music. The image model only needs to realize visual material consistent with the semantic state.

This requires a model with a usable conditioning or latent interface and an evaluation set that tests semantic interventions. It should not be assumed to work merely because text prompting works.

### 3. Visual self-perception — deliberately deferred

The system could occasionally encode its own output and feed observations back into the world:

```text
WorldState -> renderer -> image -> visual encoder -> observations -> WorldState
```

Potential observations include persistent central motifs, bilateral structure, rising density, loss of coherence, or an old motif surviving a transition. This could make visual memory partly perceptual rather than purely numeric.

It is not an early feature. It introduces a feedback-control problem, model latency, possible oscillation, and difficult causality questions. It belongs after the one-way semantic pipeline is measured.

## Recommended order

1. Build and evaluate the DSP/perception fixture with no image model.
2. Establish `WorldState` and prove semantic causality interventions.
3. Add sparse generated substrate behind an adapter and compare it against procedural-only material.
4. Investigate direct semantic conditioning only if prompt-based or fixed-conditioning substrate shows a real limitation.
5. Explore visual self-perception only after persistent-world stability and image-substrate value are established.

## Constraints

## Revised architecture position

The image model is a sparse material/scene updater. It may propose or refine
entities, but the application commits identity and spatial state. The next
sidecar contract is therefore a world session returning aligned channels, not
only a PNG. The old substrate endpoint remains for fallback and A/B captures.

- Image generation is optional and sparse.
- Generated material is substrate, never the frame renderer.
- The semantic state remains typed, probabilistic, versioned, and inspectable.
- Procedural and learned outputs must be independently ablatable.
- The renderer must not know whether its material came from an image model, a CPPN, artwork, or a deterministic texture.
