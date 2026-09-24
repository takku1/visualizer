# Implementation status

This is the evidence boundary for the specimen: a concept is marked implemented only when it has a runtime seam and a test or measurable log output.

## Implemented in this pass

- Abstaining realization now explicitly asks the backend to avoid simple
  geometric primitives, flat monochrome fills, isolated icon-like objects,
  and abrupt replacement; it still preserves the evidence boundary rather
  than inventing a literal story.
- Non-monochrome palette families now carry distinct shadow, body, and
  highlight colors (including complementary/analogous accents) so a palette
  transition does not collapse into a single-color chapter. Procedural noise
  seeds glide with the look transition, and normal scene splices paint over
  two bars; explicit hard cuts remain immediate.
- The display compositor now preserves painted luminance and texture while
  borrowing a bounded amount of the persistent procedural palette. This keeps
  the diffusion layer from collapsing an entire song chapter into one hue
  without adding diffusion or VAE work to the frame path.

- Typed scene continuity contracts accompany the legacy scalar `continuity` field.
- Checkpoint timing receipts record source, confidence, requested beat, commit time, phase error, and timeout fallback.
- A deterministic shot-graph seam supports candidate shots, weighted transitions, and prefetch intent.
- Scenes carry persistent `WorldState`; checkpoints expose renderer-independent `SceneDiff` data for future stateful backends.
- Track boundaries explicitly reset the realization session; same-track
  director revisions remain continuous control-plane updates. Runtime
  telemetry reports `trackId`, `trackTransitions`, `reseedEnabled`, and
  `keyframesEnabled` so one-session-per-song behavior is directly auditable.
- `WorldState` transitions now have a pure `applySceneDiff` reducer; checkpoint commits calculate against the prior committed world and expose the committed world to callers.
- World diffs reconcile rolling ASR evidence IDs by stable entity kind/label before declaring replacement. This prevents a revised transcript window from turning the same bounded cue into an identity break; duplicate labels are matched deterministically and true unmatched additions/removals remain explicit.
- The app launcher isolates sidecar stdout/stderr into persistent log files and tolerates launcher pipe closure, so closing a terminal or losing a PTY cannot propagate `BrokenPipe` failure into the diffusion or meaning worker.
- Japanese grounding treats first/second-person pronouns as weak lyric evidence rather than persistent person entities, while recognizing kana forms such as `とり` and bounded calling actions when concrete cues are present.
- Persistent `ColorState` and `LightingState` now live with world visual identity and compile deterministically to the existing `Look`; knob blending updates both representations.
- `Shot` and `RealizationRequest` now separate presentation/backend compilation from authoritative world state; the current sidecar remains a legacy-compatible adapter.
- Continuous audio is now mapped into bounded renderer-neutral forces and transported separately from semantic content; ShotGraph nodes carry world/shot diffs instead of only prompt candidates.
- `WorldResonance` now travels with the rate-limited fast control path, not
  only checkpoint requests. The sidecar applies small bounded pressure to
  existing weather, camera, light, and entity-motion handles while preserving
  the audio control as the primary driver; missing resonance is a no-op.
- The current sidecar compiles structured `WorldState`/`Shot`/`SceneDiff` into a backend-specific request (`structured-world-v2`). In addition to the auditable prompt bridge, persistent perceptual intent is compiled into bounded energy/light/organic directions and applied through the existing UNet bottleneck network-bending path. This is real model conditioning, but it is not object-level identity/reference/depth conditioning; that stronger capability remains deferred.
- The structured prompt bridge now carries the complete transition intent:
  preserved entities, additions, removals, relation, action transition, and
  camera transition. The sidecar therefore no longer silently drops the
  `SceneDiff` dimensions it receives; object-level persistence is still not
  claimed until a reference/depth/correspondence backend is measured.
- ShotGraph candidate insertion now supports true alternate branches from the current shot (with an explicit `fromId` escape hatch for chained transitions), so prefetch and weighted selection operate on competing production candidates rather than accidentally forming a candidate chain.
- ShotGraph telemetry now includes recent staged, prefetched, and selected candidate IDs in addition to counts, making live production selection auditable from JSONL rather than inferred from aggregate counters.
- ShotGraph runtime telemetry now records whether selection was made, is waiting
  on a guard (section/confidence/downbeat), or had no edge, including the
  rejected-candidate reasons. This distinguishes an unused graph from a graph
  correctly deferring a transition.
- Abstaining realization now compiles perceptual constraints (form, behavior, space, material, motion, and tension) before legacy procedural vocabulary; geometry remains a continuous motion substrate rather than authoritative scene content.
- Default abstaining/emergent scenes now suppress legacy procedural symmetry folds, so the motion substrate cannot reintroduce kaleidoscopic content after the perceptual compiler requests a persistent asymmetric form. Explicit knob mode retains its structural-fold contract.
- `PerceptualIntent` and anonymous `EmergentWorldState` now exist as typed seams; a measured backend observer still needs to provide correspondence handles before emergent hypotheses can be populated from pixels.
- `RealizationTelemetry` now has an optional correspondence-observation channel and a pure adapter into `EmergentWorldState`; scalar identity/action confidence, prompt text, and raster drift still cannot create or preserve an emergent form.
- Shot graphs now support guarded runtime selection, prefetch candidates, and cancellation epochs; GPU pre-rendering remains measurement-gated.
- State/telemetry now records ShotGraph candidates staged, prefetch intent, selections, and pending state so production use is distinguishable from unit-test-only coverage.
- Timed lyric import/provider interfaces now exist; `npm run meaning:import -- --lrc song.lrc --track <id> --out meaning/<id>.json` creates an evidence-bearing manifest.
- The low-overhead lyric seam now carries album/duration from media-session and
  host track contexts, provides a cached LRCLIB development adapter with strict
  duration matching, and requires an explicit `allowUnknownRights` decision
  before community lyrics can become committed meaning. See
  [`docs/research/low-overhead-lyrics-and-meaning-sources.md`](research/low-overhead-lyrics-and-meaning-sources.md).
- The explicit LRCLIB harness path now persists exact-track results in a
  30-day browser/Electron cache; quota, private-mode, and expiry failures are
  treated as lookup misses and never touch the frame loop.
- Timed lyric import now performs bounded English/Japanese lexical grounding
  for recognized motifs/actions while preserving unknown lines as symbols;
  `--symbols-only` retains an explicitly conservative import mode. This is
  evidence grounding, not translation or unrestricted narrative inference.
- The TypeScript timed-lyrics path and live-ASR path now share the same bounded
  grounding vocabulary, so imported lyrics and first-listen evidence cannot
  silently disagree about whether a person, place, force, texture, or action
  is recognized. Unknown lines still remain symbols and keep the meaning
  abstained.
- The shared bounded grounding vocabulary/actions now live in one versioned JSON
  contract consumed by both live TypeScript grounding and the timed importer;
  language adapters remain the only supported extension point.
- Live and imported lyric evidence now resolve an effective bounded language per
  unambiguous text window, so mixed Japanese/English tracks do not inherit the
  wrong adapter while unsupported scripts still abstain.
- `npm run evaluate:logs -- <session.jsonl>` reports semantic source coverage, fingerprint changes, and timing fallback rate.
- The same text report now includes live language/configuration coverage, structured-conditioning build hashes, and stream health (zero-FPS windows split by connection state, disconnects, and dropped frames) so startup gaps are not confused with renderer or world-state failures.
- The same evaluator reports live ASR update/provisional/committed counts and structured-realization conditioning versions, making post-restart runtime validation reproducible.
- The evaluator also reports structural world-transition metrics; visual identity/action verification remains explicitly unverified.
- `npm run evaluate:logs -- <session.jsonl> --require-languages=en,ja` now
  provides an explicit live-language gate: each requested language needs
  observed evidence plus at least one grounded sample; missing coverage exits
  with status 2 and is reported as `unverified`, not as renderer failure.
- Log evaluation now separates semantic decisions from grounded semantic decisions; symbol/action-only promotions are reported as ungrounded instead of inflating evidence coverage.
- Opt-in frame capture plus `tools/evaluate-world.py` provides a CLIP-based identity/action measurement seam without adding work to the real-time loop. It reports pairwise image-embedding consistency and, when a manifest supplies reference images, reference-image similarity for identity groups; these are diagnostic evidence, not identity verification.
- The same offline evaluator now accepts `--optical-flow` and reports dense Farneback motion magnitude and directional coherence for labeled or sequence-grouped frames. This is an action/motion diagnostic only; it cannot separate camera motion from subject motion or verify an action label. The existing 22-frame abstract capture measured mean magnitude `3.40` and mean directional coherence `0.131`, so it has motion but no stable directional-action evidence.
- The evaluator also accepts unlabeled `sequenceGroup` manifests for honest temporal-only diagnostics; a real eight-frame capture measured mean adjacent image cosine `0.724` and minimum `0.512`, while correctly reporting zero identity/action evidence.
- The current 131-frame emergent fallback capture (`output/eval-live-emergent`) measured mean adjacent image cosine `0.941`, minimum `0.846`, mean Farneback flow magnitude `2.46`, and directional coherence `0.166`. This is a stronger continuity baseline, not identity/action verification.
- The next identity/action gate is a curated capture with an independently selected reference image, at least two human-annotated identity frames, and action labels only where visible; the current abstract line-field capture is intentionally not promoted to that status. Preflight now rejects missing per-group references, references that reuse captured-frame paths, and action coverage with fewer than two labeled frames in one identity group.
- `docs/evaluation/identity-action-protocol.md` and its example manifest make the offline capture/annotation contract reproducible; no existing benchmark is labeled as identity proof without annotations and independent references.
- Live ASR now enforces one in-flight audio window, preventing slow transcription from queueing behind itself.
- `npm run app` starts the local ASR worker by default; use `npm run app -- --no-meaning` only for performance isolation. Committed live hypotheses promote into `SongMeaning` without blocking procedural rendering.
- Multilingual ASR now supports `MEANING_ASR_LANGUAGE=ja` (or another Whisper language code), preserves detected language, and retains timestamp-bounded whole-window evidence when Whisper provides no chunk timestamps. Reproduce the contract check with `python tools/test-meaning-asr.py`.
- Rolling live ASR stabilization now tolerates conservative same-language, time-overlapping wording revisions instead of requiring exact repeated strings; telemetry reports provisional and committed hypothesis counts.
- Japanese live ASR now uses script-aware character-overlap matching for common inflectional revisions (for example, a stem plus a changed verb ending). Recognized Japanese entity/action cues may commit after two overlapping windows; unknown lyrics retain the normal three-window gate and cannot create world entities. This is a bounded evidence improvement, not a claim of full Japanese lyric transcription.
- Recognized provisional live actions and weather cues now compile into bounded perceptual pressure (behavior, material, motion, and lighting) without adding entities, changing identity, or triggering a checkpoint.
- `npm run app -- --meaning-language ja` can force Japanese Whisper decoding for a validation session; omitting it preserves automatic language detection.
- Automatic language detection now recovers Japanese from Hiragana/Katakana when Whisper returns `und`; live extraction covers a broader conservative Japanese vocabulary and action set without inventing unsupported narrative.
- Whisper ASR requests its explicit decoder language metadata in addition to
  script-based recovery, preventing noisy sung text from being treated as the
  language decision; the semantic evidence gate remains unchanged.
- Committed live audio now remains abstained unless the bounded extractor
  grounds at least one motif (for example a person/object/place/force) rather
  than only recognizing that speech or an action was present. Action-only and
  symbol-only evidence can still drive provisional perceptual pressure, but it
  cannot be mislabeled as a literal semantic world.
- Whisper pipeline failures now produce an empty live update and keep the optional ASR worker alive; they no longer tear down the WebSocket or the renderer's semantic connection.
- ASR now rejects configurable low-RMS windows (`MEANING_MIN_RMS`, default `0.003`) before Whisper inference, preventing silence hallucinations from becoming repeated semantic evidence.
- Loopback status now distinguishes an active permission stream from actual PCM signal; a zero-RMS capture reports `capture silent (re-share with audio)` and live ASR telemetry records the same input evidence.
- Loopback analysis now terminates in a zero-gain destination sink, keeping Chromium/Electron's Web Audio graph active without echoing captured system audio; this addresses the observed active-track/zero-RMS failure mode.
- Automatic Electron startup now defers the display-capture request until the first user gesture when no activation exists; the visualizer still starts immediately, but Chromium's transient-activation requirement is respected for loopback audio.
- The diffusion control hot path reuses CPU staging buffers instead of allocating tensors per frame. The default 448×256 profile now measures 68.2 ms median / 69.5 ms p90 (~14.7 FPS), with peak VRAM 2435 MB of 6144 MB. The 576×320 quality profile measures 88.2 ms median / 89.9 ms p90 (~11.3 FPS), with peak VRAM 2476 MB. Reproduce with the live app stopped; in PowerShell use `$env:STREAM_WIDTH='448'; $env:STREAM_HEIGHT='256'; npm run stream:bench -- --bench-json output/stream-bench/448x256.json`. Concurrent sidecars contaminate the GPU measurement. The older 62.4 ms figure came from a different benchmark/runtime state and is not treated as the current baseline.
- The offline identity/action protocol now accepts explicit human direction/axis annotations and reports coarse optical-flow agreement per adjacent pair. This strengthens action evidence without pretending dense flow is a subject/action classifier; identity/action verification remains intentionally false until annotated correspondence is reviewed.
- Electron RAF suspension is now observable and recoverable: a low-rate
  watchdog advances the same frame path when the window is backgrounded, while
  visible sessions retain RAF cadence. A fresh forced-Japanese run sustained
  structured sidecar output at roughly 11–14 FPS and reported one committed
  symbol-only hypothesis; semantic grounding correctly remained zero.
- A complementary auto-language run on two further tracks kept the same
  continuous/structured realization invariant, but produced only one
  provisional ASR update per track and no commits. This is insufficient
  evidence for English semantic quality, not a false positive; a longer
  foreground vocal capture remains required.
- An isolated cuDNN-autotune experiment measured 85.0 ms median / 86.4 ms p90, but raised peak VRAM to 4080 MB and retains batch-shape autotuning stalls. It is rejected for the 6 GB live target; the default remains `cudnn.benchmark=False`.

## Still deliberately deferred

- The safe backlog pass is complete through the current SD-Turbo adapter:
  typed log envelopes, stale-frame rejection before JPEG decode, stage-level
  benchmark timing, metrical octave hysteresis, and default cached lyric
  discovery are implemented and tested. These improve observability and
  responsiveness but do not claim object-level visual identity.

- System 0 structure memory now consumes existing beat/onset/chroma/timbre-
  proxy features and emits bounded novelty, repetition, and segment evidence.
  It conservatively replaces the synthetic 24-second fallback clock: only a
  non-silent boundary event above the promotion threshold advances the local
  section index. It does not emit semantic labels or literal content. The
  remaining gate is replay/live comparison against annotated boundaries before
  adding richer boundary types or section recall. See
  [`docs/research/system0-design-sketch.md`](research/system0-design-sketch.md)
  and the cited MIR literature there.
- A causal beat-tracking slice now consumes fixed-rate AudioWorklet onset
  batches and phase-locks an inferred grid on the CPU. It is used only when
  the tracker reports confidence; the legacy analyser/onset clock remains the
  host fallback. This follows the causal beat-tracking lineage cited by
  `src/rhythm/beat-tracker.ts`, but live accuracy and audio-thread cost still
  require measurement on representative tracks.
- Local key estimation now accumulates several seconds of chroma evidence and
  reports winner-versus-runner-up margin rather than an inflated absolute
  profile fit. External track-analysis keys remain authoritative when present.

- Licensed lyrics providers and CLAP-style semantic embeddings remain deferred; local ASR and timed imports are available, but neither is a universal catalog solution.
- Reference-image conditioning inside the real-time sidecar and a ground-truth visual identity/action evaluator remain deferred. The offline evaluator now supports optional reference-image diagnostics, adjacent temporal consistency, and explicit capture preflight; it cannot claim true object memory from CLIP scores alone.
- TensorRT, batched inference, FiLM adapters, masked-token canvas updates, and distributed workers: these require a measured model/runtime decision rather than a safe local patch.

The evaluator's `identityVerified` and `actionVerified` fields remain false
until an actual visual evaluator is connected; every offline report now emits
those fields explicitly with `evaluationMode: diagnostic`.

## Research basis

The reducer and persistent-entity direction is documented in
[`docs/research/persistent-world-realization-research.md`](research/persistent-world-realization-research.md).
The academic evidence supports explicit object-centric state and temporal
correspondence/memory, but does not imply that the current prompt-driven
SD-Turbo backend provides true object permanence.
