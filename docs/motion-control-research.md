# Semantic motion control research

> **Architecture revision:** The immediate production seam is now a structured
> scene/entity motion adapter, not a whole-image motion field. Whole-image
> fields remain useful only for background fallback. See
> [architecture.md](architecture.md).

## Question

How should the visualizer replace its fixed curl/swirl image deformation with
continuous, stateful motion controlled by music perception, lyrics, artwork,
System One, and the persistent `WorldState`?

The candidates are:

| Option | Core idea | Fit for this repository |
| --- | --- | --- |
| **A. Explicit semantic motion adapter** | Project `WorldState` distributions and fast audio events into a bounded 2D motion field and image deformation policy. | **Best immediate option.** Runs in WebGL2, is inspectable, cheap, and causally testable. |
| **B. Learned WorldState -> motion/model adapter** | Train a small adapter to map semantic state into motion fields, diffusion conditioning, or both while keeping the large model frozen. | **Best research direction after A.** Needs datasets, checkpoints, and intervention/evaluation data. |
| **C. Video/streaming diffusion model** | Use a temporal generative model to produce or update frames directly. | **Later option.** Strongest learned temporal prior, but substantially heavier and not a drop-in replacement for the current Electron/WebGL2 loop. |

## Findings from primary sources

### Temporal continuity is a state/ correspondence problem

TokenFlow shows that an image diffusion model can be used for temporally
consistent video editing by propagating diffusion features through
inter-frame correspondences, rather than independently editing every frame.
This supports preserving a persistent visual state and using correspondence
or warping as part of the update mechanism.

[TokenFlow paper](https://arxiv.org/abs/2307.10373)

FlowVid similarly combines image-to-image generation with optical-flow clues,
but explicitly handles imperfect flow instead of blindly trusting it. This is
important for our design: optical flow should be a measured motion constraint,
not the semantic controller and not an unconditional swirl field.

[FlowVid paper](https://arxiv.org/abs/2312.17681)

RAFT provides a strong learned optical-flow baseline and an official
implementation, but running a full flow network continuously inside this
desktop visualizer would add latency and GPU contention. It is more appropriate
for offline analysis, sparse keyframe alignment, or a later sidecar experiment
than for the first WebGL2 motion path.

[RAFT paper](https://www.ecva.net/papers/eccv_2020/papers_ECCV/papers/123470392.pdf) ·
[official RAFT repository](https://github.com/princeton-vl/RAFT)

### Diffusion supports multiple control surfaces, not only prompts

The Diffusers interfaces expose image-to-image inputs, prompt embeddings,
latents, callbacks, and adapter mechanisms. This makes it possible to cache
slow semantic conditioning and apply fast, bounded updates without asking an
LLM to rewrite a prompt on every beat.

[Diffusers text-to-image API](https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/text2img) ·
[Diffusers image-to-image API](https://huggingface.co/docs/diffusers/main/api/pipelines/stable_diffusion/img2img)

IP-Adapter adds image-conditioning cross-attention while leaving the base
model and original text pathway frozen. T2I-Adapter maps an external control
signal into features the pretrained model can use. Both support the longer-term
idea of a small `WorldState` adapter rather than arbitrary reshaping of
semantic vectors into model tensors.

[official IP-Adapter documentation](https://huggingface.co/docs/diffusers/using-diffusers/ip_adapter) ·
[T2I-Adapter paper](https://arxiv.org/abs/2302.08453) ·
[official T2I-Adapter documentation](https://huggingface.co/docs/diffusers/main/using-diffusers/t2i_adapter)

AnimateDiff demonstrates another route: a reusable motion module can be
inserted into a text-to-image model to produce animated clips while preserving
the base model's visual capabilities. This is evidence that motion can be a
separate learned module, but it is a clip generator, not automatically a
music-aware semantic controller or a 60 FPS browser renderer.

[AnimateDiff paper](https://arxiv.org/abs/2307.04725) ·
[official AnimateDiff repository](https://github.com/guoyww/AnimateDiff)

StreamDiffusion reorganizes diffusion inference for interactive generation,
including image-to-image use cases. It shows that diffusion can be made more
stream-like, but its throughput depends heavily on model, resolution, GPU, and
sampling configuration. It should be treated as a future sidecar/runtime
experiment, not assumed to replace the current renderer.

[StreamDiffusion paper](https://arxiv.org/abs/2312.12491) ·
[official StreamDiffusion repository](https://github.com/cumulo-autumn/StreamDiffusion)

### Music should control motion through time-varying controls

The closest relevant music-visual research found here uses audio energy and
harmonic/percussive features to control generated video interpolation. That
supports the project’s timescale split: audio events can provide fast control
signals, while semantic interpretation changes more slowly.

[Music-video diffusion study](https://arxiv.org/abs/2412.05694)

The official Mus2Vid repository is also a useful caution: it describes a
pipeline that analyzes music, converts it to text features, and feeds those to
image/video generation. That is a valid baseline, but it is still vulnerable
to prompt-level semantic loss and does not establish persistent world motion.

[official Mus2Vid repository](https://github.com/Purdue-Artificial-Intelligence-in-Music/Mus2Vid-code)

## Recommendation

Use **A as the production architecture now**, with B as the research path and
C as a gated later branch.

The central rule should be:

```text
music / lyrics / artwork / learned perception
                    |
                 System One
                    |
             persistent WorldState
                    |
          semantic motion adapter
                    |
       bounded WebGL2 motion field
                    |
             image-space evolution
```

System One should not emit renderer nouns such as `swirl=0.7` or
`rotation=0.4`. It should emit distributions and persistent targets such as:

```text
form:       organic .68, architectural .14, atmospheric .18
behavior:   flowing .52, growing .31, turbulent .08
persistence: stable .74, drifting .19, ephemeral .07
space:      vast .61, intimate .12, enclosed .27
```

The renderer adapter derives a motion grammar from those distributions:

```text
organic + flowing + stable
  -> low-frequency advection, breathing, mild drift, little rotation

architectural + structured
  -> planar translation, parallax-like offsets, near-zero curl

turbulent + ecstatic
  -> stronger local distortion and event response, still bounded

decaying + melancholic
  -> settling, erosion, low-frequency displacement, reduced persistence
```

The adapter should produce a field and policy, not one global transform:

```ts
type WorldMotion = {
  fieldMode: 'drift' | 'breathing' | 'planar' | 'flow' | 'settle';
  drift: { x: number; y: number };
  rotation: number;       // small residual term, normally near zero
  radial: number;
  localWarp: number;
  breathing: number;
  settling: number;
  eventResponse: number;
  memory: number;
};
```

Immediate audio events modify this policy locally and temporarily. A kick is
an impulse into the current field, not a request to draw a ring or rotate the
entire image. The section-scale semantic state decides whether that impulse
becomes branch recoil, planar flex, local expansion, a brief detail release,
or almost nothing.

### Why not choose C now?

A video model would provide a stronger learned prior for temporal motion, but
it would also introduce a second high-cost render loop, model-specific
conditioning, larger memory requirements, and a difficult handoff between
generated frames and WebGL2. It may produce smoother clips while still
remaining semantically opaque. The current problem is not only temporal
consistency; it is that one fixed curl/feedback policy is imposing the same
meaning on every song.

Keep the image checkpoint as a sparse material/identity updater until the
motion adapter proves that the world can move coherently without global swirl.

## Staged experiments

### Experiment A0 — remove forced global motion

Hold the current image material constant. Disable global feedback rotation,
zoom, and smear in image-primary mode. Replace them with zero-mean,
low-frequency drift and a small local displacement field. Keep the procedural
path available as an explicit fallback.

**Pass condition:** no obvious single-axis orbit or universal vortex over a
30-second capture; the image remains readable while slowly evolving.

Implementation status: the image-primary renderer now bypasses global feedback
rotation, zoom, smear, reaction-diffusion updates, particles, bloom, and the
HDR presentation path. Its remaining motion is a bounded semantic drift,
breathing, growth, and settling policy. The old procedural stack remains
available only as a fallback/A-B path.

### Experiment A1 — semantic motion projection

Add `WorldMotion` to the logged renderer telemetry. Derive it from WorldState
with a pure adapter. Run paired interventions with identical audio, seed,
image, and beat events:

```text
organic .80       vs architectural .80
stable .85        vs ephemeral .85
flowing .80       vs suspended .80
```

**Pass condition:** each intervention changes the predicted motion grammar,
not merely color or brightness.

### Experiment A2 — event impulses

Apply bass/onset events as bounded local perturbations to the semantic motion
field. Do not call the image model on each event. Log event strength,
WorldMotion before/after, displacement magnitude, and recovery time.

**Pass condition:** events are visible when the world is responsive, but do not
accumulate into runaway rotation or destroy motif continuity.

### Experiment A3 — correspondence-aware continuity

Compare the current WebGL displacement field against sparse optical-flow
alignment on captured frames. Use RAFT or another official flow implementation
offline first; do not put it in the 60 FPS loop yet.

**Pass condition:** flow improves motif survival or reveals useful failure
cases without becoming the semantic motion source.

### Experiment B0 — learned adapter, frozen visual model

Record tuples of `WorldState`, audio context, desired motion controls, and
rendered outcomes. Train a small adapter to predict `WorldMotion` or supported
diffusion conditioning from those inputs. Keep the image checkpoint frozen.

Start with imitation of the explicit adapter, then test whether the learned
adapter improves continuity or semantic intervention scores. A supported
IP-Adapter/T2I-Adapter-style path is preferable to manually reshaping vectors.

### Experiment C0 — streaming/video branch

Only if A1/A2/A3 show that WebGL deformation cannot produce adequate motion,
test AnimateDiff or StreamDiffusion in a separate sidecar. Compare it against
the same WorldState and event traces, not against a hand-tuned demo.

**Pass condition:** the model improves temporal identity and music alignment
enough to justify its latency, GPU memory, and operational complexity.

## Decision

### Revised decision: structured local motion is the production seam

The earlier recommendation of a semantic motion field over an image remains a
background fallback only. The primary seam is now:

```text
WorldState + SpatialScene + event
          -> per-entity motion policy
          -> masks/depth/pose/correspondence
          -> local WebGL simulation or model control
```

Global image motion may operate on an unstructured background layer, but it
must not be used as the representation of character or motif motion. The next
experiment is therefore one persistent entity with independently controlled
regions, followed by a sidecar that returns aligned spatial channels.

The project should first build a **semantic motion adapter over the existing
WebGL2 image surface**, with optical flow used as a measured correspondence
signal and diffusion used as a sparse identity/material updater. A learned
WorldState adapter is the next research step. A video/streaming model is a
controlled experiment after the cheaper, observable architecture has been
validated.

This keeps the responsibilities clean:

```text
DSP                 -> when and how strongly an event occurs
learned perception  -> what the sound resembles
System One          -> what the world means
WorldMotion adapter -> how that world is allowed to move
image checkpoint    -> visual material and identity updates
WebGL2              -> continuous 60 FPS realization
```
