# Architecture decisions

Superseded decisions (the WorldState / world-compiler / LTX temporal-realizer
architecture, ADR-001..011 of the previous design) are preserved in git at
`refs/backup/pre-stream-redesign`.

## ADR-001: Two timescales, one GPU process

Accepted, 2026-09-23. The fast loop runs at the frame rate and carries no
semantics. The slow loop re-seeds content at bar/section cadence. Re-seeding
is the known remedy for temporal drift, so it is part of the design. The
previous architecture's LTX realizer delivered 0 successful frames in the
last logged sessions on this GPU.

## ADR-002: Audio perturbs sampling physics, never content

Accepted. Low-level features map to strength, noise, detail, flow, camera,
and feedback (`src/stream/control.ts`). Semantics enter only through the
director's scene prompt, and only at checkpoint time.

## ADR-003: SD-Turbo + TAESD for both loops on a 6 GB A3000

Accepted, with measurements (on battery except where noted):

| Candidate | Verdict |
| --- | --- |
| **SD-Turbo fp16 + TAESD** | **Chosen.** 2.5 GB peak VRAM. 1-step img2img at intermediate timesteps holds the scene. ~61 ms/frame on AC with CUDA graphs. |
| SDXS-512-0.9 | Rejected. ~⅓ the UNet cost and openrail++ licensed, but it is trained for one step from pure noise. Img2img at t≈300 blurs to mush within ~100 frames. |
| SDXL-Turbo / FLUX / LTX-2 as keyframe model | Rejected. A second model does not fit next to the fast loop in 6 GB, and none fits alone at interactive speed. |
| LTX-Video (previous design) | Removed (27 GB on disk). Minutes per clip on this card; never delivered in practice. |
| tiny-sd | Removed. Not a few-step model. |

The keyframe uses the same UNet at 4 steps, time-sliced into the fast loop
as a batch-2 call.

## ADR-004: The fast loop needs a fresh external frame every step

Accepted, measured. With self-feedback ≥ 0.5, the loop abandons the prompt
for a posterized "circuit board" attractor within ~90 frames. With an
external frame as input and feedback ≤ 0.25, the scene holds for the full
run while still flowing. Feedback is clamped to 0.35 in the sidecar.

*Amended 2026-09-24:* the external frame was first the keyframe, moved by a
camera and flow field. It is now the procedural scene whenever the browser
is sending one (ADR-011). The keyframe camera remains the fallback when no
procedural frame has arrived for 1 s.

## ADR-005: Motion from a flow field, scene changes painted in

Accepted. Content moves along a smooth, audio-driven displacement field,
which reads as animation rather than re-generation. New keyframes are
revealed region by region, following a smooth random order, instead of a
global crossfade.

## ADR-006: Reproject through TAESD every frame

Accepted. Recursing on x0 latents without a VAE round trip drifts off the
manifold (grid artifacts). The encode costs ~12 ms on AC.

## ADR-007: CUDA graphs, not torch.compile

Accepted. Triton is unavailable in the Windows torch wheel. Graph capture of
the fixed-shape UNet/VAE calls gave 3.2× end to end on this machine, with
bit-identical output. `cudnn.benchmark` is off: it re-autotunes on every new
batch shape, which stalled the loop for 12 s.

*Amended 2026-09-24:* the network-bending hooks (ADR-012) and h-space
directions run *inside* the captured graphs. That holds only because every
value they read lives in static GPU tensors (`Bender.params`, `Bender.mask`,
`Bender.directions`) that are updated with `copy_` before each replay. A
hook that reads a Python float, allocates a new tensor, or branches on a
value would be frozen at its capture-time value, with no error. With all
bends at zero the output is still bit-identical to no hooks, since every
operator is an exact identity at zero.

## ADR-008: The browser decides when; the sidecar only renders

Accepted. Timing, beat quantization, and scene choice live in testable
TypeScript (`npm test`). The sidecar is a latest-wins renderer with no
musical policy of its own.

*Amended 2026-09-24:* the sidecar now holds two mechanical rules. It keeps
one owner at a time (ADR-013), and it starts a keyframe from the procedural
frame at continuity ≥ 0.5 when one is arriving (ADR-011). Neither makes a
musical decision.

## ADR-009: The director stays, as System 2's judgment

Accepted. The System One director (local / Jev / Laya) already runs at
decision cadence with calibrated distributions. It now feeds the keyframe
prompt instead of shader uniforms. The learned-perception and lyrics sidecars
were removed with the old architecture.

*Amended 2026-09-24:* each decision also sets the procedural **look**:
palette ramp, organic vs. architectural, warp depth, symmetry fold and field
seed (`lookFromPlan`). It applies when the scene's checkpoint lands, so
structure and painting change together. In knob mode (`?direction=knobs`)
the director's output is `KnobTargets` instead. Its distributions become
blend weights over 2–3 anchor scenes, and discrete structure changes only
at hard cuts (see `docs/live-knob-direction.md`). The local engine's median
decision latency is 1 ms, so the 3–5 s knob cadence costs nothing.

## ADR-010: Smoothness from near-frozen noise, not low strength

Accepted, measured 2026-09-24. Jitter is the latent second difference, now in
the sidecar meta and logs. Settings from the first live session (strength
0.4, 25% fresh noise, noise walk 1.8 rad/s) scored 0.61–0.66. Lowering strength
roughly halved jitter but lost detail and turned the flow gooey. Near-frozen
noise (walk 0.05 rad/s, no fresh noise) scored 0.27 across two seeds, even at
strength 0.5. The model makes the same decisions every frame, as in
StreamDiffusion. So strength stays at 0.3–0.6 and re-details the picture,
noise turns over slowly with flux, and fresh noise is added only on
transients. Beat pushes also ignore an untrusted synthesized grid: without
Spotify analysis it wandered 103–149 BPM in the first session.

## ADR-011: Procedural drives, AI paints

Accepted, 2026-09-24. A 60 Hz shader scene in the browser supplies
structure and motion at exact beat sync: infinite forward travel through a
domain-warped field, flow, swirl, treble sparkles, and harmony-driven hue.
It is shown directly, and sent at 576×320 as the diffusion loop's camera
input, one JPEG in flight. `paint` (0–1) mixes the procedural and painted
layers on screen and pulls the sidecar's strength toward 0.2 as it drops.

Measured on a moving synthetic source: output/input luminance correlation
0.96 / 0.91 / 0.52 at strength 0.3 / 0.45 / 0.6. Jitter was 0.12–0.13,
half the keyframe-camera mode's 0.27, because motion now comes from a smooth
external source. Above ~0.55 SD-Turbo starts drawing text-like marks.
Capture costs ~25 ms per frame in the browser (live log, 2026-09-24).

Why: the user wanted procedural visuals back. Procedural and diffusion are
good at opposite things (motion, sync and identity vs. richness and
meaning), and this split gives each layer the job it is good at. The beat
ring bursts were removed at the user's request on 2026-09-24.

## ADR-012: Network bending: audio inside the UNet

Accepted, 2026-09-24. After Dzwonczyk et al. (arXiv:2406.19589; JAES
2025), audio-driven transforms act on the UNet's own activations. The layer
depth is matched to the musical dimension: early layers change what is
depicted, late layers restyle it coherently.

| Music | Operator | Layer | Cap |
| --- | --- | --- | --- |
| harmony (circle-of-fifths distance from a 20 s home key) | pairwise channel rotation | `mid_block` | ±π |
| bass push, 60 ms eased attack | max-pool dilation | `conv_in` | 0.4 |
| treble onsets, 200 ms fade | soft threshold | `up_blocks.2` | 0.9 |
| drops (4 s warm-up, 8 s cooldown) | inversion blend | `conv_in` | 0.2 |

The caps come from an operator sweep on the A3000: swell 0.7 and lurch 0.35
shatter the frame into mosaic. Live modulation costs +22% jitter, which is
why every bend has an eased envelope. Bends are gated per batch sample, so
keyframe steps are never bent. The hooks are captured inside the CUDA
graphs (ADR-007), so they cost no extra kernel launches.

## ADR-013: One owner per sidecar; later clients wait

Accepted, 2026-09-24. The sidecar has a single engine, and two clients
would interleave controls and checkpoints on one picture. The first rule
tried was "the newest client wins, and the replaced one stops
reconnecting". In practice a passing test tab took over a live session and
left it permanently without a stream.

The current rule: the first client keeps ownership. Later connections are
closed with 1013 `busy` and retry every 3 s, so they take over once the
owner disconnects. A hung owner is closed by the websocket keepalive.

## ADR-014: Procedural input grounds; checkpoints renew content

Accepted, 2026-09-24, from the controlled five-minute experiment. The
keyframe-off arm used one initial checkpoint and the same moving procedural
input as the baseline. Its CLIP active-prompt margin slope was -0.0017/min
with a 1.000 on-prompt share, versus -0.0378/min and 0.743 for the periodic
keyframe baseline. Active-score standard deviation was 0.0353 off versus 0.0578
with keyframes; structural correlation, jitter, and drift were also within or
better than baseline windows.

Therefore the procedural frame is the grounding path when available. The
checkpoint layer remains responsible for semantic content renewal, scene
changes, and fallback grounding when procedural input is absent. This is not a
decision to remove checkpoints or claim that one A-to-B blend pair establishes
a general morph law.

The same run's single prompt-blend ramp did not reach a clean B crossover, and
the h-space sweep failed directional sanity checks. Prompt travel and h-space
remain experimental; neither is evidence for changing the default mode yet.

## ADR-015: Continuous diffusion state is the default music-video mode

Accepted, 2026-09-24. The browser already supplies a fresh procedural frame at
display cadence, and the sidecar paints that input through the current latent
state every fast-loop step. Periodic same-scene keyframes therefore interrupt
continuity without adding semantic information. The default scheduler now
re-anchors only for an initial scene or a changed scene meaning; periodic and
stagnation re-seeds are opt-in through `AppConfig.reseed` for drift experiments.
Hard cuts and evidence-backed scene changes still splice normally.

## ADR-016: Telemetry may nudge physics, never semantics

Accepted, 2026-09-24. The browser now emits compact `_state` samples at 1 Hz
and applies a bounded `CouplingController` to the sampler. High drift gives
the procedural input more authority; high jitter reduces fresh noise; an
energetic low-change stall allows a small strength increase. Gains ease toward
targets and remain inside the existing sampler clamps. The controller cannot
select prompts, motifs, scenes, or checkpoints, preserving the separation
between mechanical System 1 response and semantic System 2 judgment.

The fallback tempo estimator now folds subdivision and double-time onset gaps
into a 60-180 BPM pulse estimate, with confidence and hysteresis. It remains a
fallback when trusted Spotify structure is unavailable, not a replacement for
measured beat/bar analysis.

## ADR-017: Perceptual intent is the default semantic output

Accepted, 2026-09-24, after research on object-centric video representation,
temporal correspondence, controllable diffusion, audiovisual alignment, and
quality-diversity emergence (see
`docs/research/emergent-intent-world-research.md`).

The director must not default to authoring literal music-video storyboards.
Its primary output is a typed `PerceptualIntent`: form, behavior, space,
material, motion, light, color, tension, affect, and continuity pressure.
Evidence-backed literal entities remain optional anchors. The renderer may
discover whether an intent becomes cloth, a body-like form, vegetation, cloud,
or architecture, but the system must preserve and evaluate the resulting
realization rather than treating prompt text as identity.

This is a hybrid rather than an abandonment of semantics. Grounded mode is
retained for strong evidence; emergent mode is the default because it better
matches the product's audiovisual-organism goal. Emergence is constrained by
continuity, audio-timing, bounded change, and measurable novelty/coherence;
otherwise it degenerates into drift and cannot be distinguished from noise.

The current SD-Turbo backend does not yet provide true persistent memory or an
observation model. This ADR changes the ownership and compiler direction, not
that empirical limitation.

