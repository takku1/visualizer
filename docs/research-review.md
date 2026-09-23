# Research review: structured persistent world rendering

> **Architecture revision:** This review is now subordinate to
> [architecture.md](architecture.md). The target is an application-owned,
> entity-aware world. Raster substrate and procedural effects are realization
> backends, not the world itself.

> Direction update: the earlier procedural-world then RGB-substrate sequence is
> retained as validation history. The active target is the latent-native
> architecture in [end-to-end architecture v2](end-to-end-architecture-v2.md)
> and [latent-native world architecture](latent-native-world-architecture.md).

## Assessment

The proposal is a strong north star. Its central move is to replace a direct `music -> AI -> visualizer` framing with:

```text
music -> perception -> meaning -> world model -> generative program -> pixels
```

That framing explains several behaviors the current project already wants: probabilities should remain distributions, beat events should be impulses rather than fixed visual metaphors, and feedback should preserve history instead of regenerating unrelated frames.

The proposal should be treated as an architecture and a set of testable hypotheses, not as permission to add every listed subsystem now. The highest-value experiment is the one identified in the research: learned music perception -> richer perceptual state -> semantic world state -> persistent world latent -> one structural primitive -> world-dependent impulses.

## What is already implemented

The repository has a credible substrate:

- DSP includes band energy, flux, level, spectral centroid, stereo width, chroma, key estimates, beat/bar phase, sections, tempo, and confidence.
- A director seam accepts state and typed questions and returns distributions rather than only argmax labels.
- Semantic fan-out maps a small set of decisions into motion, texture, geometry, symmetry, feedback, palette, and intensity.
- The renderer is stateful: ping-pong buffers, reaction-diffusion, particle state, feedback, transitions, and optional hard cuts all preserve or transform visual history.
- Album artwork already contributes track-level color DNA without entering the frame-by-frame decision loop.

These are not future concepts; they are the compatibility surface for the next layer.

## What is proposed but not yet a contract

- A learned audio encoder and multimodal track embeddings.
- Lyrics and artwork embeddings as track-scale semantic inputs.
- A typed semantic world state with affect, form, space, behavior, coherence, persistence, and abstraction distributions.
- Explicit track, section, and beat timescales.
- A generative graph that composes primitives such as implicit fields, SDFs, flow, reaction-diffusion, particles, feedback, and symmetry.
- Optional semantic keyframes generated slowly and consumed as material by the real-time simulation.
- A learned System One head internal to the application.

Each item needs an experiment and an acceptance measure before becoming a production dependency.

## Architectural verdict

### Revised verdict

The project should now treat structured spatial state as the missing organ.
The previous semantic-waist conclusions remain valid, but the waist must grow
from semantic distributions into an entity/region scene model before another
large image or video checkpoint is evaluated.

Adopt these principles now:

1. Perception and reasoning are separate. DSP describes measured events; learned encoders describe resemblance or context; System One assigns semantic meaning.
2. Reasoning outputs a world state, not renderer knobs. Renderer parameters remain derived, implementation-specific projections.
3. The world persists. Semantic updates should usually be deltas or targets applied to existing state.
4. Timescales are explicit. Track identity, section evolution, and beat response must not share one update loop.
5. Real-time rendering remains bounded and GPU-native. Heavy generation is optional, sparse, and outside the 60 FPS path.
6. Full distributions remain observable. Do not collapse concepts to a winner when mixtures are part of the visual language.

Defer these decisions:

- The specific learned audio checkpoint.
- Whether System One remains external, local, or becomes a learned head.
- The exact generative graph representation.
- Diffusion/keyframe generation.
- Any new semantic dimension that is not justified by an observed failure in the current validation pass.

## Main risks

The proposal has four material risks:

- Semantic overreach: a model may produce plausible labels without producing visibly meaningful change.
- State drift: persistent worlds can accumulate unstable energy, stale semantics, or transitions that never settle.
- Calibration mismatch: distributions from a learned encoder or external model may not be comparable to local probabilities.
- Evaluation ambiguity: “dreaming a place” is compelling but subjective, so qualitative review must be paired with logs, ablations, and near-neighbor A/B tests.

The roadmap addresses these by retaining the deterministic baseline, logging intermediate state, and gating each architectural expansion.

## Image-model addendum

The image-model question fits cleanly if the semantic world remains the waist between understanding and realization. There are three distinct experiments, and they should not be conflated:

- sparse image or latent material generated from the world state;
- a learned projection from world-state distributions into an image model's conditioning space;
- occasional visual encoding of the system's own output as feedback.

The first is a practical Phase 5 candidate. The second is a research direction that could let procedural and neural realizers share semantic causes. The third is deliberately deferred because it creates a closed-loop controller with latency and stability risks.

The key test is not whether an image model can make attractive frames. It is whether the same semantic intervention that changes the procedural realization also changes the learned realization in the predicted direction. If `organic=.8` versus `architectural=.8` cannot be observed coherently in both branches, the semantic waist is decorative rather than causal.
