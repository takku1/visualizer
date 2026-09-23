# Architecture research: persistent structured worlds for music-driven visuals

Date: 2026-09-22

## Question

What architecture can move this project from generated images and global warps
toward persistent scenes containing recognizable entities, local motion, and
optional AI-generated video?

## Conclusion

The best fit is a **structured world state with multiple realization backends**:

```text
track inputs
  -> multimodal perception
  -> WorldIdentity + WorldState
  -> System One semantic deltas
  -> entity/region/pose/depth state
  -> model-specific realization adapter
  -> sparse material/video updates
  -> WebGL2 display and local simulation
```

The image or video model must not be the authoritative world. It is a renderer
or world-state updater. Identity, entities, regions, lifecycle, and event
semantics belong to the application-owned state.

## Evidence from primary sources

### Temporal models provide motion, not application state

AnimateDiff adds motion modules to image diffusion models and exposes pipelines
for text-to-video, video-to-video, ControlNet, and sparse controls. This makes it
a useful realization backend, but its interface remains a generation pipeline:
frames, prompts, conditioning images, latents, and motion adapters. It does not
provide the persistent entity database or music-semantic world model this
project needs.

Sources: [Diffusers AnimateDiff documentation](https://huggingface.co/docs/diffusers/api/pipelines/animatediff),
[official AnimateDiff repository](https://github.com/guoyww/AnimateDiff).

### Spatial controls are the right bridge into image/video models

ControlNet supports structural controls such as depth, segmentation, edges,
and human pose while keeping the base model frozen. IP-Adapter adds image-based
conditioning through separate cross-attention while preserving the original
text pathway. These are evidence for a model-specific adapter boundary:

```text
WorldState -> depth/pose/mask/reference controls -> supported model adapter
```

Do not reshape arbitrary semantic vectors into hidden tensors.

Sources: [Diffusers ControlNet documentation](https://huggingface.co/docs/diffusers/using-diffusers/controlnet),
[Diffusers IP-Adapter documentation](https://huggingface.co/docs/diffusers/using-diffusers/ip_adapter).

### Persistent regions need memory outside the generator

SAM 2 is explicitly designed for promptable image/video segmentation with
streaming memory and multi-object video propagation. CoTracker provides point
tracking over video. These capabilities support a region/entity layer that
maintains identities and correspondence between sparse generated updates.

Sources: [official SAM 2 repository](https://github.com/facebookresearch/sam2),
[official CoTracker repository](https://github.com/facebookresearch/co-tracker).

### People need an explicit articulated representation

SMPL-X represents body, face, and hands together and exposes pose, expression,
and hand parameters. It is not required for the first prototype, but it shows
the shape of the missing abstraction: a person is an articulated entity, not a
rectangle that can be rotated.

Source: [official SMPL-X repository](https://github.com/vchoutas/smplx).

## Architecture decision

Adopt five state layers:

1. **World identity** — stable setting, motifs, entities, palette, scale, and
   visual memory for a track.
2. **World dynamics** — section targets, lifecycle, relationships, camera, and
   semantic motion grammar.
3. **Spatial scene state** — entities, regions, masks, depth, pose, tracks,
   correspondences, and confidence.
4. **Realization state** — model-owned latents, cached conditioning, material,
   and sparse video/keyframe revisions.
5. **Presentation state** — WebGL textures, interpolation, local fields, and
   fallback state.

Only layers 1–3 are authoritative application state. Realization and
presentation are replaceable projections.

## Recommended technology resolution

| Need | Decision | Reason |
| --- | --- | --- |
| Semantic world contracts | Build in TypeScript | Already matches the runtime and remains inspectable. |
| Fast display | Keep WebGL2 | Existing 60 FPS path and fallback are valuable. |
| Entity masks/tracking | Sidecar using SAM 2 / point tracking | Gives temporal regions without putting heavy inference in Chromium. |
| Human representation | Start with 2D pose + masks; evaluate SMPL-X later | Proves local motion before adding a full 3D human stack. |
| Image realization | Persistent img2img plus ControlNet/IP-Adapter-style controls | Reuses current sidecar while adding spatial authority. |
| Video realization | AnimateDiff or another temporal model behind the same adapter | Adds learned motion only when the structured path demonstrates need. |
| Semantic adapter | Prompt/embedding compiler first; trained adapter later | Supported, measurable progression. |
| State transport | Versioned localhost world-session API | Enforces continuity and stale-update rejection. |

## What this research rules out

- A new image for every section with crossfading as the main continuity plan.
- Global UV swirl as character or environment motion.
- A per-frame LLM, diffusion model, or video model.
- Arbitrary `WorldState -> tensor reshape` conditioning.
- Making a video checkpoint the source of truth for identity.
- Replacing the current runtime before proving local entity motion.

## Evidence gates

The architecture should advance only when it proves, in order:

1. Track identity is non-null and stable.
2. One entity or motif persists across section updates.
3. An intervention changes the predicted entity or region locally.
4. Beat events affect selected regions without destroying identity.
5. A learned temporal backend improves continuity enough to justify its cost.

