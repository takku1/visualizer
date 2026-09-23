# Image conditioning research

> **Architecture revision:** Conditioning must carry structured spatial state
> (reference, depth, masks, pose, and motion controls) in addition to semantic
> context. Prompt-only continuation is a compatibility baseline.

## Question

Can music perception, lyrics, and System One's semantic vectors steer an image
checkpoint directly and continuously, instead of waiting for an unrelated
text-to-image result?

## Short answer

Yes, but there are three different levels of integration:

```text
Level 1: semantic compiler
WorldState + perception -> compact structured prompt -> cached text embeddings

Level 2: persistent generation
previous image/latent + new embeddings + low strength -> image-to-image update

Level 3: trained semantic adapter
WorldState/audio/lyrics vectors -> model conditioning tokens or feature maps
```

Level 1 and Level 2 are practical now. Level 3 is the architecture we should
eventually test, but it requires training data and a model-specific adapter.

## What existing diffusion interfaces support

Diffusers pipelines accept precomputed `prompt_embeds`, image-to-image inputs,
latents, and IP-Adapter image embeddings. We therefore do not need to
re-tokenize or reinterpret all context for every update. Text embeddings can
be cached at track/section cadence, while latents can persist between updates.
See the [text-to-image pipeline interface](https://huggingface.co/docs/diffusers/api/pipelines/stable_diffusion/text2img)
and the [image-to-image interface](https://huggingface.co/docs/diffusers/main/api/pipelines/stable_diffusion/img2img).

IP-Adapter is a concrete lightweight learned projection: an image encoder
produces features that enter new cross-attention layers while the base UNet and
original text attention remain frozen. See the [official IP-Adapter documentation](https://huggingface.co/docs/diffusers/using-diffusers/ip_adapter).

T2I-Adapter maps an external control signal into a pretrained model's internal
knowledge while keeping the base model frozen. This is close to a future
`WorldState -> image conditioning` adapter. See the [T2I-Adapter paper](https://arxiv.org/abs/2302.08453)
and [Diffusers guide](https://huggingface.co/docs/diffusers/main/using-diffusers/t2i_adapter).

## What will not work reliably

We should not copy or reshape a semantic vector into a text-encoder embedding
tensor. Matching dimensions do not mean the model has learned that coordinate
system; the result would be arbitrary conditioning, not semantic control.

An LLM-generated prompt every few seconds is also only a temporary adapter. It
can add latency and semantic drift. The LLM should compile perception into a
stable typed `WorldState`, not rewrite a long visual prompt on every beat.

## Recommended architecture

### Track cadence

Encode stable context once:

```text
title / artist / artwork / lyrics / whole-track audio embedding
                              |
                              v
                    track WorldState identity
                              |
                              v
                    cached conditioning tokens
```

### Section cadence

System One produces a semantic delta. A compiler converts it into a stable,
inspectable `ConditioningPacket`:

```text
WorldState distributions
audio trend / section label
lyrics semantic window
previous motif summary
                 |
                 v
ConditioningPacket
  prompt_embeds or prompt text
  negative_embeds
  image_strength
  latent_seed
  spatial / palette / structure controls
```

The first implementation may use a compact prompt as a compatibility layer,
but must log the packet so it can later train or replace that compiler.

### Continuous cadence

Do not generate a new text-to-image image for every event. Keep the previous
image or latent and use image-to-image with low strength. Low strength keeps
existing composition; higher strength is reserved for explicit world
transitions. Audio events should usually modify the WebGL world directly, not
invoke diffusion.

Latent Consistency Models and LCM-LoRAs reduce diffusion to roughly 2–4 steps
and support image-to-image and adapter combinations. They are a speed option,
not a substitute for persistent state. See the [official LCM documentation](https://huggingface.co/docs/diffusers/main/using-diffusers/inference_with_lcm_lora).

## Best next experiment

1. Keep the current Tiny-SD sidecar and semantic world.
2. Make the sidecar retain the last generated image as its input.
3. Add a `ConditioningPacket` containing world labels, continuous distributions,
   lyrics summary, audio trend, and previous-world memory.
4. Use image-to-image at low strength for section updates.
   If continuation fails, hold the current material; never substitute an
   unrelated fresh text-to-image result.
5. Compare independent text-to-image, crossfaded independent images, and
   persistent image-to-image continuation using the same music and seed.
6. Measure motif survival, semantic intervention response, generation latency,
   and subjective continuity.

Only after this shows a real limitation should we train a direct semantic
adapter. That adapter would project typed WorldState into model cross-attention
tokens, analogous in spirit to T2I-Adapter or IP-Adapter, and would be
evaluated with causal interventions rather than prompt aesthetics.

## Decision

### Revised decision: condition the scene, not just the image

Prompt embeddings remain a compatibility adapter. The preferred conditioning
packet now includes stable entity references, region masks, depth, pose, camera
and motion constraints, alongside semantic context. ControlNet/IP-Adapter-style
interfaces are the model boundary; arbitrary vector reshaping remains invalid.

The project should not jump to a video checkpoint yet. The immediate upgrade
is **semantic conditioning packets plus persistent image-to-image/latent
state**. The long-term upgrade is a **small trained WorldState conditioning
adapter**. Video generation remains a later option if image-to-image cannot
preserve motion and identity well enough.

## Revised control-bus direction

The next architecture is not “System One writes a prompt.” It is a small
control bus with separate timescales:

```text
music DSP / learned perception ──> fast event controls
lyrics / metadata / System One ──> semantic conditioning
WorldState + previous material ──> persistent image/latent state
                                  └─> lightweight WebGL display
```

The current implementation is the compatibility stage of that design:
`ConditioningPacket` carries the typed world, bounded audio summary, lyrics
snippet, negative conditioning, and transition strength. The sidecar uses the
first request for text-to-image and later requests for low-strength
image-to-image continuation, reusing the prior image rather than starting a
new visual world.

The research target after this stage is a model-specific control bus:

```text
WorldState distributions ──> cached semantic anchors / prompt embeddings
structure or motif state ──> adapter features
beat / onset impulse ──────> strength, noise, or latent perturbation
                                  |
                                  v
                         frozen image model
```

This must be introduced experimentally. Embeddings from unrelated spaces must
not be reshaped into the diffusion model's tensor space; a real adapter must
be trained or use a supported mechanism such as prompt embeddings,
IP-Adapter, T2I-Adapter, or a model-specific control interface. AudioToken's
audio-to-diffusion adaptation and StreamDiffusion's persistent streaming
approach are useful precedents, not dependencies for the current desktop
build: [AudioToken](https://arxiv.org/abs/2305.13050),
[StreamDiffusion](https://arxiv.org/abs/2312.12491), and the
[Diffusers adapter interfaces](https://huggingface.co/docs/diffusers/main/api/pipelines/stable_diffusion/adapter).

The progression is therefore:

```text
prompt the model  ->  preserve and steer the model
                  ->  play the model with fast events
                  ->  train System One's adapter to play it
```

The existing renderer remains the continuity fallback while these experiments
are measured. It should not be mistaken for evidence that a video checkpoint
is required: the key test is whether motif survival and semantic interventions
improve before adding a heavier video model.
