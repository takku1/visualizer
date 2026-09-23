# Backend validation status

> **Architecture revision:** A successful image response is no longer enough.
> Backend validation must include world revision, entity preservation, spatial
> channels, continuity, and stale-update rejection.

This records evidence for the backend portions of the visualizer backlog. It
is intentionally separate from visual quality review.

## Verified locally

- `npm run typecheck`
- `npm run causality` — semantic/control causality passes, including every
  declared audio control leaf.
- `npm run lyrics:causality` — `off` performs no source load, fixture cues
  load in overlay mode, cue boundaries are deterministic, gaps are hidden, and
  the sidecar payload/response boundary, off-to-overlay reload, typed cue
  events, and seed-preserving world participation are validated.
- `npm run perception:causality` — validates the learned audio sidecar payload,
  embedding acceptance, provenance identity, and invalid-response rejection.
- `npm run motion:causality` — verifies bounded WorldMotion projection,
  semantic intervention response, and seed preservation.
- `npm run analyze:logs` — analyzes all JSONL sessions without mutating them.
- `npm run build` — extension, harness, and causality bundles compile.

## Current real-session evidence

The existing corpus contains 351 decision windows across 29 sessions, with
349 captured windows and 719 telemetry samples. The System One and direct
baseline top labels diverge frequently, and no simulation NaNs were observed.

The corpus is not yet valid evidence for metadata- or structure-conditioned
semantics: all existing windows report missing track metadata and missing
authoritative structure. A fresh Electron session with a real track change is
required before claiming that the learned or hosted semantic path adds value.

## Optional providers

- Learned audio perception: configure `perceptionUrl` with a provider that
  accepts `POST` `{ "input": PerceptualState, "audio": { sampleRate, channels, samples } }`
  and returns `{ "learned": AudioEmbedding | null }`. Calls occur only at director
  decision cadence, accepted model/version/vector provenance is retained in
  each decision log, and failures fall back to deterministic DSP.
  A runnable audio-native provider is available with `npm run perception:server`;
  it uses MERT-v1-95M to encode the recent Spotify loopback PCM window. The
  browser sends up to six seconds of mono audio at decision cadence; MERT uses
  the newest five seconds. The model is optional and the deterministic path
  remains authoritative when the sidecar is unavailable.
- Lyrics: configure `lyricsUrl` with a rights-aware provider that accepts
  `{ title, artist }` and returns `{ cues: LyricCue[] }`. The visualizer does
  not scrape or store provider credentials.

## Runtime telemetry contract

Every five-second Electron telemetry record includes `perception` when an
audio adapter is configured. It records configured state, request/success/
failure counts, last latency, model provenance, and vector length. This makes
the distinction between disabled, unavailable, and successfully learned audio
explicit in the logs; decision records still carry the actual embedding under
`perception.learned`.

Active lyric cues are copied into the `TrackContext` passed to System One and
the model-conditioning packet. Overlay-only display remains independent, so
lyrics can influence semantic interpretation without being drawn on screen.
