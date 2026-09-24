# Academic basis for persistent audiovisual world realization

Status: design evidence for the reducer/world-state migration. This research
supports architectural boundaries; it does not claim that the current
SD-Turbo backend already provides object permanence.

## Findings

### Object-centric state should be explicit

Slot Attention describes a representation in which a scene is decomposed into
exchangeable object-centric slots rather than one undifferentiated feature
vector. The relevant architectural implication is that entities need stable,
separately addressable representations if later reasoning is expected to
compose or preserve them.

Source: Locatello et al., *Object-Centric Learning with Slot Attention*, 2020,
the [arXiv paper](https://arxiv.org/abs/2006.15055).

Repository consequence: `WorldState.entities` should be authoritative and
addressable by stable IDs. `SongMeaning` can propose or revise entities, but a
renderer must not become the owner of their identity.

### Temporal consistency needs correspondence or memory

TokenFlow reports that consistent diffusion video editing can be obtained by
propagating diffusion features using inter-frame correspondences. CoDeF
represents video using canonical content plus temporal deformation fields,
separating persistent content from frame-specific motion.

Sources: Geyer et al., *TokenFlow: Consistent Diffusion Features for
Consistent Video Editing*, 2023, [arXiv](https://arxiv.org/abs/2307.10373);
Ouyang et al., *CoDeF: Content Deformation Fields for Temporally Consistent
Video Processing*, 2023, [arXiv](https://arxiv.org/abs/2308.07926).

Repository consequence: the world reducer must preserve canonical identity and
the renderer interface should eventually accept persistent references,
correspondences, masks, depth, or motion fields. A changed prompt alone is
not a temporal-continuity mechanism.

### Structured state should remain separate from pixels

The cited object-centric and correspondence work separates scene content from
its spatial/temporal realization. This supports keeping a structured world
model above `Scene`, while treating prompts, procedural uniforms, diffusion
embeddings, and future reference conditioning as compiled realization
artifacts.

### Realization should accept more than text

ControlNet demonstrates a diffusion adapter that accepts spatial controls such
as edges, depth, segmentation, and pose alongside a pretrained text-to-image
model. VideoComposer similarly treats textual, spatial, and temporal signals
as composable conditions and introduces a spatio-temporal condition interface.

Sources: Zhang, Rao, and Agrawala, *Adding Conditional Control to Text-to-Image
Diffusion Models*, 2023, [arXiv](https://arxiv.org/abs/2302.05543); Wang et al.,
*VideoComposer: Compositional Video Synthesis with Motion Controllability*,
2023, [arXiv](https://arxiv.org/abs/2306.02018).

Repository consequence: the world engine should send a renderer-neutral
request containing world state, shot intent, diff, and continuous forces. The
current adapter may compile those fields to prompt/look/checkpoint controls;
future adapters can add references, depth, masks, pose, or motion fields
without changing the director contract.

### Research does not justify an immediate text-to-video replacement

These methods address representation and temporal consistency, not this
repository's real-time audio-reactive loop or 6 GB GPU budget. They support a
pluggable realization seam and persistent state, not an immediate migration to
an expensive video model.

## Design decisions grounded by the evidence

1. Make `WorldState` authoritative before improving the renderer.
2. Apply changes through a deterministic `SceneDiff` reducer.
3. Preserve entity IDs across action, camera, color, and atmospheric changes.
4. Compile structured state into the current prompt/look sidecar contract for
   now.
5. Reserve references, masks, depth, correspondence, and temporal latents for
   future realization adapters.
6. Evaluate identity and action at slow/offline rates rather than in the 60 Hz
   procedural loop.
7. Treat live ASR promotion as conservative evidence extraction, not as a
   complete semantic parser. The current implementation recognizes a small,
   explicit English/Japanese vocabulary and preserves unknown phrases as
   symbols. This keeps uncertain language from silently becoming invented
   entities while leaving room for a later multilingual parser.

The ASR boundary is informed by Whisper's multilingual speech-recognition
design, but Whisper transcription alone does not establish grounded entities,
actions, or persistent identity. Those remain director/world-model concerns.
Source: Radford et al., *Robust Speech Recognition via Large-Scale Weak
Supervision*, 2022, [arXiv](https://arxiv.org/abs/2212.04356).

## Claims this research does not support

- A prompt containing “coherent subject identity” guarantees identity.
- Raster feedback alone is equivalent to an object-centric world model.
- A five-second text-to-video clip solves interactive state continuity.
- CLIP similarity alone proves identity persistence or correct action.
