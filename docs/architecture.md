# Architecture: a versioned audiovisual world engine

The current system has three planes rather than one audio-to-image loop:

```text
perception  ->  direction  ->  realization
audio/rhythm    meaning/shot  procedural structure + diffusion paint
```

The clocks are intentionally different: feature physics runs every frame,
semantic direction changes at sections or meaning revisions, and receipts are
evaluated offline. Meaning is optional and may abstain; title concepts are a
metadata fallback, not song understanding.

## Budget

The display runs at 60 Hz in WebGL and renders the procedural scene itself,
so motion and beat sync never wait on the GPU sidecar. The diffusion stream
runs as fast as the sidecar allows. On the target (RTX A3000 Laptop, 6 GB,
Ampere, on AC power) that is ~61 ms per frame, about 16 fps, at 576×320,
measured with `npm run stream:bench`. The browser also renders the procedural
scene a second time at 576×320 and JPEG-encodes it for the sidecar, about once
per stream frame. Healthy sessions measure roughly 20–30 ms for `captureMs`.
If shared-GPU pressure drives one capture above 250 ms, the browser discards
that upload and pauses camera capture for 30 seconds while the sidecar falls
back to its keyframe. This protects the 60 Hz display path from turning into a
slideshow.

## Shape

```
                ┌────────────────────────────── browser (Electron) ───────────────────────────────┐
 system audio ─►│ FeatureBus ─► ControlMapper ─► SamplerControl + bends ──(ws text, 30 Hz)────────┐ │
                │     │               └─► ProceduralScene (60 Hz phases)                         │ │
                │     │                      ├─► capture 576×320 JPEG ──(ws binary, 1 in flight)─┤ │
                │     │                      └─► Renderer: procedural ─mix(paint)─► screen       │ │
                │     │                                                     ▲                    ▼ │
                │     └─► Meaning + Director ─► Scene {shot, fingerprint, prompt, look} ─► CheckpointScheduler ─► stream-server.py
                │                                                           └── painted JPEG + meta ◄──┘
                └──────────────────────────────────────────────────────────────────────────────────┘
```

Three planes, each with its own job:

| Layer | Rate | Owns |
| --- | --- | --- |
| Perception + physics (browser) | 60 Hz / audio windows | rhythm, features, sampler controls, procedural structure |
| Semantic direction (browser) | sections / meaning revisions | evidence, motifs, relations, actions, shot intent |
| Realization (sidecar + renderer) | ~16 fps / 60 Hz display | diffusion paint, procedural composition, checkpoint transitions |

`paint` (0–1, `[` / `]` in the app) sets the balance. At 0 the screen is
the procedural scene alone. At 1 it is fully the painted stream. Paint also
scales the sidecar's strength: `0.2 + (strength − 0.2) · paint`.

## Procedural scene (`src/render/procedural.ts`, `shaders/procedural.glsl`)

The music sets *speeds*, and the scene integrates them into phases, so a
loud passage moves faster without ever jumping.

- **Forward travel:** an infinite zoom through three octave-spaced layers of
  one domain-warped field. Speed is `0.05 + 0.18·energy + 0.9·push` octaves
  per second, so beats surge forward.
- **Flow:** the domain-warp phase advances with energy and flux.
- **Swirl:** a twist that follows the mapper's rotation.
- **Treble sparkles:** flare with the highs.
- **Harmony:** the same `hue` angle that bends the UNet also rotates the
  procedural palette, so the two layers agree.

The **look** (palette ramp, organic vs. architectural, warp depth, symmetry
fold, seed) comes from the director's scene (ADR-009). It
changes only when a `scene`/`initial` checkpoint lands, in sync with the
keyframe paint-in. Continuous parameters crossfade over 2 s; discrete ones
switch at once, covered by the paint-in.

The display pass and the capture pass include the same `procedural.glsl`,
so what is shown and what is painted are the same scene.

## System 1: the fast loop (`tools/stream-server.py`, every frame)

```
view   = procedural frame, if one arrived < 1 s ago          (ADR-011)
         else warp(keyframe, camera, flow)                   (ADR-004 fallback)
input  = lerp(view, prev_frame, feedback)
z      = TAESD.encode(input), with channel stats pulled 5% toward the keyframe's
x_t    = √ᾱ_t · z + √(1-ᾱ_t) · ε              t = strength · 999
ε      = coherent_noise(θ) ⊕ fresh·noise ⊕ highpass·detail
frame  = TAESD.decode( UNet_1step(x_t, t, scene_embedding) )   ← bends inside the UNet (ADR-012)
```

- **An external frame every step.** StreamDiffusion is stable because each
  step gets a fresh frame from outside. A loop fed only its own output
  wanders to an attractor ("circuit board" patterns) within ~90 frames at
  feedback ≥ 0.5. Feedback is capped at 0.35 (the mapper uses 0.05–0.25).
- **The procedural frame is that external frame.** Measured on a moving
  synthetic source: luminance correlation 0.96 / 0.91 / 0.52 at strength
  0.3 / 0.45 / 0.6, and jitter 0.12–0.13, half the keyframe-camera mode's
  0.27. Above ~0.55 SD-Turbo starts hallucinating text-like marks.
- **Keyframe fallback.** With no procedural frame (paint 0, or a client that
  never sends one), the keyframe is moved by a sprung camera and a smooth
  flow field instead.
- **Reprojection every frame** through the tiny VAE (ADR-006).
- **Near-frozen coherent noise:** the model makes the same decisions each
  frame. This is the smoothness mechanism (ADR-010).
- **CUDA graphs** capture UNet ×1, UNet ×2, encode and decode, including the
  bending hooks (ADR-007).

### Audio → sampler physics and bends (`src/stream/control.ts`)

| Music | Parameter | Where it acts |
| --- | --- | --- |
| bass (smoothed), beat/bass-onset push | `strength` | how much of each frame is re-imagined: 0.3–0.6, pulled toward 0.2 as paint drops |
| level, transients | `noise` | fresh-noise share, kept tiny (ADR-010) |
| treble, treble onsets | `detail` | high-frequency noise |
| flux, energy | `noiseWalk` | how fast the coherent noise turns over (slow) |
| harmonicity vs. transientness | `feedback` | trails for sustained sound, re-grounding on hits |
| energy, bass, flux / mid / push | `flow`, `flowSpeed`, `rotate`, `zoom`, `drift` | sidecar camera and flow, keyframe mode only. The procedural scene takes energy, flux, push and `rotate` directly |
| harmony: chroma centre on the circle of fifths vs. a 20 s home key | `hue` | UNet mid-block channel rotation, and procedural palette hue |
| bass push, eased in over ~60 ms | `swell` ≤ 0.4 | UNet `conv_in` dilation |
| treble onsets, fading over ~200 ms | `glass` ≤ 0.9 | UNet `up_blocks.2` soft threshold |
| drops: fast energy > slow + 0.3, 4 s warm-up, 8 s cooldown | `lurch` ≤ 0.2 | UNet `conv_in` inversion |

Beat pushes come only from a trusted grid (Spotify analysis, or rhythm
confidence > 0.5) or a real bass onset. Without Spotify analysis, the
synthesized grid wandered 103–149 BPM.

## Semantic direction (browser decides)

`TrackContext.meaning` carries the optional versioned `SongMeaning` contract
from `src/director/semantic.ts`. It contains motifs, relations, section
actions, evidence, confidence, and an abstention flag. `MotifLedger` preserves
stable anchors across decisions. `sceneFromPlan` compiles that state into a
`SemanticScene` with a shot, action, relation, camera, and transition.

Scene compilation is explicitly source-gated: `semantic-manifest` uses only the
evidence-backed subject/action/environment; `metadata-fallback` records that
metadata concepts were available but withholds them from the narrative prompt;
`abstract-fallback` has no metadata concepts. Both no-meaning paths use
non-narrative abstract motion. The old content-specific world phrases are not used by fallback,
so missing meaning cannot silently invent a cathedral, flowers, or another story.
`SongMeaning.language` is an optional BCP 47 tag propagated to telemetry; language
identification and translation remain upstream research seams.

The prompt realization is now shot-oriented rather than a comma-joined visualizer
tag list. It names a music-video shot, action, camera, and visual treatment. In a
metadata fallback, title words are explicitly withheld and receive only a
story-neutral action; a manifest can replace that action with evidence-backed
relations and section events.

The resulting `Scene` carries a typed fingerprint:

```text
identity | action | environment | look | camera
```

The scheduler compares this fingerprint, not prompt prose. A wording change is
not a visual event; an identity/action/environment change is. The scalar
`continuity` remains a renderer initialization parameter, not an identity
guarantee. In either fallback source, the fingerprint is intentionally stable
for the track: director refreshes can still make a strong procedural look
chapter transition, but they do not request a new diffusion keyframe. This
keeps variance in the music-video substrate without abrupt image resets.

Each scene also carries a `continuityContract` beside the legacy scalar. It
states whether identity, action, environment, and camera are preserved,
evolved, replaced, or intentionally abstained, plus the evidence class and
confidence. This makes continuity inspectable without changing the sidecar
protocol.

## Checkpoint realization (browser decides, sidecar renders)

- **What:** the director runs on section boundaries, or at most every 30 s.
  `sceneFromPlan` compiles the current meaning/shot plus weighted visual
  labels into a prompt with a deterministic seed and procedural `look`. A
  high hard-cut probability means continuity 0 for the renderer.
- **When:** by default `CheckpointScheduler` fires for the initial scene and
  new scene meaning only. The diffusion state then animates continuously from
  frame to frame. Periodic re-seed and stagnation recovery remain available
  with `AppConfig.reseed: true` for long-run drift experiments, but are not the
  normal music-video path. It never fires mid-splice and scene changes land on
  a downbeat when possible.
- **How:** the sidecar denoises the 4-step keyframe (timesteps 999, 749, 499,
  249) one step per fast frame, batched with the live frame in a single
  batch-2 UNet call. The keyframe is never bent. With a procedural frame
  arriving, the keyframe starts from it at continuity ≥ 0.5 (steps 499 and
  249), so it is the director's scene painted over the structure on screen.
  The finished keyframe is painted in region by region over one or two
  bars, while the prompt embedding crossfades.

## Ownership

| Owner | Owns |
| --- | --- |
| Browser | audio analysis, all timing decisions, the director, the procedural scene, paint |
| Sidecar | the diffusion state: painted frames, keyframe jobs, bends, keyframe-mode camera/flow |
| Renderer | the 60 Hz display: procedural scene, stream upscale + crossfade, paint mix, beat kick |

The protocol is one websocket, with one owner at a time (ADR-013).

- **Browser → sidecar, text:** `control` (latest wins, ~30 Hz), `track`
  (metadata/meaning lookup), `blend`, and `checkpoint`.
- **Browser → sidecar, binary:** a 576×320 JPEG procedural frame. One is in
  flight at a time; the next is sent when a painted frame returns, or after
  250 ms.
- **Sidecar → browser, text:** `ready`, `concepts`, and `meaning` messages;
  meaning is a local manifest lookup and may be null. The sidecar does not
  fetch lyrics or choose story content.
- **Sidecar → browser, binary:** `[u32 header length][JSON meta][JPEG]`,
  latest wins, so slow clients skip frames.
- **Close 1013 `busy`:** another client owns the sidecar. Retry every 3 s.

## Telemetry

The Electron build writes JSONL to `logs/`:

- one decision record per director answer, with the threshold baseline, the
  compiled scene, semantic revision, and scene fingerprint;
- one `_checkpoint` record per splice request, with its reason, look, and
  `timing` receipt (grid source, confidence, target beat, commit time, phase
  error, and timeout fallback);
- one `_telemetry` record every 5 s: display fps, stream fps, paint, the
  control values, `captureMs`, and the latest sidecar meta: `input`
  (procedural/keyframe), `genMs`, `change`, `jitter` (latent second
  difference: the smoothness metric), `drift`, and the checkpoint phase.
- one compact `_state` record per second: track identity, section, audio
  summary, active scene prompt, sampler control, and the latest sidecar
  change/jitter/drift. This is intentionally separate from health telemetry
so phrase-scale analysis does not require parsing the verbose five-second
record.

Run `npm run evaluate:logs -- logs/<session>.jsonl` for a deterministic offline
summary of scene-source coverage, fingerprint changes, and timing fallback
rate. It deliberately reports visual identity/action verification as deferred:
telemetry is not a substitute for a visual evaluator.

Log files are bounded: each session part is capped at 16 MiB by default, and
startup retention keeps at most 64 session files / 512 MiB in `logs/`. Override
`S1_LOG_MAX_BYTES`, `S1_LOG_MAX_FILES`, or `S1_LOG_MAX_TOTAL_BYTES` when running
long evaluation campaigns. Rotated parts remain ordinary JSONL with their own
`_meta` header and build hash.

## Known limits

- **Song narrative is not automatically extracted.** The runtime has a local
  evidence-bearing manifest seam and explicit abstention. Lyric or
  audio-language extraction remains unbuilt and must be evaluated separately.

- **Resolution:** 576×320, upscaled with an unsharp mask. There is no
  budget for AI upscaling on this GPU.
- **Latency:** the painted layer trails the procedural one by about one
  capture, generation and decode round trip (~100–150 ms). The beat kick is
  display-side, so beats stay on time; at high paint, fast motion shows a
  slight lag.
- **Drift is bounded, not eliminated.** Characters do not persist for
  minutes; re-seeding every 16 bars is the bound.
- **The audio→visual mapping has no ground truth.** It is hand-tuned and
  tested for monotonicity. The log analysis (2026-09-24) found picture change
  correlating only ~0.3 with the music. A closed-loop coupling controller is
  on the roadmap.
- **SD-Turbo's license** is the Stability AI Community License
  (non-commercial without a separate agreement).
