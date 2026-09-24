# Design sketch: System 0, the structure-memory layer

Researched 2026-09-24. Status: **minimal causal boundary promotion implemented;
richer structure remains proposed.** `src/structure/memory.ts` observes the
existing feature vector and `FeatureBus` promotes only sufficiently confident,
non-silent boundary events. The richer prototype/lag-path design below remains
research and is not claimed by the runtime.

Each design choice points to a finding in
[`system0-music-structure-memory.md`](system0-music-structure-memory.md),
written as **[R§n]** for that document's section n. Text is labelled so that
facts and proposals stay separate:

- **Fact (repo):** read from the code on 2026-09-24.
- **Fact (lit):** cited in the review.
- **Proposal:** a design decision for this repo, not yet tested.
- **Estimate:** arithmetic, not a measurement.

## 1. Goal and non-goals

**Goal (proposal).** Replace the synthetic 24 s section timer with real,
confidence-scored structure events. Give each section a stable `segmentId`,
so the director can *recall* a look when a section repeats. Add bar-pattern
motif, fill, and drop cues. Do all of this on the renderer CPU at beat rate,
with zero GPU work.

**Non-goals:**

- Semantic labels ("verse", "chorus") as authoritative output. [R§1]
  shows unsupervised chorus labelling is weak (CHR.5F 0.171), so labels
  stay hints.
- Learned models in the runtime path [R§7].
- Cross-track memory (a director/semantic concern, per ADR-016).
- Frame-accurate boundaries. The offline ceiling is F3-class [R§1, R§8].

## 2. Where it lives and how data flows

**Proposal:** a new module `src/structure/`, with one public class
`StructureMemory` and pure helpers. It follows the rhythm module's "small and
deep" interface convention (`docs/rhythm-model.md`).

```text
LoopbackSource.sample()  ─┐  (60 Hz)  raw log spectrum, chroma (improved), onsets
AnalysisSource.sample()  ─┤           Spotify beats/sections when available
RhythmAnalyzer.update()  ─┘           beat/bar phase, onset events, confidence
            │
            ▼
FeatureBus.update(now)
  ├─ StructureMemory.observeFrame(frame, rhythm)      every frame: accumulate tick bucket
  ├─ on tick boundary → StructureMemory.commitTick()   ≈ 2–4 Hz: SSM row, novelty, lag,
  │                                                    prototypes, bar hash, fusion
  └─ writes frame.onSection / sectionIndex (replaces #synthesize's 24 s timer)
     + frame.structure: StructureSnapshot
            │
            ▼
core.ts builds TrackContext.structure ──► Director.tick() / buildRequest()
                                     └─► onPlan → SegmentLookMemory (recall) → sceneFromPlan
```

**Fact (repo):**

- `FeatureBus.update` already runs every frame, and owns `#synthesize` and
  `resetTrackStats()`.
- `Director.tick` fires on `f.onSection`, on `maxIntervalMs` (default 30 s),
  or on a meaning change, never sooner than `minIntervalMs` (6 s).
- `core.ts` builds scenes in `onPlan` through `sceneFromPlan(plan, ctx,
  this.#sceneIndex++, …)`.

**Proposal:** System 0 runs on the main thread. The per-tick work is
microseconds (§8). A Worker's `postMessage` overhead would exceed the compute.

## 3. The tick clock

A *tick* is System 0's time step.

- **Trusted grid** (`frame.hasStructure`, or `rhythmConfidence > 0.5` for
  ≥ 4 s): one tick per beat, beat-synchronous. Fact (lit): beat-synchronous
  features improve boundary precision [R§1, R§3]. Fact (repo): the same
  0.5 gate already guards beat pushes in `control.ts`.
- **Untrusted grid:** fixed 0.5 s ticks. Fact (repo): the fallback grid
  wandered 103–149 BPM (ADR-010). Fact (lit): wandering tempo bends
  repetition diagonals, which is why multi-slope path enhancement exists
  [R§3].
- **Switching** between the two modes closes the current segment's
  statistics but keeps the ring. Each tick stores its wall time, and all
  outputs carry seconds as well as tick indices.

## 4. Per-tick feature vector (D = 32)

| Block | Dims | Source | Normalisation | Why |
| --- | --- | --- | --- | --- |
| Chroma | 12 | New second `AnalyserNode` with `fftSize = 16384`, read every 4th frame (~15 Hz), folded 110 Hz–5 kHz; beat-mean | log(1 + 10·x), then L2 | The current 2048-pt fold under-resolves low pitches [R repo facts]; the fftSize range allows it [R repo facts, MDN]; Goto's chroma supports chorus repetition [R§1] |
| Timbre | 13 | 24 log-mel bands from the existing raw 1024-bin magnitude (`#raw`, pre-`AutoGain`), DCT coefficients 1–13; beat-mean | Per-track online z-score (Welford, like `RunningStats`) | 13 beat-synced MFCCs is McFee & Ellis's local-timbre recipe [R§1, R§3]; `AutoGain` outputs are non-stationary [R repo facts] |
| Dynamics | 4 | log mean raw level (≈ MFCC c0), spectral flatness, centroid, raw positive flux; beat-mean | z-score | Energy contrast carries EDM and build/drop sections, where chroma is flat [R§4] |
| Onset lanes | 3 | Counts of `accent`, `bass-onset`, `treble-onset` events from `RhythmAnalyzer` in the tick | z-score | Cheap rhythm-density channel; bar patterns are handled separately (§6.4) |

**Proposal: similarity** between ticks i and j is block-weighted cosine:
0.5·chroma + 0.35·timbre + 0.15·(dynamics ⊕ onsets).

- The embedding is implicit. Diagonal smoothing (§6.2) plays the role of
  time-delay embedding [R§1].
- Transposition invariance is applied at *segment-prototype* level (12
  chroma shifts × ≤ 20 prototypes). It is not applied per SSM cell [R§3],
  which keeps the per-tick cost at 1×.
- **Estimate:** per-frame accumulation plus log-mel/DCT is ≈ 1.5 k ops. The
  large analyser read plus fold is ≈ 16 k ops at 15 Hz.

## 5. Buffers

| Buffer | Size | Memory (float32) | Estimate at 120 BPM |
| --- | --- | --- | --- |
| Tick ring (features + wall time) | N = 512 × 33 | 66 KB | 256 s, a typical pop track |
| Lag accumulator R(ℓ) | 512 | 2 KB | — |
| Local SSM block for Foote | (2L)² = 16² | 1 KB | — |
| Segment prototypes | ≤ 32 × (32 mean + 32 var + stats) | < 10 KB | — |
| Bar-hash dictionary | ≤ 256 × 48-bit | < 4 KB | — |
| Per-track cache (persisted) | 512 × 32 × int8 | 16 KB per track | localStorage, 30-day TTL, like the LRCLIB cache |

When the ring wraps, the oldest ticks are dropped but their segment
prototypes remain. Recall of early sections therefore survives long tracks.

## 6. Algorithms

### 6.1 Boundary candidate: semi-causal Foote novelty

**Proposal.**

- Checkerboard kernel, half-width **L = 8 ticks**, Gaussian taper
  (σ = L/2).
- Evaluated each tick at tick t − L over the local 16×16 block.
- Peaks are picked against an adaptive threshold: mean + 1.5·std of the last
  64 novelty values.
- Output: a candidate at t − L, with `lateByTicks = L`.

**Justification.** Fact (lit): the kernel needs n−L…n+L, and larger L trades
resolution for smoothness [R§1, R§2]. Estimate: L = 8 is 4.0 s late at
120 BPM [R§2 table]. That is still inside the director's 6 s minimum cadence,
and is applied at the next downbeat (§7).

### 6.2 Repetition: causal lag-path accumulator (primary memory)

**Proposal.** For every lag ℓ ∈ [8, N−1], update a diagonal smoother:

```text
R_t(ℓ) = λ·R_{t−1}(ℓ) + (1−λ)·max(s(t, t−ℓ−1), s(t, t−ℓ), s(t, t−ℓ+1)),   λ = 1 − 1/8
```

- A **repeat** is active when max_ℓ R_t(ℓ) exceeds both an absolute floor
  (0.6) and mean_ℓ R + 2.5·std_ℓ R, for ≥ 4 consecutive ticks.
- The matched past tick t − ℓ* names the segment being repeated.
- A **repeat-start** event (path begins) and a **repeat-end** event (path
  breaks for ≥ 2 ticks) are boundary evidence.

**Justification.**

- Fact (lit): Goto's time-lag similarity is defined only into the past, and
  repeated sections are horizontal lines in lag space [R§1]. Grill &
  Schlüter's SSLM is past-only up to a maximum lag [R§1].
- The ±1 lag max is a 3-slope version of Müller & Kurth multi-angle path
  enhancement, for tempo wander [R§3].
- ℓ ≥ 8 mirrors McFee & Ellis's rule against linking frames within the same
  bar (their minimum was 3 beats) [R§1].
- Chosen over the audio oracle as primary for three reasons [R§6, R contradictions 6]:
  - it has no offline θ sweep;
  - it avoids GPLv3 code;
  - it stays clear of the pipeline claimed in Adobe's active VMO patent.

### 6.3 Segment identity, repeat count, and prediction

**Proposal.**

1. **Closing a segment.** When a boundary is confirmed (§6.5), the current
   segment closes. Its prototype is updated: running mean and variance of
   tick vectors, duration in ticks and bars, bar-hash histogram.
2. **Naming a new segment.** A new segment starts *provisional*. Within
   ≤ 8 ticks it is named by, in order:
   - (a) repeat evidence: the lag path points into closed segment S → same
     ID S;
   - (b) prototype match: cosine to a prototype, max over 12 chroma shifts,
     ≥ 0.85, and margin ≥ 0.05 over the second-best → S, recording the key
     shift;
   - (c) otherwise a new ID.

   IDs render as `A, B, C…` in order of first appearance. `repeatCount` is
   the number of prior occurrences.
3. **Prediction.** When a segment is identified as a repeat of S, and S has a
   stable duration (≥ 2 occurrences within ±1 bar, or 1 occurrence plus a
   lyric-block match), System 0 schedules `predictedEnd = start + D_S`,
   snapped to the bar grid. If the lag path is still active one tick before
   `predictedEnd`, a boundary with cause `predicted` fires *on time*.

**Justification.** Fact (lit): repetition is the principle that survives
causality [R§2]. Nearest-prototype matching at ≤ 20 segments is an exact
associative memory, which makes a learned memory unnecessary [R§6]. The
on-time prediction is the proposal's main advantage over late detection. It
is my synthesis, not a published result [R Short answer].

### 6.4 Bar patterns: motif, fill, drop

This part runs only on a trusted grid.

**Proposal: bar hash.**

- Each bar is 16 steps (4 per beat) × 3 lanes (bass-onset, treble-onset,
  accent) = 48 bits.
- The canonical hash is the *minimum over the 4 beat rotations*. This makes
  it invariant to a wrong downbeat.
- Hashes within Hamming distance ≤ 3 merge into one `patternId`.

**Proposal: detection rules.**

- **Motif:** a `patternId` seen in ≥ 3 bars.
- **Fill:** a bar whose Hamming distance to the mode pattern of the previous
  3 bars is ≥ 8, and which falls in the last bar of a 4- or 8-bar group since
  the last boundary, or is followed within 1 bar by a novelty candidate.
- **Drop:** a confirmed boundary within ±1 bar of a raw-level jump, where
  fast (τ = 0.1 s) exceeds slow (τ = 4 s) by more than 0.3 on a per-track
  z-scored level. The preceding 2–4 bars must show a buildup: rising treble
  onset density, and bass energy that is falling or held.

**Justification.** Fact (lit):

- Bar-length onset patterns work as "words" [R§4].
- The rule-based fill definition is deviation from adjacent bars [R§4].
- Drops sit near structural boundaries (mean distance 2.5 s) and follow
  buildups [R§4].
- Online downbeat tracking is poor (BEAST downbeat F1 46.78), hence the
  rotation invariance [R§4].

Fact (repo): `control.ts` already detects drops by energy alone, for the
`lurch` bend. System 0's drop event is the structural confirmation, for the
director. `lurch` stays unchanged (ADR-016).

### 6.5 Boundary fusion

**Proposal.** Each tick, a boundary score is computed at the candidate
position:

```text
b = 0.40·novelty_peak + 0.30·repeat_edge + 0.35·predicted
  + 0.20·lyric_edge   + 0.10·fill_prev_bar
b ×= regularity(bars since last boundary)   // 1.15 at 4/8/16 bars, else 1.0
```

- Emit a boundary when b ≥ 0.5.
- Minimum segment length is 16 ticks (≈ 8 s at 120 BPM, ≥ the director's
  6 s `minInterval`).
- Confidence is `min(1, b)`.
- The regularity bonus is deliberately small. The principle is documented,
  but corpus section-length statistics were not verified [R§1, R unverified
  list].

**Spotify present.** Fact (repo): Spotify sections drive `onSection`, and
they carry no repetition labels. Proposal: Spotify boundaries are
authoritative for *timing* (cause `spotify`). System 0 still runs §6.2–6.4
for IDs, prediction, and patterns, and logs its own boundaries in shadow mode
for evaluation (§11).

### 6.6 Lyric-line repetition prior

**Proposal.** At track start, when a synced LRC exists (`parseLrc` in
`src/director/lyrics.ts`):

1. Normalise each line: NFKC, lowercase, strip punctuation. Keep kana/kanji
   as characters.
2. Mark two lines as the same when they are exact matches or have
   character-trigram Jaccard ≥ 0.8.
3. Find blocks of ≥ 2 consecutive lines that recur ≥ 2 times. These are
   `lyricBlocks[{blockId, spans:[start,end]}]`.

Block spans give `lyric_edge` evidence (±1 bar of span start and end). They
also seed segment naming: audio in the second occurrence of block k inherits
the segment ID of the first.

**Safety check.** If the audio repeat lag disagrees with the block's lag by
more than 2 bars twice in a row, the prior is dropped for the track. This
covers LRC offset or version mismatch.

**Justification.** Fact (lit):

- Repeated lyric patterns correlate with discourse segments [R§5].
- Line-SSM segmentation works on text alone.
- Aligned audio + text SSMs improve F from 67.4% to 75.3% [R§5].

LRC timing covers the whole song up front, so this prior costs nothing at
runtime [R§5]. "Chorus" hints are allowed *only* when a lyric block and an
audio repeat agree [R§1, R contradictions 2].

### 6.7 Per-track structure cache (cross-session memory)

**Proposal.** On track end (or `resetTrackStats`) with ≥ 60% of the track
observed, persist int8-quantised tick features, boundaries, IDs, and
prototypes under `trackId`. When idle, run an **offline** re-segmentation
over the cached matrix: a TS port of Laplacian segmentation or structure
features over ≤ 512 ticks. On the next play of the same `trackId`, preload
the full-song segmentation. Boundaries and IDs are then known from tick 0,
and the online path only confirms alignment.

**Justification.** Fact (lit): offline full-song methods outperform what is
possible causally [R§1, R§2]. Fact (repo): the app never has the audio file,
so offline analysis must run on data captured during a first listen [R§7].
This gets offline-grade structure without any learned model or GPU.

## 7. Outputs and how the director uses them

**Proposal: types.**

```ts
type BoundaryCause = 'novelty' | 'repeat-start' | 'repeat-end' | 'predicted'
  | 'lyrics' | 'fill' | 'spotify' | 'timer' | 'cache';

interface StructureSnapshot {
  segmentId: string | null;      // 'A', 'B', ... ; null while provisional
  segmentOccurrence: number;     // 0 = first time heard
  repeatCount: number;           // prior occurrences
  keyShift: number;              // semitones vs first occurrence (0..11)
  confidence: number;            // identity confidence 0..1
  predictedBoundaryAt: number | null;  // seconds, when memory can predict
  chorusHint: boolean;           // lyric block ∧ audio repeat agreement only
  patternId: string | null;      // current bar motif
  source: 'system0' | 'spotify+system0' | 'cache+system0' | 'abstain';
}

type StructureEvent =
  | { kind: 'boundary'; t: number; confidence: number; causes: BoundaryCause[]; lateByTicks: number }
  | { kind: 'segment'; t: number; segmentId: string; repeatCount: number; confidence: number }
  | { kind: 'fill' | 'drop'; t: number; confidence: number }
  | { kind: 'motif'; t: number; patternId: string; occurrences: number };
```

**Proposal: integration points.** All are proposals and none exist yet.

1. **FeatureBus.** `#synthesize` stops setting `onSection` every 24 s.
   `onSection` / `sectionIndex++` come from System 0 boundaries with
   confidence ≥ 0.5. A **fallback timer of 48 s** remains only while System 0
   is in `abstain` (no boundary emitted for 48 s). This covers through-composed
   and ambient music, where repetition-based methods have nothing to find
   [R§1].
2. **TrackContext.** Add `structure?: StructureSnapshot`. `core.ts` fills
   `sectionLabel` with `segmentId`, and `chorus` only when `chorusHint`.
   `buildRequest` adds `section.segment_id`, `section.repeat`, and
   `section.boundary_cause`.
3. **Deterministic recall in LocalSystemOne.** Fact (repo): the jitter key
   is `sectionIndex`. Proposal: key it by `segmentId` when present, so the
   same segment produces the same choice even before explicit memory.
4. **Look recall (`SegmentLookMemory` in `core.ts`).**
   - On the first committed plan for a `segmentId`, store the plan tops and
     the `Look` (palette, organic, warp, fold, seed).
   - On `repeatCount ≥ 1`, reuse the stored look and seed, and let only
     `intensity` evolve (+0.25 per repeat, capped at the stored intensity + 1).
   - The seed becomes `hash(trackId, segmentId)` instead of `sceneIndex`.

   Fact (repo, ADR-015/architecture): fallback scenes keep a stable
   fingerprint, so a look change is a procedural "chapter" transition, not a
   diffusion keyframe. Recall therefore costs no GPU.
5. **Cut policy.** A `predicted` boundary, or a `repeat-start` of a known
   segment, may carry `hardCut` eligibility to the recalled look on the next
   downbeat. `drop` events raise `hard_cut` evidence. Other boundaries
   crossfade as today. The existing ShotGraph guard (`requiresDownbeat: true`)
   already defers application to a downbeat, which hides the L-tick detection
   delay [R§2].

## 8. CPU cost estimate

All figures are estimates to be measured in Phase 0/1.

| Work | Rate | Ops | Estimate |
| --- | --- | --- | --- |
| Accumulate tick bucket, log-mel(24), DCT(13) | 60 Hz | ≈ 1.5 k | ≈ 90 k ops/s |
| Large-FFT chroma read + fold (8192 bins) | 15 Hz | ≈ 16 k | ≈ 250 k ops/s |
| SSM row (N·D = 512·32) | ≤ 4 Hz | 16 k MAC | ≈ 66 k ops/s |
| Lag accumulator (3-slope) | ≤ 4 Hz | ≈ 2 k | small |
| Foote block + kernel | ≤ 4 Hz | ≈ 0.5 k | small |
| Prototype match (20 × 12 shifts × 32) | per candidate | ≈ 8 k | small |
| **Total** | | | **≈ 0.4 M simple ops/s** |

At well under 1 ns/op amortised in V8 this is ≈ 0.5 ms of CPU per *second*,
against a 16.7 ms frame. The one real addition is the second AnalyserNode's
FFT, which runs in the audio thread. Its cost must be measured. If it shows
up, fall back to `fftSize = 8192` (bin 5.9 Hz) and start the chroma fold at
≈ 200 Hz. **GPU cost: zero.**

## 9. Failure modes and mitigations

| Failure | Effect | Mitigation (proposal) |
| --- | --- | --- |
| Wandering fallback beat grid (ADR-010) | Bent diagonals, wrong bar hashes | Fixed 0.5 s ticks when untrusted; 3-slope lag max; bar hashing disabled |
| Wrong downbeat | Bar hashes shifted | Rotation-canonical hash (§6.4) |
| Key change on the final chorus (10.3% of songs per Goto) | Missed recurrence | 12-shift prototype match; record `keyShift` |
| Through-composed / ambient / DJ mix | No repetition; novelty drifts | `abstain` state → 48 s timer; never fabricate IDs below confidence 0.5 |
| Loop-based EDM (everything similar) | Over-merging into one ID | Dynamics and onset blocks carry weight; drop/buildup rules; minimum-margin prototype rule |
| `AutoGain` / loudness drift | False novelty | Raw log features + per-track z-scores only |
| Silence or pauses | Spurious boundaries | Gate ticks with raw RMS < −60 dBFS; a silence ≥ 2 s is its own boundary cause |
| Seek / scrub | Ring time inconsistent | Detect position jumps (Spicetify progress) → close segment, keep prototypes |
| Track change missed (no host signal) | Memory mixes songs | Keep `resetTrackStats()` as today; if a cached track's prototypes stop matching, raise novelty |
| LRC mismatch | Wrong chorus prior | Lag cross-check disables the prior (§6.6) |
| Over-eager cuts | Visual churn | Min segment length 16 ticks; director `minInterval` unchanged; recall reuses looks (less change, not more) |

## 10. Phased plan

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 0: Baseline and fixtures | Opt-in JSONL of per-tick features (≈ 130 B/tick); synthetic form fixtures; `evaluate:logs` section metrics; timer baseline measured | Timer's false-change rate vs Spotify sections recorded on ≥ 5 tracks |
| 1: Features + novelty | `src/structure/` with ticks, improved chroma, raw timbre, Foote L = 8; shadow mode only (logs, no `onSection`) | Synthetic boundary F ≥ 0.9 within ±2 ticks; p99 tick update < 0.5 ms |
| 2: Repetition + IDs + prediction | Lag accumulator, prototypes, `predicted` boundaries; replaces the 24 s timer behind `?structure=system0`; `SegmentLookMemory` recall | Beats the timer on F3 and false-change rate (§11); recall hits visible in logs |
| 3: Bar patterns | Hash, motif, fill, drop events | Fill/drop precision spot-checked on ≥ 10 annotated EDM/pop tracks |
| 4: Priors and cache | LRC block prior; per-track cache plus offline re-segmentation | Second-play boundary F3 ≥ first-play + 0.1 on the same tracks |
| 5 (optional, measurement-gated) | CPU BeatNet/BEAST downbeat, or All-In-One as an idle offline job | Only if Phases 1–4 miss targets *and* measured CPU/GPU impact is nil during streaming |

## 11. Evaluation plan

### 11.1 Deterministic fixtures (Node, added to `npm test`)

Synthetic tick sequences with a known form, such as
`A16 B16 A16 B16 C8 B16′`, where B′ is B transposed +2 semitones. Add
Gaussian feature noise (σ = 0.2 of block norm), ±5% tempo jitter (tick
stretch), and a random downbeat rotation.

The proposed thresholds below are asserted:

| Check | Pass condition |
| --- | --- |
| Boundary hit rate | ±2 ticks, F ≥ 0.9 |
| ID pairwise F (mir_eval-style, reimplemented in TS) | ≥ 0.9 |
| Third B | Named `B` with `keyShift = 2` |
| Third B `predicted` boundary | Within ±1 tick |
| 120 s stationary drone | Zero boundaries (then `abstain` → timer) |
| All-identical loop fixture | ≤ 1 ID |
| Cost | Run `commitTick` 10⁴ times; p99 < 0.5 ms on the dev laptop |

### 11.2 Offline audio evaluation (Python tool, never in the runtime path)

- **Features.** Replay audio the user owns for tracks that appear in Harmonix
  (MIT annotations), SALAMI (CC0), or RWC/AIST, through a Node replay of the
  same `StructureMemory` fed from recorded `FeatureFrame` JSONL. This keeps
  the online features identical [R§8].
- **Metrics.** `mir_eval.segment.detection` at 0.5 s and 3 s, `deviation`,
  `pairwise` and `nce` for IDs against functional labels, and CHR.5F only
  where `chorusHint` fired [R§8].
- **References on the same audio:**
  - MSAF `foote`, `sf`, `scluster` offline (upper reference);
  - the 24 s timer;
  - evenly spaced boundaries (lower reference, F0.5 ≈ 0.13 / F3 ≈ 0.33 class
    per Ullrich et al.) [R§8].
- **Targets (proposal):**
  - F3 ≥ timer F3 + 0.15;
  - F3 ≥ 0.6 × MSAF `sf` offline;
  - median `lateByTicks` ≤ L + 1 for non-predicted boundaries;
  - ≥ 50% of repeat-segment boundaries fired as `predicted` on second and
    later occurrences.

### 11.3 Live telemetry (extend `_state` JSONL and `npm run evaluate:logs`)

- Boundaries per minute, split by cause.
- Confidence histogram.
- Share of director decisions triggered by System 0, by the timer, and by
  meaning revisions.
- `abstain` time share.
- Recall hits: decisions where `SegmentLookMemory` reused a look.

**Spotify comparison (shadow mode).** System 0 runs whenever Spotify
sections are present. The evaluator reports:

- agreement F3 between System 0 boundaries and Spotify sections;
- a **false section-change rate**: boundaries per minute more than 3 s from
  any Spotify section, for System 0 *and* for the 24 s timer evaluated on the
  same sessions.

Spotify sections are an algorithmic reference with their own `confidence`,
not ground truth [R§8].

**Repo-local success criterion (proposal):** on the same sessions, System 0's
false-change rate is ≤ 50% of the timer's, and its agreement F3 is ≥ the
timer's + 0.2.

### 11.4 Human spot-check

For 10 tracks, with section times hidden, a listener marks "the visuals
recognised this section coming back" (yes/no) at each true repeat. Report
the recall rate. This is the product-level claim System 0 exists for, and it
is not captured by boundary F.

## 12. Verified facts vs proposals

- **Verified (repo):** everything tagged Fact (repo). This includes the 24 s
  synthetic section, director intervals, `sectionIndex`-keyed jitter,
  `AutoGain` non-stationarity, the 2048-point chroma, the wandering fallback
  grid, `parseLrc`, and the ShotGraph downbeat guard.
- **Verified (lit):** the numbers and behaviours cited through [R§n], each
  with primary links in the review.
- **Proposals:** every threshold, weight, and buffer size, and the look-recall
  policy. None has been measured. The Phase 0 fixtures exist to replace
  these guesses with measurements.
- **Estimates:** CPU and memory in §5 and §8.
