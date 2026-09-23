# Visual control layers

> **Architecture revision:** These controls apply to world entities, regions,
> camera, and materials. They must not collapse into global image transforms.

This document defines the semantic layers that determine how the visualizer
behaves. It is a design vocabulary, not a claim that every layer is already
implemented.

The purpose of the layers is to prevent the visualizer from becoming a list of
unrelated audio-reactive effects. Each layer answers a different question, and
one semantic decision should be able to fan out into several renderer
mechanisms.

## The core distinction

```text
rhythm       when does something happen?
timbre       what does the sound feel like?
energy       how forcefully does it happen?
motion       how does it move?
space        where does it happen?
material     what does the world appear to be made of?
memory       how much of the past remains?
lifecycle    how does the world transform over time?
composition  what should the viewer notice?
presentation how are color and light used?
```

These layers are related, but they should not collapse into one generic
`audioReactive` value. A slow, loud, smooth sound and a slow, loud, noisy sound
should be able to share rhythm and energy while differing in timbre and
material.

## Layer model

### 1. Rhythmic structure

Rhythm describes temporal organization: pulse, meter, subdivisions, accents,
syncopation, polyrhythms, tempo interpretations, and expressive feel.

It should produce both continuous phase state and typed events. See
[Rhythmic structure model](rhythm-model.md).

### 2. Timbre and sound character

Timbre describes the character of the sound independently of its timing.

Useful axes include:

- smooth ↔ noisy;
- warm ↔ bright;
- harmonic ↔ inharmonic;
- acoustic ↔ synthetic;
- soft ↔ distorted;
- pure ↔ complex;
- narrow-band ↔ wide-band;
- tonal ↔ percussive.

Likely evidence includes spectral centroid, spectral flatness, rolloff,
harmonicity, band balance, transient sharpness, stereo width, and optional
timbre embeddings. Timbre should influence material, edge behavior, detail,
and color temperature rather than directly selecting a shader.

The deterministic loopback analyzer now exposes flatness, rolloff, harmonicity,
and transientness as bounded measurements. These are evidence, not declarations
of instrument identity; they should remain available with provenance and
degrade to neutral values when capture is unavailable.

### 3. Energy and dynamics

Energy describes force and change, not merely loudness.

Useful axes include:

- quiet ↔ overwhelming;
- stable ↔ volatile;
- building ↔ releasing;
- compressed ↔ dynamic;
- sustained ↔ transient;
- tense ↔ relaxed.

Energy can drive scale, contrast, brightness, density, event strength, and the
rate at which the world changes. Relative loudness is more useful than a fixed
amplitude threshold because it distinguishes a quiet passage within a loud
track from a globally quiet track.

### 4. Density and sparsity

Density controls how much visual information is present.

- sparse ↔ crowded;
- minimal ↔ saturated;
- isolated ↔ layered;
- empty-space preserving ↔ full-frame.

This layer should coordinate particle count, field occupancy, number of active
forms, detail octave gain, and compositional breathing room.

### 5. Motion grammar

Motion describes the kind of movement, not just its speed.

- drifting;
- pulsing;
- orbiting;
- flowing;
- shearing;
- turbulent;
- snapping or quantizing;
- collapsing;
- blooming;
- oscillating.

Rhythm may trigger or phase-lock motion, but rhythm should not be responsible
for defining the motion vocabulary.

### 6. Spatial organization

Spatial organization determines where visual activity lives.

- centered ↔ edge-weighted;
- radial ↔ lateral;
- clustered ↔ distributed;
- foreground/background ↔ single plane;
- tunnel-like ↔ panoramic;
- local focal point ↔ field-wide activity.

This layer can fan out to attractors, camera framing, particle origins,
symmetry, depth, and post-process focus.

### 7. Scale

Scale establishes the apparent size of the world:

- microscopic;
- bodily or human-scale;
- architectural;
- planetary;
- cosmic.

Scale should affect feature size, camera distance, motion speed, depth cues,
and the relationship between detail and composition. It prevents every track
from feeling like the same simulation viewed at the same distance.

### 8. Material behavior

Material describes what the visual world seems to be made of:

- smoke or vapor;
- liquid;
- fire or plasma;
- glass or crystal;
- fabric;
- dust or grain;
- cells or biological tissue;
- circuitry or machinery;
- mineral strata;
- neural or pareidolic forms.

Material is broader than the current texture enum. It should determine how a
field deforms, emits light, forms edges, diffuses, fractures, and responds to
impulses.

### 9. Order and complexity

This layer controls the relationship between structure and chaos.

- organic ↔ geometric;
- symmetric ↔ asymmetric;
- repetitive ↔ evolving;
- ordered ↔ chaotic;
- legible ↔ ambiguous;
- coherent ↔ noisy.

It can coordinate symmetry, quantization, topology, noise contribution,
pattern repetition, and the stability of recognizable motifs.

### 10. Memory and persistence

Memory determines how much history survives.

- instantaneous ↔ trailing;
- forgetful ↔ accumulating;
- clean ↔ scarred;
- cyclical ↔ permanently transformed.

Memory should control feedback decay, reaction-diffusion persistence, particle
lifetime, trail length, and whether section changes modify or replace the
existing world. It is distinct from motion: a still world can have strong
memory, and a fast world can leave no trace.

### 11. Lifecycle and transformation

Lifecycle gives the world long-form behavior across sections.

- grow;
- split;
- mutate;
- erode;
- crystallize;
- bloom;
- decay;
- collapse;
- regenerate;
- reveal and conceal.

This layer is how the visualizer develops an arc instead of merely reacting
frame by frame. It belongs primarily in persistent world state and section
transitions, with rhythm and energy supplying impulses.

### 12. Focus and composition

Composition determines what the viewer should notice.

- one focal object ↔ distributed field;
- foreground ↔ background;
- reveal ↔ conceal;
- high negative space ↔ maximal fill;
- stable subject ↔ shifting subject;
- calm frame ↔ visually urgent frame.

Composition should coordinate camera, contrast, scale, depth, and activity
allocation. It is not the same as spatial organization: space says where
things are; composition says which relationship matters.

### 13. Color and light behavior

Palette chooses the color family. This layer chooses how color and light behave.

- stable ↔ continuously drifting hue;
- matte ↔ emissive;
- soft contrast ↔ graphic contrast;
- dim ↔ radiant;
- monochrome ↔ spectrally separated;
- warm ↔ cold;
- local glow ↔ global wash.

It should influence color fields, bloom, luminance range, shadowing, glow,
chromatic separation, and transitions without becoming another palette enum.

## Proposed semantic state

The eventual world state can represent these as bounded, blendable axes rather
than adding one question for every shader parameter:

```ts
interface VisualControlState {
  rhythm: RhythmicStructure;
  timbre: {
    smoothness: number;
    brightness: number;
    harmonicity: number;
    noisiness: number;
    percussiveness: number;
    stereoWidth: number;
  };
  energy: {
    intensity: number;
    volatility: number;
    momentum: number;
    transience: number;
  };
  density: number;
  motion: { flow: number; turbulence: number; quantization: number };
  space: { radial: number; spread: number; focality: number; depth: number };
  scale: number;
  material: { fluidity: number; crystallinity: number; cellularity: number; grain: number };
  order: { symmetry: number; structure: number; ambiguity: number };
  memory: { persistence: number; accumulation: number; decay: number };
  lifecycle: { growth: number; mutation: number; erosion: number; renewal: number };
  composition: { focus: number; negativeSpace: number; reveal: number };
  light: { emission: number; contrast: number; hueDrift: number; warmth: number };
}
```

This is a target shape, not an instruction to expose all of these fields to
the model immediately. The renderer adapter should derive implementation
parameters from this state and keep GPU-facing controls bounded.

## Decision hierarchy

The layers should generally be resolved at these timescales:

| Timescale | Best-suited layers |
| --- | --- |
| Track | scale, material priors, palette family, world identity |
| Section | energy arc, density, lifecycle, composition, material changes |
| Beat/event | rhythm impulses, local energy, motion response, light flashes |
| Frame | phase, flow, feedback, interpolation, simulation evolution |

The same event should have different visual effects depending on the current
world. A bass onset in a sparse crystalline world might fracture a surface; in
a smoky world it might create a pressure wave.

## Implementation order

Do not add all layers as independent System One questions. The recommended
order is:

1. Document and measure timbre, dynamics, density, and spatial evidence.
2. Add a versioned perceptual-state fixture for those observations.
3. Add semantic world axes for material, motion, memory, and lifecycle.
4. Derive renderer parameters through semantic fan-out.
5. Validate interventions one axis at a time while holding audio and seed
   constant.
6. Add scale, composition, and light behavior after persistent world dynamics
   are stable.

The success criterion is not “more knobs.” It is that near-neighbor tracks
with similar rhythm can produce visibly different worlds for explainable
reasons, while the same track remains coherent as its sections evolve.
