# UNet optimization plan

Status: plan and export seam; production backend unchanged.

## Evidence first

The current 448x256 SD-Turbo benchmark on the RTX A3000 Laptop is:

| Metric | Current CUDA-graph/eager path |
| --- | ---: |
| Median frame generation | 49.25 ms |
| P90 / P95 | 49.78 / 50.58 ms |
| Stream rate | 20.3 FPS |
| UNet stage | 35.30 ms |
| VAE encode / decode | 5.69 / 6.21 ms |
| Peak allocated VRAM | 2,434 MB |

The UNet is approximately 72% of the measured model stage. Therefore the
optimization order is:

1. Preserve and re-measure the current CUDA-graph path.
2. Export only the fixed-shape FP16 UNet used by the live loop.
3. Validate ONNX numerics against PyTorch on representative latent, timestep,
   embedding, and Bender-control inputs.
4. Build a TensorRT engine with one fixed optimization profile at 448x256.
5. Benchmark engine-only and end-to-end latency with CUDA events and the same
   warmup/sample count.
6. Integrate behind `STREAM_UNET_BACKEND=pytorch|tensorrt` only if the engine
   improves P95 and does not materially increase VRAM, discontinuity, jitter,
   or failure rate.

The current backend remains the default throughout this work.

## Why fixed shape first

The realtime profile intentionally uses a fixed latent shape `(1, 4, 32, 56)`
and text conditioning `(1, 77, 1024)`. Dynamic shapes add build/profile
complexity without helping this loop. If a future resolution profile is
needed, it gets its own engine and benchmark rather than silently triggering
runtime shape changes.

## Export contract

The exported UNet must accept:

```text
sample:                 float16 [1, 4, 32, 56]
timestep:               int64   [1]
encoder_hidden_states:  float16 [1, 77, 1024]
```

and return the epsilon prediction with shape `[1, 4, 32, 56]`. The live
`Bender` activation edits are not automatically representable in ONNX. The
first engine candidate must therefore be benchmarked in two modes:

- neutral controls, to measure pure UNet acceleration;
- the closest supported control path, to determine whether removing Bender
  changes the visual/music behavior enough to disqualify the backend.

If preserving Bender requires custom TensorRT plugins or an alternate control
injection point, that is a separate experiment. It must not silently remove
semantic/audio control from production.

## Acceptance gates

An engine candidate is eligible for integration only when all gates pass:

- ONNX parser/build succeeds on the target machine.
- FP16 output error is measured against PyTorch on fixed seeded inputs.
- 500+ frame deterministic replay completes without allocation growth.
- Median and P95 UNet and end-to-end latency beat the current baseline.
- Peak VRAM remains within the 6 GB device budget.
- Text encoder calls remain zero during stable playback.
- Adjacent-frame change and second-difference jitter do not show a new spike.
- Stable passages preserve the current visual state for at least 30 seconds.
- A structured retarget still transitions gradually and abstention does not reset
  the state.
- Engine failure falls back to the existing PyTorch backend without resetting
  the visual state.

“Faster” alone is not sufficient: this project optimizes a persistent musical
visual state, not an isolated image score.

## Research basis

StreamDiffusion motivates pipeline-level streaming and sequential state rather
than independent text-to-image clips. SDEdit motivates bounded noise/denoise
changes around an existing image state. Training-free temporal work such as
Upscale-A-Video supports treating propagation and temporal stability as explicit
measurements rather than assuming that a faster generator is coherent.

The deployment procedure follows NVIDIA’s measure-then-optimize guidance:
benchmark a stable baseline, use fixed shape profiles, validate precision, and
report engine and end-to-end measurements separately.

- [StreamDiffusion](https://arxiv.org/abs/2312.12491)
- [SDEdit](https://openreview.net/pdf?id=aBsCjcPu_tE)
- [Upscale-A-Video](https://openaccess.thecvf.com/content/CVPR2024/papers/Zhou_Upscale-A-Video_Temporal-Consistent_Diffusion_Model_for_Real-World_Video_Super-Resolution_CVPR_2024_paper.pdf)
- [NVIDIA TensorRT benchmarking](https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/benchmarking.html)
- [NVIDIA TensorRT precision control](https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/precision-control.html)
- [PyTorch ONNX exporter](https://docs.pytorch.org/tutorials/beginner/onnx/export_simple_model_to_onnx_tutorial.html)

## Deferred until the first candidate is measured

- INT8 or lower precision: likely quality/temporal risk on this small model.
- Dynamic-resolution engines.
- Custom plugins for Bender.
- Replacing the whole pipeline with Torch-TensorRT.
- Removing the procedural source encode. That is a separate continuity/design
  experiment, not a UNet optimization.
