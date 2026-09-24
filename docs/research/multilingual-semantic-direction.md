# Multilingual semantic direction

Status: local multilingual ASR transport and conservative semantic promotion are
implemented; language/semantic quality and visual evaluation remain open.

## Finding

The renderer does not need to translate a song at display rate. It needs a stable,
language-tagged semantic artifact produced before a scene checkpoint. The artifact
should preserve the source language, evidence spans, and normalized semantic roles
(`person`, `place`, `action`, `relation`) separately from the text labels used in a
prompt.

This matters for Japanese, Korean, Spanish, mixed-language songs, and songs whose
title or lyrics are not available in English. A language tag is metadata, not a
translation. BCP 47 is the right interoperability boundary: Unicode CLDR uses it
to distinguish languages, scripts, and regions, and documents canonicalization and
language matching ([Unicode LDML, language identifiers](https://www.unicode.org/reports/tr35/47/tr35.html)).

## What existing research supports

- CLAP demonstrates an audio/text joint space for open-vocabulary audio concepts,
  but its existence does not prove lyric-level narrative understanding. It is a
  candidate evidence source for affect, genre, instrumentation, and sound events,
  not a replacement for lyrics or a semantic manifest ([CLAP paper](https://arxiv.org/abs/2206.04769)).
- SeamlessM4T exposes multilingual speech recognition and text/speech translation
  interfaces, while SeamlessStreaming describes streaming ASR and translation
  coverage. These are plausible upstream services for extracting or normalizing
  lyrics, but their output still requires timestamp/evidence validation before it
  can control a scene ([SeamlessM4T implementation](https://github.com/facebookresearch/seamless_communication),
  [SeamlessStreaming documentation](https://github.com/facebookresearch/seamless_communication/blob/main/docs/streaming/README.md)).
- Lyric translation is not ordinary sentence translation: research on singable
  translation treats musical constraints as part of the task. For this project,
  that argues for retaining original lyric evidence and using translation only as a
  semantic aid, never as the sole source of truth ([Songs Across Borders](https://aclanthology.org/2023.acl-long.27/)).

## Contract for this project

`SongMeaning.language` is an optional BCP 47 tag such as `ja`, `ko`, or `es-MX`.
Motif labels and action strings may remain in the source language. The browser
director carries the tag into `SemanticScene.language`; it does not translate in
the hot loop.

The future extractor should produce:

```ts
type MultilingualEvidence = {
  sourceLanguage: string;       // BCP 47
  text: string;                 // original evidence, never discarded
  translatedText?: string;     // optional aid, explicitly marked
  startSec?: number;
  endSec?: number;
  confidence: number;
};
```

The manifest should eventually distinguish `sourceLanguage` from a normalized
semantic representation and a user-selected `displayLanguage`. Until that exists,
the safe behavior is to preserve the original labels and abstain from invented
narrative when evidence is missing.

## Proposed extraction pipeline

```text
audio + metadata + optional lyrics
        ↓
language identification / script detection
        ↓
timestamped source evidence
        ↓
semantic normalization (motifs, relations, actions)
        ↓
confidence + provenance gate
        ↓
versioned SongMeaning(language=BCP47)
        ↓  section/checkpoint cadence only
scene compiler → prompt + typed fingerprint
```

The current implementation slice supports manifests authored in any language,
local Whisper ASR windows, explicit language forcing (including `ja`), bounded
timestamps, script-based Japanese recovery when Whisper reports `und`, and
conservative English/Japanese motif/action extraction. It preserves source
evidence and keeps provisional hypotheses separate from committed meaning.
Automatic translation is still intentionally absent from `sceneFromPlan`:
translation would move uncertain, expensive work into the director/render path
and violate the project's timescale separation.

## Current evidence boundary

Implemented now: optional `language` on `SongMeaning`, propagation to
`SemanticScene`, explicit scene-source telemetry, local multilingual ASR,
language forcing, bounded live evidence, and conservative Japanese/English
extraction. Timed lyric acquisition/providers, translation, broad language
coverage, calibrated transcription quality, and cross-language visual
evaluation remain deferred. A connected ASR worker or a language label alone
must not be claimed as semantic or visual understanding.
