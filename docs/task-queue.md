# Ordered task queue

This is the execution queue for the current audiovisual world-engine pass.
Tasks move forward only when their acceptance gate is measured. Research-only
ideas stay below the runtime work and must not destabilize the working SD-Turbo
path.

## 1. Representative live validation

Run the current app on four reproducible fixtures:

- English vocal track
- Japanese or other non-English vocal track
- instrumental track
- tempo-changing or structurally irregular track

Record the session JSONL and evaluate:

```powershell
npm run evaluate:logs -- <session.jsonl> --json
```

Acceptance gate:

- one continuous realization session per track;
- no connected zero-FPS windows;
- no ASR/meaning WebSocket crash;
- capture and generation percentiles recorded;
- semantic grounding reported separately from abstention.

## 2. Multilingual grounding coverage

Run the lexical baseline and held-out fixture:

```powershell
npm run evaluate:grounding
npm run evaluate:grounding:heldout
```

Then add grapheme-aware repeated-window measurements and language-stratified
risk/coverage reporting. The current embedding evaluator remains offline and
proposal-only. Do not allow embedding-only cues to create literal entities or
actions.

Acceptance gate:

- unsupported and metaphorical examples remain abstentions;
- no false literal promotions;
- coverage and precision are reported per language;
- only then decide whether an embedding proposal flag is justified.

## 3. Visual continuity benchmark

Capture a deterministic sequence covering:

- stable passage;
- onset/beat response;
- valid gradual retarget;
- director timeout or abstention;
- track boundary.

Use `tools/evaluate-world.py` and the existing sequence manifest protocol to
measure adjacent image cosine, discontinuity spikes, optical-flow magnitude,
and directional coherence. Keep identity/action claims unverified unless the
capture has independent references and human annotations.

Acceptance gate:

- no retarget spike comparable to the old hard splice;
- stable passages remain within the measured continuity baseline;
- failed director work preserves the last valid state;
- the report distinguishes temporal consistency from identity proof.

## 4. System 0 and rhythm replay validation

Replay annotated or hand-labeled tracks through the fixed-rate onset path and
System 0. Measure beat phase error, tempo stability, octave errors, and section
boundary precision/recall. Include the previously reported key-estimation case
where Thunderstruck was estimated as F# instead of the expected E.

Acceptance gate:

- no brief tempo relabel can move the world clock;
- low-confidence rhythm falls back to onset-driven motion;
- section boundaries are evidence-backed rather than timer-driven;
- key confidence is calibrated and ambiguous estimates are not over-promoted.

## 5. Performance optimization

Only after the preceding measurements, benchmark one change at a time on the
RTX A3000 target:

1. capture worker/encoding path for remaining >100 ms spikes;
2. TensorRT with and without Bender;
3. stream-batch denoising;
4. buffer/tensor reuse and synchronization audit.

Keep the same model, resolution, steps, fixture, and duration for every A/B.
Track median/p95 generation, display/stream FPS, dropped frames, VRAM, and
VAE/text-encoder call counts. Reject changes that regress continuity or exceed
the 6 GB target.

## 6. Fallback reduction

Use the live validation data to address legitimate abstentions in this order:

1. cached lyrics and local tags/LRC;
2. provider duration matching and evidence provenance;
3. bounded language adapters;
4. track-level perceptual meaning for untimed lyrics;
5. only then optional multilingual proposal ranking.

Never replace an evidence failure with a literal story. Abstract/perceptual
fallback remains the correct result when meaning is unsupported.

## 7. Research realization upgrades

These remain behind the measured current backend:

- reference/depth/correspondence conditioning for object permanence;
- persistent latent or video realization backend;
- FiLM/audio adapter prototype;
- masked-token or learned persistent canvas experiments.

Each must begin with a research note, a reproducible offline benchmark, and a
pluggable backend seam. None belongs in the default `npm run app` path until it
matches or exceeds the current latency and continuity baseline.

## Completed foundations

- persistent WorldState, SceneDiff, ContinuityContract, and checkpoint receipts;
- continuous-per-song realization sessions;
- bounded audio resonance and structured conditioning;
- fixed-rate onset/beat tracking slice;
- capture-stage telemetry and JPEG pressure reduction;
- lyric cache/LRCLIB/local import paths;
- multilingual lexical fixture and held-out evaluation;
- conservative embedding proposal evaluator;
- 106 TypeScript tests, typecheck, and production build.

## Queue rule

Do not skip an acceptance gate because a later technology is more exciting.
If a task exposes a regression, repair that task before advancing the queue.
