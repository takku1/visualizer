# Online review of follow-up ideas

This note reviews the open questions from
[`specimen-followups-not-yet-proven.md`](specimen-followups-not-yet-proven.md)
against primary research. It is research only; no claims here are promoted into
the specimen preprint.

## Current project status

Since the earlier review, the project has implemented a local manifest seam in
`src/director/semantic.ts` and `meaning/`: evidence-bearing `SongMeaning`
objects, a `MotifLedger`, semantic scene compilation, and explicit abstention
when no manifest exists. This is implementation evidence, not effectiveness
evidence. The remaining research question is whether these structures produce
better or more coherent visuals than the prior metadata/concept path.

## 1. What should the director receive as `q`?

The literature supports treating `q` as a **multi-source evidence bundle**,
not as one embedding:

```text
metadata + artwork + lyrics/timestamps + musical structure + audio-language
caption/QA + confidence/provenance
```

### What the sources establish

- [CLAP](https://arxiv.org/abs/2206.04769) learns a joint audio/text space for
  flexible audio concepts. This is useful for retrieval, similarity, and
  candidate concept scoring. It does not by itself produce a timestamped song
  narrative or establish that a visual subject is literally in the lyrics.
- [MusCaps](https://arxiv.org/abs/2104.11984) treats music description as
  audio captioning with temporal attention. This supports adding an audio
  caption as one evidence source, but a caption remains a summary and should
  not be treated as ground truth.
- [MU-LLaMA](https://github.com/shansongliu/MU-LLaMA) presents a music
  understanding model built around MERT and LLaMA for music QA and captioning.
  It supports the idea of asking targeted questions such as “what is the
  emotional progression?” rather than requesting one unconstrained prompt.
- [MOSS-Music](https://github.com/OpenMOSS/MOSS-Music) explicitly targets
  musical captioning, lyrics transcription, structural analysis, chord/key/
  tempo reasoning, and long-form music QA. This is close to the desired future
  input surface, but it remains a candidate provider, not evidence that this
  project has implemented the capability.

### Design implication

`q` should be a typed bundle where every claim has source, confidence, and time
scope. Embeddings can be retained for retrieval, but the director should make
decisions from interpretable extracted claims and their provenance. The first
useful experiment is an ablation over metadata-only, metadata+lyrics, and
metadata+audio-language sources.

## 2. Weighted plans and prompt blending

The project’s weighted choice mechanism is conceptually defensible, but the
research does not justify assuming that a probability mixture over labels is a
probability mixture over images.

[Classifier-Free Guidance](https://arxiv.org/abs/2306.17806) describes
conditioning as movement in a learned representation and discusses vector
arithmetic/interpolation in semantic spaces. This supports blending or
interpolating conditioning vectors as a mechanism. It does not guarantee that
linear interpolation produces a meaningful midpoint between arbitrary visual
concepts.

The correct claim boundary is:

```text
implemented: weighted labels blend renderer parameter vectors;
implemented: selected prompt embeddings can be blended in the sidecar;
unproven: the visual midpoint is semantically calibrated or aesthetically better.
```

The evaluation should test interpolation pairs separately: same subject/different
lighting, same world/different action, and incompatible subjects. Measure
semantic continuity, visual novelty, drift, and whether the midpoint is useful
rather than merely blurry.

## 3. Trusted downbeats and timing uncertainty

The project is right to make beat confidence explicit. Downbeat tracking is not
an infallible clock:

- [Robust Downbeat Tracking Using an Ensemble of Convolutional Networks](https://arxiv.org/abs/1605.08396)
  models downbeat likelihoods and decodes them with a temporal model that
  exploits metrical continuity.
- [Downbeat Tracking with Tempo-Invariant Convolutional Neural Networks](https://arxiv.org/abs/2102.02282)
  shows that tempo variation affects generalization and proposes a
  tempo-invariant time-warping operation.
- [Drum-Aware Ensemble Architecture for Improved Joint Musical Beat and Downbeat Tracking](https://arxiv.org/abs/2106.08685)
  separates percussive and non-percussive evidence before fusing beat/downbeat
  estimates, showing that source composition affects tracking reliability.

### Design implication

Treat a downbeat as a hypothesis with a posterior/confidence, not a boolean
fact. A checkpoint should carry:

```text
target beat/bar
timing source
confidence
predicted commit time
actual commit time
phase error
fallback path
```

The scheduler can then choose among exact downbeat, nearby trusted beat, or
safe hold. The visual director should not silently compensate for a timing
error by changing semantic content.

## 4. Continuity scalar versus identity preservation

The review is correct that the current scalar `continuity` is only a renderer
transition parameter. Research on identity-preserving generation treats
identity as an explicit conditioning problem:

- [MagicAnimate](https://arxiv.org/abs/2311.16498) adds temporal modeling and
  an appearance encoder to preserve a reference identity during motion.
- [StableAnimator](https://arxiv.org/abs/2411.17697) uses image/face embeddings
  and a dedicated identity adapter for human animation.
- [ST-DRC](https://arxiv.org/abs/2606.02441) separates spatial-temporal
  reference conditioning and exposes independent control over text adherence
  and reference fidelity.
- [Make-A-Story](https://arxiv.org/abs/2211.13319) uses visual memory for actor
  and background context across story frames/scenes.

### Design implication

Identity persistence requires an identity-bearing reference or memory path; a
scalar continuity value cannot substitute for one. For this project, the
practical progression is:

1. use the procedural frame as structural grounding;
2. measure whether prompt/latent continuity preserves coarse subject identity;
3. add a reference-anchor path if it does not;
4. only then describe continuity as identity preservation.

The current 6 GB local constraint makes a full identity adapter a future
experiment rather than an immediate assumption.

## 5. What is genuinely new in the proposed combination?

The individual pieces have close precedents: audio-language concepts, spatial
diffusion control, motion modules, visual memory, and downbeat tracking. The
potentially unusual combination is narrower:

```text
uncertain song meaning
  → evidence-backed shot/scene state
  → procedural beat-synchronous structure
  → fresh-frame diffusion paint
  → downbeat-committed checkpoint transitions
```

That combination should be presented as a systems hypothesis, not a novelty
claim, until a related-work sweep and controlled ablation establish what is
actually distinctive.

## Recommended experiments before specimen promotion

### Director-input ablation

For a fixed song set, compare:

1. audio features + metadata;
2. + artwork;
3. + lyrics/timestamps;
4. + audio-language caption/QA;
5. fused evidence with abstention.

Score subject/relationship recognition, song/world coherence, and false
semantic commitments.

### Timing ablation

Compare exact provider downbeats, inferred downbeats, nearby-beat fallback, and
hold-until-confidence. Report phase error and perceived synchronization.

### Continuity ablation

Compare scalar continuity, procedural grounding, persistent prompt/embedding
anchors, and reference-image conditioning if available. Report identity
survival, drift, jitter, and generation cost.

### Weighted-plan ablation

Compare argmax plans against weighted parameter blending and prompt-embedding
blending. Do not assume the smoothest output is the most semantically correct.

## Bottom line

The online literature reinforces the review rather than overturning it:

- `q` should be a provenance-bearing multimodal evidence bundle;
- weighted plans are a renderer mechanism whose semantic calibration is unproven;
- downbeats require confidence and phase-error receipts;
- continuity needs explicit identity conditioning or memory, not only a scalar;
- the specimen should remain frozen until these hypotheses have project-level
  evidence.
