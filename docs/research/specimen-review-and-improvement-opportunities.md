# Specimen review: what the distilled paper reveals

The `.specimen/` preprint was useful because it forced the project to describe
it without relying on implementation names. The distilled idea is not merely a
two-timescale visualizer. It is a **versioned audiovisual world engine** with
three conceptual planes:

```text
perception  →  direction  →  realization
audio/rhythm    meaning/shot    procedural + diffusion
```

The clocks cross those planes:

```text
fast:   feature frame → physics → procedural motion → paint
slow:   section       → scene/shot → checkpoint realization
offline: receipts     → continuity/effectiveness evaluation
```

This framing is more useful than calling everything System 1/System 2. The
current names are inherited from the project history and risk confusing the
director (slow judgment) with the diffusion fast loop.

## Improvements revealed by the abstraction

### 1. Promote `Scene` from prose to a typed contract

Current shape:

```text
Scene = prompt + seed + continuity + look
```

Better conceptual shape:

```text
Scene = world identity + action/relation + environment + camera + look
        + transition + evidence + continuity contract
```

The prompt should be a compiled artifact. This would let the scheduler compare
meaningful scene differences instead of comparing strings.

### 2. Add a scene fingerprint

The current checkpoint scheduler compares prompts. Introduce separate stable
hashes for:

```text
identityHash | actionHash | environmentHash | lookHash | cameraHash
```

Then select the least expensive valid transition:

| Change | Candidate realization |
| --- | --- |
| physics only | fast loop |
| look only | procedural glide / prompt blend |
| action only | checkpoint or regional reveal |
| environment | keyframe checkpoint |
| identity | anchor refresh or hard cut |

### 3. Make semantic state versioned

The current track concept path returns a thin list of words. A general system
needs a `MeaningManifest` with a revision, evidence, confidence, motifs,
relations, and section ownership. The manifest should be immutable once
published; a new interpretation becomes a new revision.

This makes local playback, a remote semantic service, and a future human
storyboard interchangeable producers of the same contract.

The first implementation now exists as a local-only manifest seam under
`meaning/`: the sidecar loads a versioned `SongMeaning` by track identity and
returns explicit abstention when no manifest is present. This is an interface
implementation, not evidence that lyric extraction or narrative quality has
been solved.

### 4. Separate the three kinds of continuity

The paper made it clear that “continuity” is overloaded. Track separately:

- **identity continuity:** is this the same girl/ship/cathedral?
- **world continuity:** is this the same field/light-world/material system?
- **narrative continuity:** did the last action cause the next action?

A scene may intentionally break one while preserving the others. A chorus can
break world lighting while preserving identity and narrative direction.

### 5. Add an explicit creative-prior lane

“Anime music” may justify an anime visual prior, but it is not evidence that an
anime girl is in the song. The architecture should distinguish:

```text
evidence-backed content: lyric/metadata/art/audio-language support
creative prior: user/model-selected style or subject hypothesis
renderer response: what the checkpoint actually realized
```

This permits imaginative results without falsely claiming semantic understanding.

### 6. Treat the shot graph as the unit of planning

The current unit is a scene prompt. The eventual unit should be a shot node
with duration, action, camera, transition, audio cue, continuity contract, and
fallback. A graph supports prefetch, cancellation, and alternate paths when
analysis confidence or playback timing changes.

### 7. Make the offline evaluator part of the architecture

The current project has strong renderer telemetry but no semantic evaluator.
The specimen suggests an offline checker that compares adjacent checkpoints
for identity survival, relation/action realization, novelty, drift, and timing.
It should not be a resident director or a second always-on GPU model.

### 8. Improve the evidence boundary in the project itself

The specimen found three evidence classes that should remain separate in the
repository:

1. executed checks (`npm run typecheck`, smoke tests);
2. measured renderer behavior (benchmark and telemetry logs);
3. design assertions and future proposals.

The test attempt also exposed an operational issue: `npm.cmd test` reached the
runner but esbuild failed to resolve the stream test entrypoint due an access
denied path. That environment failure should become a tracked validation
receipt, not disappear behind a general “tests exist” statement.

## Revised conceptual architecture

```text
                    MeaningManifest revision
                              │
audio/perception ──► semantic direction ──► shot graph
      │                         │                │
      └──────────────► fast physics              │
                                │                │
                                ▼                ▼
                         realization contract + receipt
                                │
                 procedural structure + diffusion paint
                                │
                         display / distributed worker
```

The semantic director should not directly own pixels. The realization contract
should be the seam between creative direction and rendering. That is the most
important architectural improvement surfaced by the specimen process.

## Highest-value next research artifacts

1. A `MeaningManifest` schema with evidence and revision semantics.
2. A scene-fingerprint and transition-cost design.
3. A shot-graph grammar with a worked anime-song example.
4. A continuity receipt and offline evaluation protocol.
5. A clean test/benchmark receipt that separates environment failure from
   implementation failure.

The preprint itself is at `.specimen/paper/main.pdf`; its Evaluation Status
section is deliberately conservative and should remain the project’s claim
boundary until the proposed semantic comparison is actually run.
