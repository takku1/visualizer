# Framework fit from telemetry

Updated 2026-09-25. This compares framework directions against the repository's
measured behavior, not generic popularity.

## Evidence driving the decision

- Continuous-song realization passed in every recent session.
- The current 448×256 PyTorch engine is about 14.9 FPS with a roughly 47 ms
  UNet stage and about 2.4 GB peak VRAM.
- Bender on/off was effectively equal in the clean A/B benchmark, so removing
  structured conditioning is not a useful optimization.
- The serious end-to-end failure is elsewhere: procedural capture/JPEG encode
  produced repeated 1–1.4 second stalls on the shared GPU, even after cooldown.
- Semantic acquisition and grounding are asynchronous and evidence-gated; they
  are not the frame-rate bottleneck.

## Recommendation

Keep the current three-plane split:

```text
Electron/TypeScript
  world state, audio controls, director, UI, WebGL/WebGPU presentation
        |
        | bounded websocket protocol
        v
Python/CUDA backend
  SD-Turbo, structured conditioning, persistent realization
```

Change framework only at a measured boundary:

1. **Capture/encoding experiment first:** keep the procedural scene but replace
   `OffscreenCanvas.convertToBlob()` behind a `SourceEncoder` interface. Test
   WebCodecs and, if necessary, a native/CUDA or worker encoder. WebCodecs is a
   W3C API intended for low-level, potentially hardware-accelerated media
   encoding and is available in dedicated workers ([W3C WebCodecs]
   (https://www.w3.org/TR/webcodecs/), [MDN WebCodecs]
   (https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)).
2. **Procedural GPU evolution later:** WebGPU is a reasonable future backend
   for compute-heavy fields, simulation, and post-processing, but it will not
   by itself remove JPEG readback/encode contention. Keep WebGL as the stable
   fallback until a WebGPU prototype is benchmarked.
3. **Diffusion acceleration as a backend:** keep PyTorch+Bender as the
   correctness backend. Revisit TensorRT or ONNX Runtime TensorRT only as a
   fixed-shape production backend after structured-conditioning parity is
   demonstrated. ONNX Runtime supports TensorRT with CUDA fallback for nodes
   TensorRT cannot execute ([ONNX Runtime TensorRT provider]
   (https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html)).
   TensorRT CUDA Graphs can reduce host launch overhead, but graph capture has
   shape/control-flow constraints and must be measured at the exact 448×256
   profile ([TensorRT performance optimization]
   (https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html)).
4. **Video diffusion later:** use a stateful video/latent backend behind the
   existing realization interface. Do not replace the app with ComfyUI,
   independent text-to-video clips, or a prompt workflow; those would weaken
   the current world-state and audio-control contracts.

## Options rejected for now

| Option | Why it does not solve the measured problem now |
| --- | --- |
| Rewrite the renderer in WebGPU | May improve procedural compute, but does not address the observed JPEG/capture stalls or object permanence. |
| Replace Python with ONNX Runtime wholesale | Risks losing Bender/custom structured conditioning; the current bottleneck is not proven to be framework launch overhead. |
| Move to ComfyUI | Adds orchestration latency and makes the continuous control plane less explicit. |
| Switch to a video model immediately | Could improve temporal priors but would sacrifice current low-latency, beat-reactive control until a stateful backend is measured. |
| Native Rust/WGPU rewrite | Potentially valuable long-term, but no evidence justifies its migration cost before isolating the encoder boundary. |

## Next framework experiment

Implement `SourceEncoder` with two adapters:

- `CanvasBlobSourceEncoder` — current behavior;
- `WebCodecsSourceEncoder` — opt-in, worker-capable candidate.

Benchmark each with the same canvas, JPEG/codec settings where comparable,
duration, GPU, and sidecar state. Record capture draw, encode, total capture,
capture stalls, dropped frames, sidecar FPS, and display FPS. Promote the new
adapter only if it lowers p95 capture latency without increasing visual age or
breaking the persistent stream.

This is a narrow framework substitution at the proven fault boundary, not a
platform rewrite.
