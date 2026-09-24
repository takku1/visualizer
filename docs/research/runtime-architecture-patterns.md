# Runtime architecture patterns from session evidence

Status: measured design guidance, 2026-09-24.

This note records patterns observed in the renderer logs and reconciles them
with the persistent-world research. It is intentionally evidence-bound: a
director decision is not counted as a rendered scene, and a structured request
is not counted as visual identity verification.

## The system already has two different clocks

The Japanese validation session
`logs/session-2026-09-24T15-11-35-404Z-a0b1f90c.jsonl` produced:

- 26 director decisions;
- 2 checkpoint receipts;
- 109 structured realization telemetry samples;
- 7 live ASR updates and 12 hypotheses;
- 0 committed semantic hypotheses;
- 0 identity/action verification claims.

This is the desired broad shape. The director may revise perceptual intent or
fallback treatment frequently, while the realization state remains continuous
and only commits larger changes at checkpoint boundaries. A director log line
such as `abstract-fallback` is therefore not evidence that a new image was
generated.

## Pattern: control plane and realization plane must be explicit

The logs also exposed a failure mode: after the sidecar disconnected,
`streamFps` became `0`, but the last `genMs` and checkpoint metadata remained
visible. The browser was still able to render its procedural path, but the
telemetry could be read as if diffusion were still producing frames.

The rule is now:

```text
director / world decisions  -> control plane
sidecar frames / gen metrics -> realization plane
procedural display fallback  -> presentation plane
```

When the realization plane disconnects, its metadata must be cleared. A
presentation fallback may continue, but it must not masquerade as continuous
diffusion.

## Pattern: one song, one realization session, bounded commits

The intended invariant is:

```text
track session
  -> one persistent realization session
  -> continuous audio forces
  -> semantic/perceptual intent revisions
  -> checkpoint commits only for justified larger transitions
```

This does not mean the director can never change its intent. It means those
changes are staged through `ShotGraph` and `CheckpointScheduler`, then applied
as a `SceneDiff`; they do not automatically reset the latent/raster state.
Reseeding remains an explicit drift remedy, not the default meaning of a new
director sentence.

The log evaluator now reports this invariant directly. In the English/auto
session `session-2026-09-24T15-26-08-622Z-1e621a2f.jsonl`, it found three track
sessions, two track transitions, and one realization checkpoint for each
track, despite thirteen director decisions. This is evidence that the
director is operating as a control plane rather than creating one independent
image per decision. It does not establish visual identity or action
correctness; those still require captured, annotated frames.

## Pattern: ASR evidence has three separate states

The Japanese session demonstrates why these states must remain visible:

1. configured language (`ja` when forced);
2. received/provisional hypotheses (`7` updates, `12` hypotheses);
3. committed semantic evidence (`0` in this session).

Only the third state may promote into `SongMeaning`. A language label or a
single transcript window is not enough to author a world. The next runtime
telemetry revision records configured language independently from detected
hypothesis language so an empty or noisy window cannot be mistaken for a
language failure.

## Architectural implications

- Keep `Director`, `WorldState`, `ShotGraph`, `CheckpointScheduler`, and the
  realization backend as separate clocks and ownership boundaries.
- Treat `Scene` and prompt text as compiled artifacts, not authoritative state.
- Make connection/session lifecycle a first-class realization state rather than
  leaving stale sidecar metadata in the browser.
- Evaluate semantic promotion and visual realization separately. The current
  run proves structured conditioning and Japanese ASR transport, but does not
  prove grounded identity/action realization.
- Do not optimize the GPU path from director log volume. Optimize only from
  frame/latency/VRAM measurements on an isolated sidecar.

The academic basis remains the persistent-world and emergent-intent notes:
object-centric temporal memory requires correspondence and state, while
prompt text alone does not provide object permanence.
