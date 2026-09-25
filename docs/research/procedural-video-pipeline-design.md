# Procedural video pipeline design

Status: proposed implementation direction, grounded in the current Electron + TypeScript renderer and Python SD-Turbo sidecar.

## Decision

The product should evolve into a **procedural video engine with an asynchronous learned appearance layer**.

It should not become a sequence of prompt-authored still images, and it should not jump directly to an opaque text-to-video model. The procedural world is the continuously running video substrate; SD-Turbo preserves and enriches appearance when useful.

The core rule is:

> Music acts on a persistent visual world. It does not recreate the world at every musical event.

## What the repository actually does today

The current path is:

```text
audio / FeatureBus
  -> ControlMapper + System 0 rhythm state
  -> ProceduralScene (display clock, nominally 60 Hz)
  -> Renderer compositor
       -> procedural frame immediately
       -> painted sidecar frame when fresh

director / CheckpointScheduler
  -> WorldState + Shot + SceneDiff
  -> realization request
  -> Python SD-Turbo sidecar

ProceduralCapture (separate WebGL2 context)
  -> OffscreenCanvas.convertToBlob(JPEG)
  -> sidecar source input
```

This is already a useful two-timescale design. The observed failure mode is that the sidecar's raster source bridge still competes for the same GPU as the display and diffusion path. Recent telemetry showed generation around 57–90 ms, but occasional source-capture stalls over 1 second. The application then spends effort protecting itself from the bridge rather than producing richer video.

The current sidecar is therefore best treated as a stateful appearance backend, not as the owner of frame-to-frame world motion.

## Target pipeline and clocks

```text
                         SONG
                          |
                audio features / structure
                          v
                    CONTROL STATE
                  60–100 Hz, numeric
                          |
                          v
                    WORLD SIMULATION
                  ~60 Hz procedural video
          camera · fields · particles · light · weather
                          |
                 +--------+--------+
                 |                 |
                 v                 v
          DISPLAY COMPOSITOR   APPEARANCE STATE
             60 Hz             persistent latent/raster
                                   |
                          10–15 Hz or event-driven
                                   v
                         SD-Turbo / future backend
                                   |
                              observation
                                   |
                          feedback, 1–5 Hz
```

### Ownership

| Layer | Owns | Must not own |
|---|---|---|
| Meaning | evidence, language, semantic confidence | authoritative pixels or identity claims |
| WorldState | what persists, intent, relations, provenance | backend-specific prompt text |
| Shot / SceneDiff | viewpoint and justified change | continuous beat response |
| Procedural simulation | motion, camera, spatial flow, cheap lighting and audio response | literal semantic truth |
| Appearance backend | texture, learned visual prior, persistent latent/raster state | timing authority or unsupported story |
| Compositor | 60 Hz presentation and freshness weighting | semantic decisions |
| Feedback | bounded correction from telemetry | blocking the frame loop |

## Why this is preferable to a direct video-model switch

Video diffusion can improve temporal appearance, but a clip generator does not automatically provide interactive audio coupling, world-state control, or low-latency retargeting. A direct switch would risk replacing the current controllable system with independent clips.

The safer progression is backend-neutral:

1. Keep the current procedural renderer as the always-available video substrate.
2. Keep the current SD-Turbo loop as the first appearance backend.
3. Move from source JPEGs as an implicit dependency to explicit `AppearanceObservation` requests.
4. Add latent reuse when the backend exposes it; otherwise use low-frequency raster observations.
5. Evaluate a video backend only behind the same interface.

This preserves the working path while making the expensive part replaceable.

## Source capture policy

`ProceduralCapture` is not a second authoritative renderer. It is an observation bridge for the current raster backend. It should be used for:

- initial appearance establishment;
- an intentional checkpoint/retarget;
- low-frequency refresh when the sidecar is idle and healthy.

It should not be required for every simulation step, and it must never compete with denoising or splicing. The new `src/realization/appearance.ts` contract names that boundary explicitly. The existing capture circuit breaker remains correct: repeated severe stalls disable the bridge for the track while the procedural world continues.

## Continuous forces

Audio maps to bounded numeric forces, not new semantic content:

```text
bass / onset       -> impulse, deformation, exposure
energy             -> motion magnitude and contrast
flux / centroid    -> detail and material response
beat phase         -> breathing or cadence only when confidence is high
stereo balance     -> lateral flow bias
novelty            -> slow morphology pressure, never an immediate cut
```

The current `ContinuousForces` and `structured-world-v2` realization request are the correct seam. The next improvement is to let the procedural simulation consume richer typed force channels while the appearance backend consumes the same forces without inventing entities.

## Research basis

- WebCodecs provides browser-native low-level encoding primitives, but it is an optimization experiment for the capture bridge, not a reason to rewrite the renderer. [W3C WebCodecs](https://www.w3.org/TR/webcodecs/) and [MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- OffscreenCanvas export is asynchronous, yet asynchronous export can still contend for a shared GPU; the repository's measured capture spikes are the reason to keep this path optional. [MDN `convertToBlob`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob)
- TensorRT remains an opt-in inference optimization rather than an architectural dependency. [ONNX Runtime TensorRT Execution Provider](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html)
- Temporal consistency research supports maintaining state/conditioning across frames, but does not imply that a text-to-video clip model should own an interactive world. See [Tune-A-Video](https://arxiv.org/abs/2212.11565), [TokenFlow](https://arxiv.org/abs/2307.10373), and [latent consistency models](https://arxiv.org/abs/2310.04378) as relevant research directions, not current implementation requirements.

## Implementation order

1. Keep the procedural path authoritative for display and motion.
2. Make appearance state and source observations explicit (implemented seam).
3. Benchmark current raster observation cadence versus event-driven/disabled observation.
4. Add sidecar support for persistent latent state or a clearly isolated previous-frame fallback.
5. Add richer procedural world modules: camera, fields, particles, atmosphere, and typed material response.
6. Only then evaluate WebCodecs, native capture, latent-video, or a spatial backend.

The success criterion is not “more diffusion.” It is a continuous visual organism whose motion remains musical when the learned appearance layer is delayed, unavailable, or intentionally quiet.

## Experimental comparison

The development harness exposes `?appearance=persistent`. In this mode the
browser stops sending ordinary procedural JPEG observations; the sidecar uses
its existing keyframe, latent/raster feedback, camera, and flow fallback. The
default remains `?appearance=raster`, so the experiment cannot silently change
the product path. Both modes must be compared with the same track, paint
value, model, resolution, and duration before changing the default.
