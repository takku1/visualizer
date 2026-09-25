# Next step for multilingual lyric grounding

Status: research-backed baseline implemented; embedding expansion remains gated on
additional held-out data.

## Executive recommendation

Extend the existing bounded grounding adapter with a **two-stage, language-agnostic
candidate pipeline**:

1. Preserve Unicode-aware character/grapheme evidence for repeated ASR windows and
   timed lyric lines. Use it for recall and stabilization, not for semantic
   interpretation by itself.
2. Add an optional multilingual sentence-embedding pass that runs once per track
   and ranks a small, versioned vocabulary of perceptual cues. Use it to propose
   candidates, never to create literal entities or actions on its own.
3. Promote a cue only when independent evidence agrees: repeated temporal evidence,
   language/script compatibility, lexical or embedding margin, and a calibrated
   confidence threshold. Otherwise retain the current abstention/perceptual path.

This is the smallest improvement likely to increase coverage for Japanese,
mixed-language, and unsupported-language lyrics without turning a noisy Whisper
window or a semantically nearby embedding into an invented story.

## Critical conclusion

The tempting solution is to translate every lyric line or send it to a large
multilingual encoder and accept the nearest visual concept. That would improve
apparent coverage while weakening the repository's strongest property: evidence
gating. Sentence embeddings measure semantic relatedness, not whether a lyric
actually asserts a persistent person, object, place, or action. A lyric can be
close to a prototype because of mood, metaphor, or shared context while providing
no literal grounding evidence.

The proposed architecture therefore separates three questions:

```text
Did the recognizer hear a stable source span?
        -> lexical / grapheme / timing evidence

What broad perceptual cue might that span support?
        -> multilingual embedding ranking

Is it safe to create or update a world entity/action?
        -> calibrated selective gate; otherwise abstain
```

The last question must remain stricter than the first two.

## What the primary research supports

### Character- and byte-level evidence

CANINE shows that a multilingual encoder can operate directly on character
sequences without a fixed vocabulary; its motivation is that fixed tokenization
is not equally suitable across languages, and it reports gains on a multilingual
TyDi QA benchmark. ByT5 similarly reports that byte-level input avoids
language-specific tokenization and is robust to noisy text. These results support
keeping a Unicode/grapheme-level recovery path when word segmentation is absent
or unreliable, especially for kana, kanji, code-switching, and ASR fragments
([CANINE, Clark et al., TACL 2022](https://aclanthology.org/2022.tacl-1.5/);
[ByT5, Xue et al., TACL 2022](https://aclanthology.org/2022.tacl-1.17/)).

They do **not** show that raw character overlap is sufficient for lyric meaning.
That is an inference for this application: use normalized grapheme sequences to
establish that successive observations are probably the same evidence, then rely
on the bounded cue vocabulary and temporal gate for interpretation.

### Multilingual sentence embeddings

LaBSE combines multilingual pretraining and translation-ranking objectives and
reports 83.7% bi-text retrieval accuracy over 112 languages, with a released
model covering 109+ languages. This makes a multilingual encoder a reasonable
candidate for ranking a fixed cross-language cue bank once per track
([LaBSE, Feng et al., ACL 2022](https://aclanthology.org/2022.acl-long.62/)).

The mE5 technical report describes multilingual E5 models trained on large
multilingual text-pair data and presents small/base/large inference tradeoffs,
which is compatible with a CPU-side, once-per-track experiment rather than a
frame-loop dependency ([Multilingual E5, Wang et al., 2024](https://arxiv.org/abs/2402.05672)).

Neither paper establishes lyric-level grounding, calibrated confidence, or safe
promotion of visual entities. The repository should therefore treat embedding
similarity as a **proposal score** and record model/version/score/margin as
provenance.

### Abstention and evidence coverage

Selective classification formalizes the tradeoff between coverage and risk: a
system may abstain on difficult examples to reduce errors among accepted
predictions. That is the correct framing for lyric grounding, where false literal
entities are more damaging to continuity than a perceptual fallback
([El-Yaniv and Wiener, JMLR 2010](https://jmlr.org/papers/v11/el-yaniv10a.html);
[Gangrade et al., AISTATS 2021](https://proceedings.mlr.press/v130/gangrade21a.html)).

The practical implication is to measure a risk-coverage curve on a held-out,
multilingual lyric fixture instead of choosing a threshold because it “sounds
confident.” Coverage may increase later, but only after accepted-cue precision
and language-stratified calibration are measured.

## Repository-specific design

The existing contract already provides the right seams:

- `src/director/grounding-contract.json` remains the bounded, versioned cue
  vocabulary.
- The current Unicode/script-aware matcher remains the first evidence stage.
- `SongMeaning`/`GroundedCue` retain source language, evidence span, timing,
  confidence, and provenance.
- `MeaningManifest` remains the durable artifact; no embedding model belongs in
  the render hot path.
- Abstention remains the output when a cue is unsupported, unstable, or
  insufficiently evidenced.

### Proposed candidate record

This is a design target, not an implementation request for this note:

```ts
type GroundingCandidate = {
  cue: GroundedCue;
  sourceLanguage: string;
  evidenceSpans: string[];
  observations: number;
  lexicalScore: number;
  embeddingScore?: number;
  embeddingMargin?: number;
  timingQuality: 'synced' | 'untimed' | 'windowed';
  model?: { name: string; revision: string };
  gate: 'provisional' | 'committable' | 'abstain';
};
```

### Proposed gate

Use a conservative conjunction plus a calibrated score, rather than a single
embedding threshold:

```text
stable_span
AND language/script_compatible
AND repeated_or_synced_evidence
AND (lexical_match OR embedding_score >= calibrated_threshold)
AND embedding_margin >= calibrated_margin   # when embedding is used
AND candidate_confidence >= calibrated_threshold
    -> committable bounded cue
else
    -> provisional evidence or abstention
```

Important restrictions:

- An embedding-only match may rank a perceptual cue, but may not create a
  literal person/object/place/action.
- Untimed lyrics may seed track-level perceptual direction, but may not schedule
  section-local events.
- One ASR window cannot commit a new entity or replace the current world.
- Conflicting language adapters should lower confidence and preserve the current
  world.
- Translation, if added later, is auxiliary evidence and cannot replace the
  original-language span.

## Concrete implementation sequence after this note

1. ~~Build a small evaluation fixture with English, Japanese, mixed-language, and
   at least two unsupported-script examples. Label cue presence, timing quality,
   and whether promotion is acceptable.~~ Done in
   `scripts/grounding-fixture.json` and `npm run evaluate:grounding`.
2. ~~Measure the current lexical adapter using precision, recall, language-specific
   coverage, and false entity/action promotions.~~ Baseline result: 8/8 fixture
   cases pass, cue precision 100%, cue recall 100%, and zero false promotions.
   This is a regression baseline, not a claim of broad language coverage. A
   separate held-out report (`npm run evaluate:grounding:heldout`) initially
   exposed two bounded vocabulary gaps (`moonlight` and the force sense of
   `dark`). Adding those explicit synonyms to the versioned contract now gives
   10/10 cases, 100% cue recall, 100% precision, and zero false promotions.
   Unsupported Spanish/Korean cases remain abstentions. This is still a small
   contract regression set, not broad multilingual validation.
3. Add Unicode grapheme normalization and repeated-window diagnostics if the
   existing code still compares code points where grapheme clusters are more
   appropriate. Keep the current bounded matcher as the baseline.
4. Evaluate one CPU-side multilingual encoder (LaBSE or multilingual E5-small)
   against the fixed cue bank once per track. Cache embeddings and never load or
   invoke the encoder in the frame loop.
5. Calibrate thresholds on held-out data and report risk-coverage by language.
   A threshold is not ready for default use until unsupported and metaphorical
   lines remain abstentions.
6. Only then enable embedding proposals behind a feature flag. Default behavior
   should remain lexical/timing evidence plus abstention until the benchmark
   demonstrates improved coverage without a false-promotion regression.

The first implementation seam is now available as the offline command
`npm run evaluate:multilingual-cues`. It uses a fixed cue bank and an opt-in
Transformers checkpoint; it is intentionally not part of `npm run app` and its
output cannot promote a literal world entity or action.

The first `intfloat/multilingual-e5-small` run on the held-out fixture is not
ready for integration: with threshold `0.60` and same-type margin `0.04`, the
gate abstained on all ten cases, while the highest-ranked guesses included
incorrect cues for unsupported Spanish/Korean and unknown Japanese text. This
is evidence that raw embedding similarity is not a safe grounding mechanism;
the next experiment must add language/script gates, repeated evidence, and
calibrated risk-coverage before any proposal can reach the director.

The evaluator now exposes this as an explicit gate: unsupported languages,
script contradictions, single observations, and low score/margin candidates
abstain with machine-readable reasons. Even a candidate that passes those
checks remains `proposal-only`; it cannot create a literal person, object,
place, or action without lexical/timing evidence or a separately validated
promotion policy.

## Measurements to add

| Metric | Why it matters |
| --- | --- |
| cue precision among committed cues | protects world integrity |
| cue recall / coverage by language | detects Japanese and mixed-language gaps |
| false entity/action promotion rate | primary safety failure |
| risk-coverage curve / AURC | measures abstention quality |
| repeated-window agreement | separates stable evidence from ASR noise |
| embedding top-1 margin | detects ambiguous semantic neighborhoods |
| CPU latency and cache hit rate | keeps first-listen startup practical |

The acceptance target should prioritize lower false promotion at comparable
coverage, then expand coverage gradually. A higher number of non-abstaining
tracks is not an improvement if it makes the visual world less truthful.

## Decision

Do not replace the current bounded lexical adapter with translation or a general
multilingual LLM. Implement and benchmark a **lexical/grapheme evidence layer +
once-per-track multilingual cue ranker + calibrated selective gate**. This extends
the current architecture, keeps the renderer responsive, and preserves the
project's evidence-backed abstention contract.

## Sources

- [CANINE: Pre-training an Efficient Tokenization-Free Encoder for Language Representation](https://aclanthology.org/2022.tacl-1.5/)
- [ByT5: Towards a Token-Free Future with Pre-trained Byte-to-Byte Models](https://aclanthology.org/2022.tacl-1.17/)
- [Language-agnostic BERT Sentence Embedding (LaBSE)](https://aclanthology.org/2022.acl-long.62/)
- [Multilingual E5 Text Embeddings: A Technical Report](https://arxiv.org/abs/2402.05672)
- [On the Foundations of Noise-free Selective Classification](https://jmlr.org/papers/v11/el-yaniv10a.html)
- [Selective Classification via One-Sided Prediction](https://proceedings.mlr.press/v130/gangrade21a.html)
