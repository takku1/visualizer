# Perceptual intent and emergent audiovisual worlds

Status: architectural research and decision input, 2026-09-24.

## Question

Should the director author literal scenes and entities, or should it emit a
lower-level perceptual intent that constrains a generative model while the
visual ontology emerges and persists from realization state?

## Short answer

The project should move toward a **hybrid emergent-world model**:

```text
music / evidence
        -> PerceptualIntent
        -> realization dynamics + continuity pressure
        -> visual realization
        -> optional observation hypotheses
        -> persistent realization memory
```

Literal semantic entities remain valid when evidence is strong, but they should
be anchors or constraints, not the default authoring vocabulary. The default
director output should describe form, material, spatiality, motion, lighting,
color, tension, affect, and continuity pressure.

This is not a claim that the current SD-Turbo loop already discovers or
remembers a world. It does not. The architecture should expose the seam while
the current backend realizes the intent through compiled text, procedural
grounding, and latent/raster feedback.

## What the research supports

### 1. Separate object-like state from global scene description

Slot Attention shows that object-centric representations benefit from a set of
separately addressable slots rather than one undifferentiated scene vector.
SlotFormer extends object-centric representations into temporal dynamics and
future-state prediction. This supports separating persistent realization
anchors from global perceptual intent, but it does not require those anchors to
be named human beings or literal objects.

Sources: Locatello et al., *Object-Centric Learning with Slot Attention*,
2020, [arXiv:2006.15055](https://arxiv.org/abs/2006.15055); Wu et al.,
*SlotFormer: Unsupervised Visual Dynamics Simulation with Object-Centric
Models*, 2022, [arXiv:2210.05861](https://arxiv.org/abs/2210.05861).

### 2. Persistence requires memory and correspondence, not prompt wording

TokenFlow propagates diffusion features using inter-frame correspondence, and
CoDeF separates canonical content from temporal deformation. Genie separates a
video tokenizer, a dynamics model, and latent actions in a learned interactive
environment. These works support a realization state that persists across
frames and changes, but they also show why an abstract prompt alone cannot
guarantee persistence.

Sources: Geyer et al., *TokenFlow*, 2023,
[arXiv:2307.10373](https://arxiv.org/abs/2307.10373); Ouyang et al., *CoDeF*,
2023, [arXiv:2308.07926](https://arxiv.org/abs/2308.07926); Bruce et al.,
*Genie: Generative Interactive Environments*, 2024,
[arXiv:2402.15391](https://arxiv.org/abs/2402.15391).

### 3. Abstract controls are useful, but they do not remove ambiguity

ControlNet demonstrates that spatial controls such as edges, depth,
segmentation, and pose can constrain a pretrained generator. VideoComposer
and motion-conditioned diffusion similarly compose text with spatial or motion
conditions. Sparse abstract controls can therefore leave room for a visual
prior to interpret them, but the controls must still be grounded by geometry,
motion, or reference state when continuity matters.

Sources: Zhang, Rao, and Agrawala, *Adding Conditional Control to Text-to-Image
Diffusion Models*, 2023,
[arXiv:2302.05543](https://arxiv.org/abs/2302.05543); Wang et al.,
*VideoComposer*, 2023, [arXiv:2306.02018](https://arxiv.org/abs/2306.02018);
Chen et al., *Motion-Conditioned Diffusion Model for Controllable Video
Synthesis*, 2023, [arXiv:2304.14404](https://arxiv.org/abs/2304.14404).

### 4. Emergence needs selection pressure and measurement

Quality-diversity work on Lenia demonstrates that simple local dynamics can
produce diverse self-organizing forms, but the interesting repertoire is found
through explicit diversity/quality measures and selection. Unbounded freedom
alone is not a reliable emergence mechanism: it can produce drift, collapse,
or visually novel but musically irrelevant output.

Source: Faldor and Cully, *Toward Artificial Open-Ended Evolution within Lenia
using Quality-Diversity*, 2024,
[arXiv:2406.04235](https://arxiv.org/abs/2406.04235).

### 5. Audiovisual alignment is about temporal correspondence as well as meaning

Look, Listen and Learn establishes audiovisual correspondence as a learnable
signal from unlabelled video. Recent time-alignment work argues that matching
when and how much change occurs can be more robust than requiring semantic
identity between musical and visual events. This supports keeping fast audio
forces and slow visual intent as separate channels, with evaluation of event
timing and change magnitude rather than demanding literal illustration.

Sources: Arandjelović and Zisserman, *Look, Listen and Learn*, 2017,
[arXiv:1705.08168](https://arxiv.org/abs/1705.08168); Lin et al., *V2M-Zero*,
2026, [arXiv:2603.11042](https://arxiv.org/abs/2603.11042).

## Critical pushback

The proposal is better aligned with the product than literal lyric
illustration, but four claims must be rejected:

1. **“The model will discover a coherent ontology.”** A text-conditioned
   single-image diffusion loop has no obligation to preserve the thing it
   happened to depict. Discovery without memory is just stochastic variation.
2. **“We do not care what the visual form is.”** We still need observables:
   temporal coherence, dominant-form persistence, change-point alignment,
   motion plausibility, diversity, and bounded semantic affordance. Otherwise
   we cannot distinguish emergence from noise.
3. **“Abstract intent is automatically less directive.”** Words such as
   `organic`, `fragile`, or `reaching` are still learned semantic controls and
   can collapse to familiar clichés. The director must emit distributions and
   pressure ranges, not a long poetic prompt.
4. **“Literal entities should disappear.”** Strong evidence, imported timed
   lyrics, or a persistent visual observation may justify an anchor. Removing
   anchors entirely would discard useful continuity information and make
   evaluation impossible for cases where identity actually matters.

## Recommended domain model

Use three distinct concepts:

```text
PerceptualIntent
  form, behavior, spatiality, materiality, motion, lighting, color,
  tension, affect, continuity pressure, evidence/confidence

EmergentWorldHypotheses
  anonymous persistent forms, appearance descriptors, spatial/depth hints,
  observation confidence, lifecycle/visibility, correspondence handles

RealizationState
  backend-specific latent/reference/mask/depth/motion memory and telemetry
```

`WorldState` should become the transport aggregate containing these bounded
parts, not a claim that every generated form has a known real-world identity.
`SongMeaning` proposes intent and optional anchors. `SceneDiff` expresses
changes to intent, hypotheses, and continuity pressure. Audio modulates
continuous forces against existing handles. The renderer compiles intent plus
realization state into text, spatial controls, references, or future temporal
latents.

## Product modes

The same engine should support two explicit modes rather than silently mixing
their promises:

- **Emergent mode (default):** perceptual intent is primary; literal entities
  are optional; evaluation emphasizes persistence of dominant forms, motion,
  audiovisual timing, novelty, and controlled change.
- **Grounded mode:** evidence-backed entities/actions are primary; evaluation
  additionally requires identity, action, and relation realization.

The current repository can implement emergent mode first using its existing
procedural grounding and SD-Turbo backend. Grounded mode remains limited until
reference conditioning, correspondence, or object-centric observation is
available.

## Migration consequences

1. Keep `SongMeaning`, evidence, abstention, `WorldState`, `SceneDiff`, and
   `ShotGraph`, but add a typed `PerceptualIntent` rather than replacing them
   with prompt strings.
2. Compile literal semantic motifs into optional affordances/anchors. Do not
   turn every lyric phrase into an entity.
3. Make the current procedural system emit motion/space/material controls and
   grounding frames, not authoritative visual content.
4. Add realization observation only as confidence-bearing hypotheses until a
   temporal observer is measured.
5. Evaluate novelty jointly with coherence and audio timing. Never optimize
   CLIP prompt similarity alone.
6. Do not switch to a large video model until the state/intent/observation
   contracts are stable and a measured backend decision justifies it.

