# Continuous latent realization with the current SD-Turbo backend

Status: implementation guidance, 2026-09-24

## Repository findings

The current implementation is already closer to a stateful stream than to
independent text-to-image generation:

- `tools/stream-server.py` keeps a persistent latent in `StreamEngine.z` and
  feeds each generated step from the latest procedural source or a warped
  keyframe. It does not sample a fresh scene from text on every frame.
- `src/render/procedural.ts` supplies the 60 Hz structural/motion substrate;
  `src/stream/control.ts` maps audio features into bounded sampler controls.
- `src/stream/checkpoint.ts` and `src/world/state.ts` own slower world changes,
  scene diffs, continuity, and checkpoint timing. The prompt is compiled from
  those structures at the sidecar boundary.
- Text embeddings are cached by prompt in the sidecar. Ordinary frames use
  the cached embedding; text encoding is not in the browser frame loop.
- The remaining discontinuity risk was the retarget policy: a changed scene
  could become eligible at the next safe beat without an explicit sustained
  candidate/cooldown state.

## Research implications

StreamDiffusion presents streaming as a pipeline-level optimization for
interactive generation and explicitly targets sequential, unbounded streams,
which supports retaining the existing one-step loop rather than replacing it
with independent clips. See the primary paper:

- [StreamDiffusion, arXiv:2312.12491](https://arxiv.org/abs/2312.12491)

SDEdit establishes the useful image-to-image principle that the noise level
controls the trade-off between preserving the input and allowing the diffusion
prior to regenerate detail. That supports using audio to modulate bounded
noise/denoise strength while keeping the current state as the source, rather
than using beats as scene resets.

- [SDEdit, ICLR 2022](https://openreview.net/pdf?id=aBsCjcPu_tE)

Training-free temporal-consistency work such as Upscale-A-Video uses recurrent
latent propagation and flow-guided propagation to preserve local and global
temporal structure. The current SD-Turbo backend does not have those trained
temporal layers, so its honest analogue is persistent latent state plus the
existing procedural source and bounded feedback; this is a continuity aid, not
proof of object permanence.

- [Upscale-A-Video, CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Zhou_Upscale-A-Video_Temporal-Consistent_Diffusion_Model_for_Real-World_Video_Super-Resolution_CVPR_2024_paper.pdf)

## Implemented response

The scheduler now exposes `continuousLatentMode` (default `true`) and applies
the smallest safe retarget state machine already compatible with the existing
checkpoint protocol:

```text
STABLE -> CANDIDATE (scene fingerprint changes)
        -> TRANSITION (after 0.9 s sustained hold and safe beat)
        -> COOLDOWN (8 s)
        -> STABLE
```

The sidecar still performs the actual two-bar paint-in transition. The policy
does not change the latent every beat, does not reseed ordinary playback, and
does not block explicit hard cuts. `?continuous=off` preserves the prior
scheduler behavior for comparison.

## Deliberate limits

This change does not claim a true latent-flow warp, object correspondence,
reference conditioning, or learned temporal memory. Those require either a
backend that exposes spatial/temporal conditioning or a measured training
project. The current implementation keeps the correct seam for those backends
without adding a second resident model to the 6 GB target GPU.

## Benchmark protocol

Compare old and continuous modes using the same track, resolution, model,
paint, and duration:

```powershell
npm run stream:bench -- --bench-json output/stream-bench/current.json
npm run smoke
npm run evaluate:logs -- logs/<session>.jsonl --json
```

Record median/p95 generation time, stream/display FPS, dropped frames, capture
spikes, checkpoint count, stale-frame drops, and adjacent-frame continuity.
The stage benchmark now reports encode, UNet, and decode medians; no speedup is
claimed until those measurements are compared on the same process and device.

## Optimization decision

The corrected benchmark measured 49.25 ms median, 49.78 ms P90, and 50.58 ms
P95. The UNet accounts for roughly 72% of the measured encode/UNet/decode
stage time, so VAE micro-optimizations are not the next high-value target.

The opt-in `STREAM_COMPILE=1` experiment was attempted, but this Windows
environment has no working Triton installation (`torch 2.13.0+cu126`, CUDA
12.6). TorchInductor therefore failed before the first frame. The runtime now
detects that condition and falls back to the proven CUDA-graph/eager path
instead of crashing. This follows NVIDIA's guidance to establish a stable
baseline before changing batching or graph execution, and to treat CUDA graph
capture as constrained by operator and shape compatibility:

- [NVIDIA TensorRT performance optimization guidance](https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html)
- [NVIDIA TensorRT benchmarking guidance](https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/benchmarking.html)

TensorRT 11.3.0.99 is now installed in the isolated `.venv-tensorrt` probe
environment and its modern builder API successfully produced a 2.5 KB identity
engine. This proves that the local Python/runtime installation can build an
engine; it does **not** prove that the diffusion UNet can be exported or that a
TensorRT engine will outperform the current CUDA-graph path. The reproducible
probe is:

```powershell
& '.\.venv-tensorrt\Scripts\python.exe' tools/tensorrt-probe.py
```

The next legitimate UNet optimization project still requires an ONNX/TensorRT
export, shape profile, precision validation, and a side-by-side temporal
benchmark. It must report the same P95, VRAM, temporal-change metrics, and
checkpoint behavior; a faster UNet that destabilizes the persistent latent is
not an acceptable optimization.
