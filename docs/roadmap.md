# Roadmap

## Phase 0 — prompt-free-physics prototype ✅ (2026-09-23)

The fast loop is steered only by audio physics, the slow loop is seeded by
the director, and checkpoints are spliced on downbeats. It is measured on the
target GPU and covered by unit tests plus a live metamorphic smoke test.

## Phase 1 — feel pass (next)

- Run real music for a few sessions and read `logs/`. Check whether
  `change` / `drift` track the music, and whether reseeds land musically.
- Tune the mapper curves in `src/stream/control.ts`. Each curve is one line,
  and `npm test` guards the monotonic relations.
- ✅ Measured 448×256 on AC: 68.2 ms median / 14.7 FPS versus 88.2 ms /
  11.3 FPS at 576×320, with nearly unchanged VRAM. It is now the default;
  576×320 remains the explicit quality profile.
- Optional: per-scene negative/style anchors if the look still drifts
  toward illustration.

## Phase 2 — speed

- TensorRT for the UNet (StreamDiffusion's path), estimated at 2–3× over
  CUDA graphs. Needs a separate venv.
- Stream-batch denoising (StreamDiffusion's pipelined multi-step) for
  quality at the same fps.

## Phase 3 — the research piece: FiLM audio adapter

A tiny MLP maps about 8 audio features to per-block scale/shift
modulations in the UNet, trained LoRA-scale on the distilled model. The
objective is contrastive audio–image alignment (CLAP-style) as a proxy
reward. This lets the model "feel" the music in its weights, not only in its
noise. It is unbuilt anywhere, as far as we know.

## Phase 4 — wildcard

Masked-token canvas (MAR/HMAR-class): a persistent token lattice where audio
chooses which tokens are unmasked each tick. It needs real training. Higher
risk, higher ceiling.

## Non-goals

- Per-frame semantics or prompts driven by audio.
- A second resident model on the 6 GB card.
