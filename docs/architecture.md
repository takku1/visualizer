# Canonical architecture: persistent semantic worlds

This is the governing architecture. The project is not primarily an audio
reactive shader demo and it is not an image slideshow. It is a music-directed
world system whose realization may be procedural, image-based, or temporal AI.

## System shape

```text
Spotify / track context
  audio · lyrics · artwork · metadata · structure
        |
        v
Multimodal perception
  DSP · rhythm · audio embedding · text/image evidence
        |
        v
World identity
  setting · motifs · entities · palette · scale · memory
        |
        v
System One / Jev
  semantic distributions · section deltas · event policy
        |
        v
Persistent structured world
  entities · regions · depth · pose · lifecycle · relationships
        |
        +-----------------------+
        v                       v
World simulation              AI realization sidecar
  local motion · events       latent/image/video updates
  interpolation               masks · depth · correspondence
        |                       |
        +-----------+-----------+
                    v
           WebGL2 presentation
       60 FPS compositing and fallback
                    |
                  pixels
```

## Core decision

`WorldState`, not an image, is the semantic waist. The application owns
identity, entities, regions, motion intent, lifecycle, and memory. A model may
render or update that state, but a generated PNG or video clip is never the
authoritative source of identity.

The scene bible is therefore the long-lived identity portion of `WorldState`,
not a separate prompt document. New sections edit the existing world:

```text
preserve entity_01
agitation += .18
flower_motif += .22
environment_openness += .14
camera_energy += .10
```

## State ownership

### Application-owned state

- `WorldIdentity`: stable track-scale setting, motifs, entities, palette, scale.
- `WorldDynamics`: section targets, lifecycle, relationships, camera, memory.
- `SpatialScene`: entities, masks, depth, pose, tracks, correspondences,
  confidence, and provenance.
- `EventState`: typed beat/onset impulses and their bounded recovery.

### Model-owned state

- latent/video memory;
- cached text/image/audio conditioning;
- generated material;
- model-specific feature maps;
- optional temporal keyframes.

### Browser-owned state

- textures and buffers;
- interpolation;
- local motion fields;
- compositing and presentation fallback.

## Timescales

| Loop | Cadence | Responsibility |
| --- | --- | --- |
| Track | track change | perceive context and establish world identity |
| Section | seconds / boundaries | edit meaning, entities, lifecycle, and conditioning |
| Event | beat/onset | apply bounded local impulses; do not regenerate the world |
| Realization | sparse async | update material/latent/video state and validate continuity |
| Frame | 60 FPS | interpolate, simulate local motion, composite, present |

## People and entities

A person is an entity with identity and parts, not a texture rectangle:

```text
entity_07
  type: human
  identity: persistent reference
  depth: 0.37
  pose: body / hands / face
  regions: face, hair, torso, clothing, left_arm, right_arm
  motion_permissions: clothing=.55, hair=.31, body=.08
```

This lets the same bass event disturb clothing, fog, and hanging objects while
leaving the face stable. The first implementation may use 2D pose and masks;
3D body models are a later option.

## Realization rule

System One emits meaning and constraints. A model adapter translates those
constraints into supported controls such as prompt embeddings, reference
images, depth, segmentation, pose, ControlNet, IP-Adapter, or motion modules.
Never reshape semantic vectors into arbitrary checkpoint tensors.

The sidecar API should become stateful:

```text
POST /v1/world/start
POST /v1/world/update
GET  /v1/world/state
POST /v1/world/reset
```

An update returns a revision, continuity score, accepted/rejected status,
material or latent channels, and the entities/regions it claims to preserve.
Stale or failed updates never replace the current world.

## Fallbacks

The existing procedural renderer remains a valid fallback and measurement
branch. It is not the target visual identity. The browser remains useful when
the sidecar is disabled, slow, unavailable, or rejected by continuity checks.

See [architecture-research.md](architecture-research.md) for source-backed
technology decisions and [SYSTEM.md](SYSTEM.md) for implementation contracts.

