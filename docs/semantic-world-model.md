# Semantic world model

`WorldState` is the versioned, probabilistic, application-owned state between
perception, System One, realization models, and WebGL2. It is not shader
settings, a prompt, an image, or a model tensor.

```ts
interface WorldState {
  revision: number;
  identity: WorldIdentity;
  dynamics: WorldDynamics;
  scene: SpatialScene;
  events: WorldEvent[];
  realization: RealizationRef;
}
```

## Identity

```text
WorldIdentity
  seed
  setting
  motifs
  entities
  palette
  material
  scale
  visualMemory
```

Identity is established at track cadence and changes slowly. A chorus edits
the existing identity; it does not silently create a new protagonist.

## Dynamics

Semantic axes remain distributions rather than winner-take-all labels:

```text
affect · form · space · material · behavior · coherence
persistence · density · composition · lifecycle · light
```

`WorldDelta` contains targets, additions, preservation requests, erosion
requests, and a bounded `WorldMotion` grammar. It may refer to entity IDs and
regions, but never to GPU uniform names.

## Spatial scene

```text
SpatialScene
  entities[]
    id · type · identity · bbox · depth
    regions[] · pose? · track? · confidence
  camera
  correspondence
  provenance
```

Regions may be coarse masks at first. They are still essential because they
give the runtime a place to apply local motion and give realization models
structural controls.

## Motion and events

System One may choose `drifting`, `breathing`, `revealing`, `fracturing`,
`settling`, `eroding`, or `suspended`. The adapter derives bounded fields and
per-region policies. A bass event is an impulse, not a ring or global rotation.

```text
WorldEvent
  kind: bass | onset | lyric | section
  strength
  targets: entity/region IDs or semantic selectors
  duration
```

## Realization boundary

```text
WorldState
  -> model-specific adapter
  -> valid conditioning / latent update
  -> RealizationState
```

`RealizationState` may contain material, depth, masks, motion hints, latent
revision, and continuity metadata. It is replaceable and must not redefine
the world when a model fails.

## Compatibility

`VisualPlan` remains the deterministic fallback/A-B contract. It is not the
long-term learned-world control surface.

