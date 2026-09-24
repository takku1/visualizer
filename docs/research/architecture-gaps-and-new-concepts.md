# Architecture gaps and new concepts

This is a documentation-only audit of the current Electron/browser + local
Python sidecar design. It identifies concepts that are missing before the
project grows into a procedural music-video system.

## What the current code already does well

The code has a clear two-timescale split:

```text
FeatureBus → ControlMapper → ProceduralScene → capture → sidecar
          └→ Director → sceneFromPlan → CheckpointScheduler → sidecar
```

The fast path is measurable and bounded. The slow path has an explicit seam
(`DecisionEngine`), a local fallback, calibrated distributions, deterministic
scene seeds, downbeat-aware checkpointing, and JSONL receipts. The sidecar is
latest-wins for live frames and uses fixed-shape CUDA graphs.

Those are strong foundations. The gaps are mostly in the meaning and protocol
layers between them.

## Code-grounded gaps

### Implemented since this audit

- A versioned local `SongMeaning` manifest seam exists in the sidecar.
- `MotifLedger` now preserves stable anchors across semantic decisions.
- `Scene` carries a typed identity/action/environment/look/camera fingerprint,
  and the scheduler compares that fingerprint instead of prompt wording.
- `_state` receipts include the semantic revision, shot, and fingerprint.

The remaining gaps below are intentionally still proposals unless marked
implemented.

### 1. `Scene` was prompt-shaped; now partially closed

`src/stream/scenes.ts` now compiles optional `SongMeaning` into a typed shot and
keeps the renderer prompt as an artifact. The local metadata fallback still
uses `concepts`, so that path remains intentionally shallow. The runtime now
retains:

- source and confidence;
- timestamps or section ownership;
- entity identity;
- relations and actions;
- what must persist versus what may change.

This permits “the same girl runs through the field toward the horizon” when a
manifest supplies that evidence; automatic lyric extraction remains absent.

### 2. Checkpoint change detection is now fingerprinted

`CheckpointScheduler.setScene` now compares the typed scene fingerprint rather
than `current.prompt !== scene.prompt`.
That misses meaningful changes where the prompt is unchanged but the look,
anchor set, action, seed policy, or semantic revision changed. Conversely, a
minor wording change can cause a full semantic splice.

The implemented concept is a typed **scene fingerprint** with separate hashes for:

```text
world identity | action/relation | environment | look | camera | seed policy
```

The scheduler can then choose a cheap glide, a procedural-only transition, a
keyframe splice, or a hard cut based on which component changed.

### 3. Stream messages still have no semantic epoch

Controls have a sequence number, but checkpoint, blend, track-concept, and
frame messages do not share a session/scene epoch. After reconnect or delayed
delivery, a stale checkpoint could be accepted without a protocol-level proof
that it belongs to the current track and current semantic plan.

Add a monotonically increasing session epoch and plan revision to every
semantic message. A worker should reject stale revisions and report the
rejection in telemetry.

### 4. Telemetry sees the renderer, not the full causal chain

The current telemetry records useful `change`, `drift`, `jitter`, FPS, and
capture time. It does not identify whether a bad result came from:

- wrong semantic inference;
- wrong scene compilation;
- a missed beat or late checkpoint;
- stale websocket state;
- capture/readback delay;
- VAE/UNet generation;
- display upload delay;
- subject identity loss.

Add stage IDs and causal timestamps to decisions, checkpoints, frames, and
semantic receipts. This turns “the picture looked wrong” into a diagnosable
failure class.

### 5. The current concept request is track-level and thin

The stream asks for title-derived concepts once per track/model. That is a
useful bootstrap, but it is not song understanding. It cannot represent lyric
phrases, section actions, or uncertainty. The next seam should be a versioned
`MeaningManifest`, not a `words: string[]` response.

## New architectural concepts

### A. Semantic Blackboard

Create one versioned, append-only semantic state for a session:

```ts
interface MeaningManifest {
  sessionEpoch: number;
  revision: number;
  trackId: string;
  thesis: string | null;
  motifs: Motif[];
  relations: Relation[];
  sections: SectionMeaning[];
  evidence: Evidence[];
}
```

Every director, renderer, evaluator, and future distributed worker reads the
same manifest revision. They do not pass around ad hoc prompt fragments.

### B. Visual Continuity Contract

Each shot should state what must survive the transition:

```ts
interface ContinuityContract {
  preserve: ('subject' | 'outfit' | 'place' | 'palette' | 'cameraAxis' | 'relation')[];
  mayChange: ('lighting' | 'weather' | 'material' | 'scale' | 'camera')[];
  breakOn: ('chorus' | 'drop' | 'bridge' | 'lyric' | 'hardCut')[];
  tolerance: number;
}
```

This is more useful than a single numeric continuity value. A shot can
preserve the girl and field while allowing the cathedral lighting to transform.
It gives the renderer permission to be surprising without losing the story.

### C. Scene-diff compiler

Instead of compiling each scene from scratch, compile the difference between
the current scene and the next one:

```text
keep: girl, red scarf, field
add: luminous cathedral horizon
change: running → entering
camera: wide follow → low tracking
remove: dawn haze
```

The diff can select the cheapest valid rendering mechanism. An action-only
change may use prompt/knob blending. A subject change may require a keyframe.
An identity break may require a hard cut.

### D. Shot graph, not timeline of prompts

The future director should emit a graph with alternatives and guards:

```text
verse.follow
  ├─ if chorus arrives → chorus.approach
  ├─ if confidence low → verse.hold
  └─ if drop detected → chorus.fracture
```

This lets the system adapt to actual playback without rewriting the entire
video plan. It also makes prefetch possible: likely next shots can be prepared
while the current shot is still rendering.

### E. Semantic resonance channels

Audio should not directly invent content, but it can modulate semantic
components that already exist:

```text
bass → ground/weight/impact of the active action
treble → glints, particles, hair/fabric detail
harmonic change → palette/light-world relation
silence → hold, distance, or reveal delay
flux/drop → transition permission
```

This is more expressive than mapping audio only to sampler physics, while still
respecting the rule that audio does not create a new character every frame.

### F. Uncertainty budget

Every inferred element should spend a bounded uncertainty budget:

```text
lyric-supported subject       low uncertainty
artwork-supported color       low/medium uncertainty
genre-inferred anime style    medium uncertainty
audio-only cathedral          high uncertainty
```

When the budget is exhausted, the director should fall back to abstraction,
hold the last known motif, or ask for a creative prior explicitly. This avoids
turning weak evidence into false narrative certainty.

### G. Continuity judge as an offline/slow evaluator

Do not add another always-on model to the 6 GB local path. Instead, evaluate
checkpoint pairs asynchronously or in a separate validation run for:

- subject similarity;
- environment similarity;
- action/relationship change;
- unwanted identity swaps;
- visual novelty.

This is a checker, not a second director. Its job is to improve the receipts
and eventually train or tune the director from successful transitions.

### H. Render receipt as a first-class artifact

Every checkpoint should be replayable from:

```text
track hash
audio-clock window
meaning revision
scene fingerprint
continuity contract
renderer profile
seed
prompt/embedding hashes
model versions
telemetry timestamps
```

This supports A/B experiments, distributed retries, and user-visible
diagnostics. It also makes the project’s “does System One understand anything
semantic?” question empirically testable.

## Research connections

The proposed concepts align with several primary research directions:

- [ControlNet](https://arxiv.org/abs/2302.05543) supports the idea that
  spatial structure should be supplied as a separate control channel rather
  than hidden in prose.
- [AnimateDiff](https://arxiv.org/abs/2307.04725) separates reusable motion
  priors from personalized visual appearance, matching the proposed split
  between audio/procedural motion and semantic identity.
- [Make-A-Story](https://arxiv.org/abs/2211.13319) treats actor/background
  continuity as a visual-memory problem, not merely a prompt-writing problem.
- [StoryDiffusion](https://arxiv.org/abs/2405.01434) uses consistent attention
  and semantic motion prediction for long-range story image/video generation,
  supporting persistent identity plus transition-aware motion.
- [CogVideoX](https://arxiv.org/abs/2408.06072) highlights the importance of
  filtering for motion connectivity and dense temporal descriptions, which
  supports evaluating transitions rather than isolated frames.

## Recommended conceptual order

1. `MeaningManifest` and evidence/provenance.
2. Scene fingerprint and scene-diff compiler.
3. Session epoch and semantic plan revision in the stream protocol.
4. Continuity Contract and Motif Ledger.
5. Shot graph with prefetch/cancellation.
6. Semantic resonance channels.
7. Render receipts and an offline continuity judge.

The central architectural insight is that the project is no longer only an
audio-to-image mapper. It is becoming a **versioned audiovisual world engine**:
audio supplies time and pressure, the semantic blackboard supplies meaning,
the shot graph supplies narrative structure, and the renderer supplies
appearance and motion.
