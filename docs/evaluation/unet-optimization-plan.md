# UNet optimization plan

Status: opt-in backend seam implemented; PyTorch remains the default production backend.

Phase 1 result: the fixed-shape candidate built and benchmarked successfully
on the RTX A3000. TensorRT measured 18.37 ms median and 19.13 ms P95 for the
UNet alone, versus approximately 35.30 ms for the current PyTorch UNet stage.
A deterministic neutral-input comparison measured mean absolute output error
0.00719 with output RMS approximately 0.918. This is a promising candidate,
but it is not production-integrated because the exported graph does not include
the live Bender activation edits.

The runtime now exposes an explicit `STREAM_UNET_BACKEND=tensorrt` experiment
for the fixed `448×256` profile. It is accepted only with
`STREAM_BENDER=0`; otherwise the server fails closed to PyTorch so semantic
and audio conditioning cannot disappear silently. Batched keyframe calls
still use PyTorch because the current engine is batch-one. This is an
opt-in benchmark backend, not a claim that the default visual contract has
been replaced.

Controlled application benchmark on the A3000 at 448×256, 150 frames, with
the same four-step keyframe fixture:

| Backend | Median | P95 | Engine FPS | UNet median | Peak VRAM |
| --- | ---: | ---: | ---: | ---: | ---: |
| PyTorch + Bender | 49.3 ms | 50.4 ms | 20.3 | 35.5 ms | 2434 MB |
| TensorRT, Bender off | 33.0 ms | 34.7 ms | 30.3 | 18.6 ms | 2435 MB |

The TensorRT run used a dedicated non-default CUDA stream and emitted no
runtime synchronization warning. This is an engine benchmark, not yet a
claim of equal visual behavior: Bender is intentionally disabled in the
TensorRT row and batched live/keyframe calls still use PyTorch.

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

Artifacts and commands used for the result:

```powershell
& <sidecar-python> tools/export-unet-onnx.py
& '.\.venv-tensorrt\Scripts\python.exe' tools/build-tensorrt-engine.py
& '.\.venv-tensorrt\Scripts\python.exe' tools/benchmark-tensorrt-engine.py
& <sidecar-python> tools/make-unet-reference.py
& '.\.venv-tensorrt\Scripts\python.exe' tools/validate-tensorrt-unet.py
```

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

The current result is therefore an engine-only win, not yet an application
speedup. The next implementation decision is whether the controls can be
compiled into ordinary tensor inputs without changing the visual contract. If
not, the engine remains a measured research backend and PyTorch remains the
runtime backend.

## Continuity diagnostic

Rendered frame sequences can be evaluated with:

```powershell
python tools/evaluate-stream-sequence.py output/stream-bench
```

The tool reports normalized adjacent-frame pixel change and second difference
at a small grayscale resolution. Adjacent change measures motion magnitude;
second difference is a useful discontinuity/boiling proxy. It deliberately
reports `identityVerified: false` and `actionVerified: false`: these metrics
cannot prove object identity or distinguish camera motion from subject motion.
Use the same frame cadence, fixture, and directory sampling when comparing
backends.

The first full 120-frame baseline used a 16-frame splice. Its adjacent-change
maximum was `0.10198` at the retarget boundary, with P95 `0.06529`; second-
difference P95 was `0.09596`. A 32-frame splice plus `STREAM_KEYFRAME_LIVE_MIX`
at its default `0.5` reduced those values to adjacent maximum `0.08057`,
adjacent P95 `0.05719`, and second-difference P95 `0.07935`. The easing applies
only while a keyframe is being denoised; ordinary audio-reactive frames keep
their existing path.

## Bender diagnostic

The production CUDA-graph benchmark was repeated with the Bender hooks enabled
and disabled using the same 448x256 profile:

| Mode | UNet median | End-to-end median |
| --- | ---: | ---: |
| Bender on | 35.4 ms | 49.6 ms |
| Bender off | 35.0 ms | 49.0 ms |

The difference is within run-to-run noise. Bender is already captured inside
the CUDA graph, so it is not the measured bottleneck. This makes a custom
TensorRT Bender plugin a poor first optimization: it adds feature risk without
addressing the dominant cost. Preserve Bender in the PyTorch backend while the
accelerated backend is treated as a separate research candidate.

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
