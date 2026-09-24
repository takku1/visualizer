# system1-visualizer

A versioned audiovisual world engine: audio perception drives procedural
structure, optional evidence-backed song meaning drives section shots, and a
diffusion model paints the result.

- **Procedural scene (60 fps, in the browser).** A shader scene travels,
  swirls and surges with the music at exact beat sync. It is shown directly,
  and also sent to the sidecar as the diffusion loop's camera input.
- **System 1 — the fast loop (~10–17 fps on a 6 GB RTX A3000 Laptop GPU).** A
  StreamDiffusion-style img2img loop paints the procedural frame with one
  SD-Turbo step per frame. Audio never *describes* anything here. It perturbs
  the sampling physics (strength, noise, detail, beat pushes) and, through
  network bending, the UNet's own activations: harmony rotates its colour
  world, bass swells it, treble glints, and drops lurch the scene. **Paint**
  (0–1) sets how much of the procedural scene gets painted over.
- **Semantic direction + realization — the slow loop (bars and sections).** An
  optional local `SongMeaning` manifest supplies motifs, relations, actions,
  evidence, and abstention. A System One director
  (the built-in local engine, hosted Jev, or a Laya sidecar) judges the music
  and compiles its answer into a scene: a prompt for the painter, and a
  procedural look (palette, symmetry, form). A 4-step keyframe is
  denoised time-sliced into the fast loop, then painted into the live picture
  region by region. Periodic re-seeding bounds drift. This is structural,
  not a workaround.

```
audio ─► FeatureBus ─► ControlMapper ─► physics + bends ───────────────► stream sidecar
             │              └─► procedural scene (60 Hz) ── JPEG ──────►  (SD-Turbo + TAESD,
             │                        │                                    CUDA graphs)
             │                        └─► display ◄── mix(paint) ◄── painted JPEG ◄┘
             └─► Director ─► scene (prompt + look) ─► CheckpointScheduler ─► keyframe on a downbeat
```

See [docs/architecture.md](docs/architecture.md) for the design, and
[docs/decisions.md](docs/decisions.md) for why these models and not others.

## Run it

```bash
npm install
pip install -r tools/requirements-stream.txt   # torch with CUDA first
npm run models        # ~2.5 GB: SD-Turbo fp16 UNet + text encoder, TAESD
npm run app           # builds, starts the sidecar, opens the Electron app
```

`npm run app` starts `tools/stream-server.py` and the local meaning worker alongside Electron. The app
connects as soon as the model has loaded (~5 s), and shows the procedural
scene on its own until then. Only one window can drive the sidecar at a
time; a second one waits and takes over when the first closes. To run the pieces separately:

```bash
npm run stream        # sidecar alone, ws://127.0.0.1:8771
npm run dev           # browser harness at localhost:5174 (?stream=off, ?stream=ws://...)
npm run stream:bench  # headless throughput + sample frames in output/stream-bench
npm run app -- --no-meaning  # isolate diffusion/procedural performance
```

`H` toggles the HUD. Expand it ("capture info") to see the live sampler
physics, the checkpoint phase, the stream fps, the paint level, and the
current scene prompt. `[` and `]` lower and raise **paint**: 0 shows the
procedural scene alone, 1 shows it fully painted by the diffusion stream.

The meaning worker defaults to CPU so it does not compete with the diffusion
sidecar's GPU. Procedural rendering never waits for semantic meaning; until
evidence commits, the director remains explicitly abstaining.

**Performance:** plug the laptop in. On battery the A3000 drops to ~585 MHz,
and the same frame takes 3× longer.

## Tests

```bash
npm test                              # mapper, scene compiler, checkpoint scheduler (pure logic)
node scripts/stream-smoke.mjs         # against a running sidecar: protocol, causality, checkpoint lifecycle
npm run typecheck
```

The smoke test is metamorphic: aggressive sampler physics must produce more
frame-to-frame change than calm ones. That proves the audio→physics path
reaches the pixels without needing a ground-truth image.

## Engines (System 2's judgment)

Every engine speaks the same protocol — `state` + `questions` in, `answers`
with `probabilities` out — so they are interchangeable at a constructor
argument. `DecisionEngine` in `src/director/engine.ts` is the seam.

| Engine | Size | Latency | Status |
| --- | --- | --- | --- |
| **`LocalSystemOne`** (default) | 0 MB | ~0.1 ms | Built in, always available |
| **Jev** (TypeSafe, hosted) | 0 MB | 70–500 ms | Needs a key |
| **Laya** (local sidecar, `tools/laya-server.mjs`) | 1.7 GB | 30–90 ms | Opt-in, via `proxyUrl` |

The director's answer (motion, palette, texture, geometry, symmetry,
intensity, hard-cut) and optional evidence-backed meaning are compiled into a
typed shot scene in `src/stream/scenes.ts`. Its fingerprint separates
identity, action, environment, look, and camera changes; prompt prose is only
the renderer artifact.
Every decision is logged next to a threshold-rule baseline, so you can check
whether the engine is doing real semantic work.

### Where the TypeSafe key lives

The key is never committed, baked into a build, or written to `dist/` or
`logs/`.

- **Electron / dev harness** — a generic Windows credential named
  `visualizer/typesafe-apikey`:

  ```powershell
  powershell -NoProfile -File scripts/cred-key.ps1 -Store   # save (hidden input)
  powershell -NoProfile -File scripts/cred-key.ps1 -Check   # exit 0 = present
  powershell -NoProfile -File scripts/cred-key.ps1 -Clear   # remove
  ```

  `TYPESAFE_API_KEY` in the environment takes precedence. `?key=` on the dev
  URL overrides both, but it lands in browser history.
- **Spicetify extension** — `__s1.configure({ apiKey: 'sk-...' })` in
  Spotify's console. Also available there: `proxyUrl` and `streamUrl`.

## Audio

Spotify's playback is DRM-protected, so two sources cover what one cannot:

- **Loopback** (`getDisplayMedia`) — a real 1024-bin FFT of whatever the
  machine is playing. Electron grants system-audio loopback without a picker.
- **Analysis** (`Spicetify.getAudioData`) — Spotify's own beat, bar, section,
  and key data. Extension build only; not every track has it.

With no analysis, a fallback clock estimates tempo from onsets and free-runs
a beat grid (see [docs/rhythm-model.md](docs/rhythm-model.md)). With no capture, the loop
idles at its calm operating point.

## Spicetify

```bash
npm run install-ext
spicetify config extensions system1-visualizer.js
spicetify apply
```

`Ctrl+Shift+V` toggles it. The extension connects to the same local sidecar
(`ws://127.0.0.1:8771`), which must be running.

## Layout

```
src/audio/      loopback FFT, Spotify analysis, feature bus
src/rhythm/     beat/bar/feel inference
src/director/   semantic manifest/ledger, director + engines (local, Jev)
src/stream/     control.ts   audio -> sampler physics and network bends (System 1)
                scenes.ts    director plan -> keyframe prompt + procedural look
                checkpoint.ts when to re-seed, landed on downbeats (System 2)
                client.ts    websocket to the sidecar
src/render/     procedural.ts + shaders/procedural.glsl  the 60 Hz scene
                capture.ts   renders it small as the sidecar's camera input
                renderer.ts  display: procedural mixed with the painted stream
meaning/        local versioned SongMeaning manifests (see meaning/README.md)
tools/          stream-server.py (the GPU sidecar), fetch-models.py, laya-server.mjs
electron/       app shell, loopback grant, JSONL logging to logs/
```
