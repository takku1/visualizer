# Architecture decisions

## ADR-001: WorldState is the semantic waist

Accepted. Perception and System One produce typed probabilistic world state;
realizers project it into pixels or latents.

## ADR-002: The world is structured and persistent

Accepted. Identity, entities, regions, lifecycle, and memory persist across
sections. Images and clips are realizations, not authoritative state.

## ADR-003: Separate timescales

Accepted. Track, section, event, realization, and frame loops have distinct
contracts. Heavy inference is sparse and asynchronous.

## ADR-004: Events are semantic impulses

Accepted. A beat may affect selected entities or regions. It is not inherently
a ring, burst, rotation, or global displacement.

## ADR-005: Model-specific conditioning only

Accepted. Use supported prompt embeddings, reference-image adapters, depth,
segmentation, pose, ControlNet, IP-Adapter, motion modules, or trained
adapters. Never reshape unrelated vectors into checkpoint tensors.

## ADR-006: WebGL2 remains the presentation loop

Accepted. WebGL2 interpolates, composites, and provides bounded local motion
at 60 FPS. It does not replace the generative world model.

## ADR-007: Raster substrate is compatibility infrastructure

Accepted. Tiny-SD and image-to-image are useful experiments and fallbacks, but
crossfaded independent images are not the target continuity architecture.

## ADR-008: Video is a gated backend

Accepted. A temporal model is introduced only after structured state and local
motion have demonstrated a limitation that video inference can address.

## ADR-009: Visual self-perception is deferred

Accepted. Closed-loop visual feedback waits until one-way world dynamics are
stable and measurable.

