# system1-visualizer

A procedural WebGL2 music visualizer for Spotify, directed by a **System One
model** — a classifier that answers typed questions over closed enumerations
and returns calibrated probabilities instead of text.

The model never draws anything. Once a section, it is asked six questions
about what the visuals should be doing. Code expands its answers into shader
uniforms, and a fragment shader renders the result.

```
audio ──> features ──> [ System One ] ──> plan ──> blended uniforms ──> GLSL
          spectrum      6 questions        distributions
          structure     closed enums       not argmax
```

## The idea

`jev-playground` used TypeSafe's Jev to steer *music*: pick a character, then
globals, then per-phrase harmony, all from enums, and let code render the
notes. This does the same thing for *visuals*.

The difference is what happens to the probabilities. jev-playground collapses
each answer to a single pick via argmax or nucleus sampling. Here the whole
distribution survives into the renderer: every vocabulary entry maps to a
numeric parameter vector in a shared space, so an answer of

```
motion: collapse 0.35, shear 0.30, orbit 0.23
```

blends into one velocity field that is 35% collapse, 30% shear, 23% orbit.
Calibration becomes a visual degree of freedom rather than a confidence score
you throw away. Two labels the model finds equally plausible render as an
actual mixture.

## Six questions

These are the current implementation questions. The broader target control
layer model—timbre, energy, density, space, material, memory, lifecycle, and
others—is documented in [docs/control-layers.md](docs/control-layers.md). It is
intentionally not yet represented as one question per layer.

| Question | Type | Vocabulary |
| --- | --- | --- |
| `motion` | choice | drift · orbit · pulse · shear · turbulent · collapse · bloom · lattice |
| `palette` | choice | ember · ice · ultraviolet · chlorophyll · sodium · oxide · monochrome · spectral |
| `texture` | choice | filament · plasma · grain · cellular · strata · shards |
| `symmetry` | choice | none · mirror · kaleido3 · kaleido6 · kaleido12 · polar |
| `feedback` | choice | none · trail · zoom_in · zoom_out · swirl · smear |
| `intensity` | score | 5 levels, dormant to overwhelming |
| `hard_cut` | noul | cut instantly, or crossfade |

All of it lives in `src/director/vocab.ts`. Each entry carries a description
the model reads and a parameter vector the shader consumes; add an entry and
both ends pick it up.

## Engines

Every engine speaks the same protocol — `state` + `questions` in, `answers`
with `probabilities` out — so they are interchangeable at a constructor
argument. `DecisionEngine` in `src/director/engine.ts` is the seam.

| Engine | Size | Latency | Status |
| --- | --- | --- | --- |
| **`LocalSystemOne`** (default) | 0 MB | ~0.1 ms | Built in, always available |
| **Jev** (TypeSafe, hosted) | 0 MB | 70–500 ms | Needs a key; early-access waitlist |
| **Laya / kev / LitJev** (local sidecar) | 0.3–1.7 GB | 30–90 ms | Opt-in, via `proxyUrl` |

### Why the local engine is the default

The decision this project makes is six questions over at most eight options,
driven by three scalars — energy, brightness, percussiveness. The open System
One models are 400M+ parameter text encoders trained on support tickets,
invoices and security incidents. Pointed at a JSON string of six floats they
are far outside their training distribution, which means the calibration
guarantee — the entire reason to want one — does not transfer.

`LocalSystemOne` scores each label against an ideal audio profile and
softmaxes the distances. It is not learned, and its probabilities are honest
preferences rather than measured frequencies. But it is in-domain, it is
deterministic, it costs nothing, and it has no option-order sensitivity — the
published kev card reports ~20% argmax flips under option permutation, which
would be poison for a renderer that blends the distribution.

### Where a real model would earn its place

Not on the audio numbers — on **track metadata**. "Given this is a 1970s dub
reggae record, which palette?" is a natural-language judgment a text encoder
is actually good at and the profile scorer is blind to. The right split is
per-section decisions locally from the spectrum, and a per-*track* semantic
decision from a real System One model. `TrackContext` already carries title,
artist and genres for exactly this.

### Using a hosted or sidecar engine

```js
// In Spotify's console:
__s1.configure({ apiKey: 'sk-...' })                       // hosted Jev
__s1.configure({ proxyUrl: 'http://127.0.0.1:8765' })      // local sidecar
__s1.configure({ substrateUrl: 'http://127.0.0.1:8766/v1/substrate' }) // image substrate
__s1.configure({ perceptionUrl: 'http://127.0.0.1:8767/v1/audio-perception' }) // learned audio
__s1.configure({ lyricsUrl: 'http://127.0.0.1:8768/v1/lyrics', lyricsMode: 'overlay' }) // rights-aware lyrics
```

For a local audio-native perception path, install
`python -m pip install -r tools/requirements-audio-perception.txt`, start
`npm run perception:server`, and use the `perceptionUrl` above. Spotify audio
is captured through the existing shared-audio prompt; the browser sends a
bounded recent PCM window to MERT-v1-95M only when a semantic decision is due.

### Where the TypeSafe key lives

The key is never committed, never baked into a build, and never written to
`dist/` or `logs/`. Each surface holds it on its own machine only:

- **Spicetify extension** — `__s1.configure({ apiKey: 'sk-...' })` in
  Spotify's console. It persists in Spicetify LocalStorage on that machine;
  reload Spotify to apply.
- **Electron / dev harness** — a generic Windows credential named
  `visualizer/typesafe-apikey`. Store it once (input is hidden, nothing is
  echoed or logged):

  ```powershell
  powershell -NoProfile -File scripts/cred-key.ps1 -Store   # save
  powershell -NoProfile -File scripts/cred-key.ps1 -Check   # exit 0 = present
  powershell -NoProfile -File scripts/cred-key.ps1 -Clear   # remove
  ```

  The Electron main process reads it at startup and hands it to the renderer
  over IPC; with no key the harness silently uses the built-in local engine.
  `TYPESAFE_API_KEY` in the environment takes precedence when set, and
  `?key=...` on the dev URL overrides both for a quick test (it lands in
  browser history, so prefer the credential store).

`tools/laya-server.mjs` is an optional sidecar that serves `/v1/systemone`
backed by Laya through ONNX Runtime. It is not part of the build and pulls no
dependencies unless you run it.

The optional image substrate sidecar is wired through the same persisted
settings path: start it with `npm run substrate:server`, then configure
`substrateUrl` and reload Spotify. When it is unset, the extension remains
procedural-only.

## Audio

Spotify's playback is DRM-protected — there is no AudioContext node to tap and
no way to read its samples. Two sources cover between them what one cannot:

- **Loopback** (`getDisplayMedia`) — a real 1024-bin FFT of whatever the
  machine is playing. Requires a one-time "share audio" grant. This is the
  guaranteed floor and works with any audio, not just Spotify.
- **Analysis** (`Spicetify.getAudioData`) — Spotify's own beat, bar, section
  and key data, via the internal `wg://audio-attributes/...` cosmos endpoint.
  No auth, so the Nov-2024 Web API deprecation does not govern it, but not
  every track has analysis and the service's longevity is not guaranteed.

Neither is required. With no analysis, a fallback clock estimates tempo from
inter-onset intervals and free-runs a beat grid. With no capture, the visuals
run on structure alone. The HUD says which are live.

## Build

```bash
npm install
npm run dev          # dev harness at localhost:5174 — no Spotify needed
npm run build
npm run install-ext  # copies into Spicetify's Extensions folder
```

Then enable it:

```bash
spicetify config extensions system1-visualizer.js
spicetify apply
```

`Ctrl+Shift+V` toggles it, `H` toggles the HUD, `Escape` closes.

### The dev harness

Reloading a Spicetify extension means restarting Spotify, which is far too
slow to iterate on a shader. `npm run dev` runs the *identical* pipeline —
same renderer, same director, same vocabulary — in a browser tab with hot
rebuilds, capturing system audio. Anything Spotify-specific arrives through
`AppConfig.context` or an `AudioSource`, so the harness exercises the real
code rather than a mock of it.

## Semantic fan-out

The renderer split settled into three layers, and it's worth naming since it
shapes every decision about where a new capability goes:

```
DSP / game loop     decides WHEN things happen   (beat clock, section timing)
System1             decides WHAT is happening     (six typed questions, distributions)
Renderer            decides HOW that manifests    (shader math, derived from System1's output)
```

The middle layer stays deliberately small. When the reaction-diffusion and
particle systems were added, the temptation was to give System1 direct
control over them too - a `particle_brightness` question, an
`rd_influence` question. That's the wrong move: it turns one coherent
judgment into a pile of increasingly microscopic ones, and every new renderer
mechanism would demand its own question forever.

Instead, each new mechanism reads values System1 already produces:

```
                 texture: cellular .62
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
      RD blend weight   particle    surface
      (via uDetail)     brightness  detail
              │           │           │
              └───────────┼───────────┘
                          ▼
                coherent "cellular" visual world
```

One semantic judgment fans out into several coherent renderer mechanisms,
instead of one classifier output driving exactly one shader knob. This is
also why the baseline director (`offlinePlan`) had to be upgraded to produce
real distributions over the same six dimensions rather than one-hot picks:
the fan-out is identical on both sides of the comparison. What's being tested
is which director produces better *semantic state*, not which one happens to
plug into a richer renderer - both plug into the same one.

## Layout

```
src/
  audio/      loopback FFT, Spotify analysis, feature bus, fallback beat clock
  director/   vocabulary, engines (local / Jev / sidecar), decision timing
  render/     WebGL2 ping-pong feedback, GLSL
  ui/         overlay canvas and diagnostic HUD
dev/          standalone harness
tools/        optional Laya sidecar
```

## Notes

- The feedback accumulator is energy-conserving (`prev*d + color*(1-d)`).
  The obvious `prev*d + color` settles at `color/(1-d)` and saturates the
  screen to white within a second at any useful decay.
- Half-float render targets when `EXT_color_buffer_float` is available. On
  8-bit targets `prev * decay` quantizes to zero and trails die early.
- The director decides from a windowed average, not a single frame: one frame
  is a coin toss on whether it caught a transient.
- Hysteresis in the local engine must stay small relative to the softmax
  temperature — they combine as `exp(bonus/T)`, so a large bonus makes the
  current look win regardless of the audio.
- `offlinePlan` (the baseline director) and `LocalSystemOne` must stay
  mechanically distinct - both produce distributions now, but the baseline
  is one-feature-per-dimension triangular interpolation, never multi-feature
  profile distance. If they converge to the same mechanism, the A/B they
  feed stops measuring anything.
- Every log file is stamped with an 8-character hash of the actual running
  bundle (`dist/dev/harness.js`), both in the filename and as the first line.
  Two logs with the same hash came from provably identical code; a tuning
  change between runs is visible without cross-referencing commits.

## Validation protocol

The standing plan for the real-music A/B pass, recorded so a tuning session
doesn't quietly turn into re-deciding the protocol each time:

1. Performance/stability first: frame time and FPS (`[perf]` lines in the
   terminal, every 5s), RD/particle/bloom cost isolated via the `1`/`2`/`3`
   debug toggles in the dev harness, and RD stability sampled every 20s for
   NaN or a flatlined pattern over a multi-minute session.
2. Same semantic space, same renderer, both sides: `offlinePlan` (A) and
   whichever engine is primary (B) both produce full distributions over the
   same six questions, both feed the identical renderer fan-out.
3. Real-music A/B on musically interesting near-neighbors: similar energy /
   different texture, similar tempo / different density, loud-smooth vs
   loud-percussive, quiet-tense vs quiet-dreamy, buildup vs sustained loud,
   section changes within one track.
4. Log both directors' full distributions and the resulting blended
   parameter vectors for identical windows - already wired: every decision
   record's `system1` and `baseline` blocks are directly comparable.
5. Do not tune based on which output looks prettier mid-A/B. Record
   divergences and failures first; any tuning discovered during validation
   gets applied as a separate, clearly separated pass afterward, not folded
   silently into the comparison run.
6. Report whether System1 contributes meaningful semantic structure beyond
   what the strengthened deterministic baseline already provides - that is
   the actual question this whole pass exists to answer.

## Next

- Blue-noise tile (~4KB) to replace the white-noise hash in grain and dither.
- Per-track semantic decision from genre and artist, as described above.
- Onset-synced hard cuts on the beat grid rather than at section boundaries.

## Future directions — hypotheses, not requirements

Recorded so they aren't lost, gated behind the real-music validation pass in
`logs/`. **Do not implement any of this until that evaluation shows System1
is earning its keep over the direct baseline.** If it doesn't, some of this
is the wrong next step regardless of how appealing it looks on its own.

Renderer-design candidates for the next pass, if warranted:
- GPU-native feedback / ping-pong buffers (beyond the one already in place)
- reaction-diffusion systems
- flow/advection fields
- signed-distance-field geometry
- GPU particle systems
- multi-pass post-processing
- precomputed blue-noise texture for cleaner dithering/grain (see above)

Also worth investigating: lyrics as a track-level semantic input, alongside
genre/artist/artwork, for a real System One (or LLM) engine specifically —
sentiment and theme from lyrics is language-shaped, not a fit for the local
float-scorer. Several current Spicetify extensions pull lyrics successfully
via `CosmosAsync` against Spotify's color-lyrics endpoints (404Lyrics, Spicy
Lyrics, the official `popupLyrics.js`), so this is plausible - but like
`getAudioData`, it is an internal endpoint, unstable across client updates,
and needs its own verification pass before depending on it, not an assumption
carried over from this note.

Also worth investigating: a wider control surface — more audio features into
System1's state (stereo width, loudness range, spectral centroid, whatever
turns out to matter), more vocabulary dimensions on the output side, and/or
exposed manual controls a listener can nudge directly. This one needs its own
scoping pass before it's buildable — "more controls" isn't yet a spec, and the
validation pass may surface which specific dimensions are actually starved for
input versus which ones the current six questions already cover fine.

Also worth investigating: browser-native album-art analysis — downsample
artwork cheaply with Canvas/ImageBitmap, extract dominant colors, luminance,
saturation, contrast, and possibly coarse spatial structure, and use that as
track-specific visual DNA rather than displaying or blurring the cover
directly. The interesting question is whether System1's semantic read and the
artwork's visual DNA should jointly determine how a track's visual world
manifests, rather than either alone.

Also worth investigating: a neural/semantic visual substrate underneath the
procedural field — recognizable structure that appears and dissolves rather
than clean generated pictures. The target is pareidolia ("I swear I can see
a forest in there"), not illustration. Two tiers, both gated behind the same
validation: (1) a small realtime neural primitive (CPPN in GLSL, neural CA,
or tiny implicit field) driven by System1's existing distributions through
the normal fan-out — e.g. a WORLD abstraction weight blending procedural vs
neural contribution, no new per-mechanism questions; (2) heavyweight semantic
keyframes (one image every 20–60s, at section boundaries: ~0.02–0.05 fps)
that the realtime loop then lives inside — flow distorts it, RD consumes it,
feedback remembers pieces, System1 morphs toward the next anchor. BPM as a
clock: per-beat generation (~2 fps at 120 BPM) needs 1-step distilled models
plus TensorRT on a 4090-class GPU; per-bar (~0.5 fps) is feasible locally
with 1–4 step SD-Turbo/LCM; per-section keyframes are trivially feasible
even via sidecar/cloud. StreamDiffusion-class 60 fps diffusion is real on a
4090 at 512px but is the wrong target here — the extension runs in Chromium
and the win is 0.02 AI frames/sec plus 60 procedural transforms/sec.

Constraint that holds regardless of what's built: no Python/Pillow in the
runtime rendering path. The extension runs in Chromium; WebGL2 stays
responsible for real-time rendering. Offline baking is fine only where it has
a demonstrated advantage — a precomputed blue-noise texture, not a rendering
pipeline.
