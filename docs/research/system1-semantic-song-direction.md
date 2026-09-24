# Research: semantic song direction for System One

## Question

How should the visualizer move from a prompt such as “fig and smoke, within a
collapsing cathedral of light” to a visual treatment that understands the song
as a whole — for example, a girl running through a field — without turning the
frame loop into a hallucinating narrator?

## Finding

The missing abstraction is not a better prompt. It is a **semantic song state**
between audio analysis and the renderer:

```text
audio + lyrics/metadata
        │
        ▼
meaning extractor (slow, uncertain)
        │  motifs, agents, places, actions, affect, evidence
        ▼
story compiler (deterministic)
        │  typed scene graph + motif memory + section beats
        ▼
checkpoint prompt + procedural look + renderer anchors
        │
        ├── System 1 fast loop: animate, perturb, preserve identity
        └── System 2 checkpoint: introduce/revise/reveal semantic content
```

The renderer should not infer “what is happening” from a single spectral
window. It should receive a small, persistent world model and a bounded
transition such as `approach(field)`, `pursue(girl, horizon)`, or
`collapse(cathedral)`. This expresses a relationship and an arc, not merely a
list of nouns.

## What the primary sources imply

1. Audio-text models are useful semantic bridges, but their natural output is
   a caption or answer, not a stable animation plan. CLAP learns a joint
   audio/text space for flexible concepts; MusCaps treats music description as
   audio captioning; MU-LLaMA and MOSS-Music add music question answering,
   captioning, lyrics, and structure reasoning. Use these systems to propose
   evidence and hypotheses, not to control pixels directly.

   Sources: [CLAP](https://arxiv.org/abs/2206.04769),
   [MusCaps](https://arxiv.org/abs/2104.11984),
   [MU-LLaMA](https://github.com/shansongliu/MU-LLaMA),
   [MOSS-Music](https://github.com/OpenMOSS/MOSS-Music).

2. Time alignment matters. Lyrics alignment work treats words/lines as
   timestamped events, and transcription APIs expose segment or word
   timestamps. A lyric concept should enter the visual state near the
   phrase that supports it, with confidence and a source span.

   Sources: [lyrics alignment](https://arxiv.org/abs/1902.06797),
   [audio transcription reference](https://platform.openai.com/docs/api-reference/audio/createTranscription).

3. Persistent identity is a separate problem from semantic understanding.
   Recent text-to-video work explicitly adds identity-preserving attention or
   reconstruction memory because ordinary prompt conditioning does not keep a
   subject stable across shots. Keep identity anchors stable across
   checkpoints and vary camera, action, and lighting around them.

   Sources: [ID-Composer](https://arxiv.org/abs/2511.00511),
   [Memento](https://arxiv.org/abs/2606.14667).

## Proposed architecture: Motif Ledger and Scene Compiler

### 1. Meaning extractor

Run at track start, then only on section boundaries or when a lyric phrase
changes. Inputs are available lyrics/transcript, title/artist/genres, album
art, section labels, and a summarized audio window. Ask for structured data:

```ts
interface SongMeaning {
  thesis: string;
  motifs: Motif[];
  sections: MeaningSection[];
  evidence: Evidence[];
}

interface Motif {
  id: string;
  kind: 'person' | 'place' | 'object' | 'force' | 'texture' | 'symbol';
  label: string;
  attributes: string[];
  confidence: number;
  source: 'lyrics' | 'audio' | 'metadata' | 'inference';
}

interface MeaningSection {
  startSec: number;
  endSec: number;
  action: string;
  activeMotifs: string[];
  affect: string[];
  confidence: number;
}
```

The extractor must be allowed to say `unknown` and preserve evidence. “Girl
running through a field” is lyric-supported; “cathedral” inferred only from
mood remains an optional interpretation.

### 2. Motif Ledger

The ledger is the memory that the current prompt string lacks. It tracks each
motif’s identity anchor, last seen section, visual aliases, relationships, and
continuity weight. It prevents semantic churn when the director is called
again.

```ts
interface MotifLedgerEntry {
  motifId: string;
  anchor: string;
  relations: string[];
  continuity: number;
  reveal: number;
  lastSection: number;
}
```

### 3. Story compiler

Compile meaning into a finite scene graph instead of a free-form prompt:

```ts
interface SemanticScene {
  shot: 'establish' | 'follow' | 'approach' | 'encounter' | 'fracture' | 'release';
  subjects: string[];
  relation?: string;
  environment: string[];
  action: string;
  camera: string;
  transition: 'hold' | 'reveal' | 'cut' | 'dissolve';
  prompt: string;
}
```

For the example song:

```text
intro      establish: field / distant runner / dawn haze
verse      follow: runner crosses field / camera trails / wind bends grass
prechorus  approach: horizon becomes cathedral-like light / scale expands
chorus     encounter: runner enters collapsing light structure / hard bloom
bridge     fracture: figure separates into filaments / uncertainty rises
outro      release: field remains, figure dissolves into teal smoke
```

This is not a literal music-video storyboard. It is a small set of visual
commitments that can survive painterly diffusion and procedural motion. The
novel part is the **relation** and the **transition**: they give the image
verbs and continuity, not only nouns and style adjectives.

### 4. Renderer contract

The keyframe prompt should be generated from the scene graph plus the existing
look vocabulary. System 1 gets three distinct inputs:

- stable anchors: subject/environment identity, held across several
  checkpoints;
- section action: one verb or relation that may change at a checkpoint;
- audio physics: the existing fast modulation of motion, noise, detail,
  feedback, hue, and intensity.

The first two are semantic. The third is continuous. Never rebuild all three
from the current audio frame.

## Why this fits the current project

- It preserves ADR-001/002: the fast loop remains semantic-free and the
  sidecar remains a renderer.
- It extends `TrackContext.concepts` into evidence-backed motifs instead of
  passing a few unstructured words.
- It uses the existing section/checkpoint cadence and weighted visual
  vocabulary.
- It makes prompts an inspectable output rather than the architecture itself.
- It makes abstention measurable: compare lyric-supported scenes, audio-only
  scenes, and the existing threshold baseline.

## Evaluation plan

Add a receipt to every semantic checkpoint:

```text
semantic_source: lyrics | metadata | audio-caption | none
motif_coverage: fraction of active motifs represented
relation_coverage: fraction of active relations represented
anchor_survival: similarity of subject/environment embeddings across checkpoints
semantic_churn: unexplained motif identity changes per minute
abstained: boolean
```

The first experiment should not train a model. Use the existing director,
provide a hand-authored or extracted motif ledger for 10 songs, and compare:

1. current adjective prompt;
2. typed scene graph compiled to a prompt;
3. typed scene graph plus persistent anchors.

Human scoring should ask “does this feel like the same song/world?” and “can a
viewer describe the visual relationship/action after 20 seconds?” The target
is not literal lyric illustration; it is durable semantic coherence.

## Recommendation

Implement the typed `SongMeaning`/`MotifLedger`/`SemanticScene` seam before
training the proposed FiLM adapter. FiLM can make audio affect activations,
but it cannot by itself know who is running, where they are, or what changed
in the song’s story. The semantic compiler supplies that missing state while
keeping the real-time loop within the current GPU and latency budget.

## Concrete case: anime music → anime girl

Yes, the system can produce an “anime girl” checkpoint, provided the current
image model has learned that visual concept. Text-conditioned image models are
designed to reference learned visual concepts through natural language, which
is why a compiled anchor such as `anime-styled girl` can work without training
a new renderer. [CLIP](https://arxiv.org/abs/2103.00020) is the foundational
example of natural-language access to visual concepts; the current project’s
SD-Turbo checkpoint is the actual authority on which concepts it can render
well.

The important distinction is evidence:

```text
anime genre tag / album art / lyrics / audio-language model
                         │
                         ▼
subject hypothesis: anime-styled girl (confidence: 0.72)
                         │
                         ▼
checkpoint anchor:
  subject: anime-styled girl
  identity: short dark hair, red scarf, school uniform
  action: running through a windblown field
  camera: distant follow shot
  style: oxide/teal filament light, painterly diffusion
```

“Anime music” alone should not deterministically mean “anime girl.” It is a
prior, not proof. The extractor should combine genre/artist/cover signals with
lyrics or a music-language model, then either abstain or mark the subject as a
low-confidence interpretation. If the song is instrumental, the system can
still choose the subject as a creative prior, but the receipt must say that it
was inferred rather than lyric-supported.

The checkpoint injection should be structured, not one ever-growing sentence:

```json
{
  "anchors": ["anime-styled girl", "red scarf", "open field"],
  "relation": "girl runs toward a luminous horizon",
  "action": "run",
  "continuity": 0.9,
  "confidence": 0.72,
  "source": "genre+artwork+semantic-inference"
}
```

At the next checkpoint, preserve the anchor and change only the action or
world state: `run → stop → look back → dissolve`. The fast loop can make the
scarf flutter, push the grass with bass, and make the horizon bloom on the
chorus. It should not decide that the girl became a cathedral, a robot, or a
different character because one frame was noisy.

There are two practical limits:

- A text prompt can request a concept, but it cannot guarantee a stable face,
  outfit, or pose across many re-seeds. That is why the Motif Ledger and
  continuity anchors matter; a future reference-image or identity adapter
  would improve this further.
- “Anime girl” is a subject/style token, not song understanding. The semantic
  value comes from attaching it to an action, relationship, and section arc:
  `girl crosses field`, `girl approaches light`, `girl dissolves into smoke`.

So the desired behavior is feasible now as a checkpoint-level experiment. The
minimal research prototype is to hand-author or extract one subject anchor and
three section actions for a small set of anime tracks, then compare subject
recognition and continuity against the current adjective-only prompt.

## Long-term target: a procedural music-video director

The eventual system should be understood as a **procedural music-video
generator**, not an audio-reactive wallpaper engine. The director owns a
compact film grammar; the renderer fills each shot with generated detail.

```text
song meaning + musical structure
              │
              ▼
story world: characters, places, objects, forces, relationships
              │
              ▼
video plan: acts → sequences → shots → transitions
              │
              ▼
checkpoint realization: subject anchors + action + camera + look
              │
              ▼
fast renderer: motion, lighting, texture, beat response, painterly variation
```

### The procedural film grammar

The system does not need to write a complete screenplay. It needs a small set
of reusable operations:

```text
establish(place)
introduce(subject)
follow(subject, destination)
approach(subject, object)
orbit(subject)
reveal(object)
confront(subject, force)
transform(subject, material)
fragment(world)
return(subject, place)
release(subject)
```

Each operation compiles to a shot specification:

```ts
interface ProceduralShot {
  operation: string;
  subjects: string[];
  location: string;
  action: string;
  camera: 'wide' | 'tracking' | 'orbit' | 'close' | 'overhead' | 'abstract';
  durationBars: number;
  transition: 'cut' | 'match' | 'dissolve' | 'morph' | 'hold';
  audioCue: 'section' | 'chorus' | 'drop' | 'lyric' | 'downbeat';
  continuity: number;
}
```

The shot plan is generated at section scale, but shot durations and transitions
can be quantized to bars, beats, or trusted lyric phrases. This gives the
visualizer cinematic structure without forcing every frame to be semantically
generated.

### Three memories are required

1. **World memory** — what entities and places exist, with visual anchors.
2. **Story memory** — what has happened and what remains unresolved.
3. **Film memory** — recent shots, camera language, color continuity, and
   reveal budget.

The current Motif Ledger is the beginning of world memory. Story memory should
eventually track state transitions such as `girl.is_running = true`,
`cathedral.is_collapsing = true`, or `scarf.is_lost = true`. Film memory keeps
the video from using the same establishing shot or hard cut every section.

### The key design principle: constrain generation, not imagination

The procedural layer should decide:

- who or what is present;
- where it is;
- what changed;
- which relationship is visible;
- how the shot begins and ends.

The diffusion layer should decide:

- exact anatomy and surface detail;
- atmospheric accidents;
- material variation;
- painterly composition inside the shot;
- moment-to-moment texture and light.

That division allows the output to feel authored and surprising at the same
time. A completely generated video has no continuity contract; a completely
procedural video has little visual richness. The target is a procedural film
plan with generative cinematography.

### Maturity path

```text
1. semantic subject anchor
2. subject + action at checkpoint
3. persistent motif ledger
4. section-level shot grammar
5. world/story/film memory
6. multi-shot continuity evaluation
7. learned director trained on successful visual receipts
```

## End-to-end optimization opportunities for `npm run app`

The real deployment is the Electron app plus the local Python sidecar and one
resident GPU model. The highest-value optimizations are boundary optimizations
across Electron, the browser renderer, the websocket, and the sidecar.

### 1. Measure the actual frame-age pipeline

The app renders the procedural scene for display, captures it again for the
sidecar, JPEG-encodes it, sends it over the websocket, and receives a painted
JPEG back. Measure this timeline explicitly:

```text
Electron audio → shader render → GPU readback → JPEG encode → websocket
→ sidecar decode → VAE → UNet → VAE → JPEG → Electron upload → display
```

The important metric is frame age at display, not sidecar FPS alone. Log
capture age, queue age, generation time, and display age.

### 2. Move capture work off the display loop

Run procedural camera capture in an `OffscreenCanvas`/worker path if the
Electron environment permits it. If readback still blocks, adapt camera
capture rate independently from display FPS. Test 448×256 as a camera-only
input while keeping the display at its current resolution; maintain fixed-shape
sidecar graphs per supported resolution.

### 3. Cache semantic work at section level

The sidecar already caches exact prompt embeddings. Add higher-level caching in
the Electron-side director for track meaning, motif anchors, section shot
plans, compiled prompts, and transitions between adjacent scenes. If only
intensity, bass, or treble changes, do not call the semantic engine or rebuild
the scene prompt.

### 4. Separate stable anchor, action, and look

Compile checkpoint inputs as:

```text
stable anchor: anime-styled girl / red scarf / field
section action: running toward the luminous horizon
look: oxide-teal filaments / collapsing cathedral light
```

The anchor persists for several checkpoints. The action changes on a section,
bar, or lyric boundary. The look blends or changes under the existing
checkpoint policy. This reduces semantic churn and makes continuity inspectable
in Electron logs.

### 5. Prepare before the downbeat, commit on the downbeat

The Electron director can infer and cache a likely next shot before a section
boundary, then commit it only when the scheduler reaches the trusted downbeat.
Predictions must be cancellable: wrong prefetch is discarded rather than
painted early. This hides semantic latency while preserving musical timing.

### 6. Turn existing telemetry into bounded control

Use capture time, stream FPS, `change`, `drift`, `jitter`, and checkpoint phase
as conservative controls:

- high capture time → reduce camera capture rate before reducing display FPS;
- high jitter → lower fresh noise and slow prompt/anchor transitions;
- low change in an energetic passage → increase reveal/paint rather than
  arbitrary noise;
- high drift → increase procedural grounding or schedule a continuity reseed;
- high semantic churn → hold the motif ledger and suppress a new scene.

Use target ranges and hysteresis so this remains a mechanical feedback loop,
not another unconstrained AI decision-maker.

### 7. Optimize for meaningful change per latency

For the Electron app, the useful metric is:

```text
meaningful visual change / (capture + queue + generation + display latency)
```

Track this with subject continuity, cue-to-change time, frame age, drift, and
jitter. A lower stream FPS can be an improvement if the image is fresher,
more coherent, and advances the song’s visual story.

### Recommended order

1. Instrument capture/readback/encode and frame age.
2. Add section-level semantic and anchor caches.
3. Separate stable identity, action, and look conditioning.
4. Add cancellable prefetch before section boundaries.
5. Close the loop around drift, jitter, change, and semantic churn.
6. Only then consider training a new adapter or adding another model.

The first five stages can be explored without training a new model. The
research challenge is not “can a model draw an anime girl?” It is whether a
viewer can recognize the same world, understand what changed, and feel that
the change belongs to the music after several minutes.
