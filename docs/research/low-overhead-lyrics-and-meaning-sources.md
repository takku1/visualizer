# Low-overhead lyrics and meaning sources

Status: implementation direction; the LRCLIB adapter is available as an
explicit community-data provider, while automatic production use remains
rights- and evidence-gated.

## Recommended acquisition cascade

```text
exact-track cache
    ↓ miss
local .lrc / embedded lyric seam
    ↓ miss
LRCLIB development provider (metadata + duration match)
    ↓ miss or rejected match
Whisper live fallback
    ↓ no reliable language/content
abstaining perceptual direction
```

The cascade is ordered by cost and evidence quality. A lookup happens once at
track change and never in the frame loop. Synced lyric position is aligned to
the media-session playhead; the renderer continues immediately with its current
world while lookup is pending.

The lookup path exposes non-semantic telemetry for each track: `pending`,
`cache-hit`, `provider-hit`, `miss`, `rejected`, `unusable`, or `error`. This is
intentionally separate from evidence and meaning. A successful download can
still be rejected because rights are unknown, timing is absent, or the bounded
grounding layer finds no supported cue. That distinction prevents treating a
slow Whisper window, a provider miss, and a rights decision as the same
failure when diagnosing an apparent fallback.

## LRCLIB boundary

LRCLIB documents `GET /api/get` with `track_name`, `artist_name`, optional
`album_name`, and duration, and can return `plainLyrics` and `syncedLyrics`
([LRCLIB API documentation](https://lrclib.net/docs)). The adapter therefore:

- requires title and artist;
- includes album and rounded duration when available;
- sends the documented client-identification header and rejects a returned
  duration more than 2 seconds from the local track;
- parses synced LRC lines into the existing `LyricsResult` evidence contract;
- preserves provider identity, retrieval time, and source URL;
- returns `rights: "unknown"` because community availability is not a license;
- returns `null` on network, shape, status, or match failure.

The current implementation lives in `src/director/lyrics.ts` as
`LocalTimedLyricsProvider`, `LrclibLyricsProvider`, `LyricsProviderChain`,
`CachedLyricsProvider`, and the browser-safe `StorageLyricsCache`. The local adapter accepts a host
resolver for embedded tags or a neighboring `.lrc` file; it performs no file
I/O itself. It is deliberately not
silently promoted to licensed production evidence. A caller must explicitly
decide whether unknown-rights development data may affect committed meaning.
When a source omits a language tag, the adapter recovers Japanese or Korean
only from their distinctive scripts; it does not infer an arbitrary language
from Latin text.

The verified source note [`lyrics-and-meaning-sources-verified.md`](lyrics-and-meaning-sources-verified.md)
records the primary-source checks, including LRCLIB's `X-User-Agent`/rate-limit
requirements, the absence of a lyric-data license, and the fact that Windows
SMTC does not expose a local file path or ISRC.

## Cache identity

Cache keys include provider, local track identity, ISRC when available, artist,
title, album, and rounded duration. This prevents a cover, remix, live version,
or regional release from inheriting another recording's lyrics merely because
the title matches. A future persistent cache can store the raw provider record
and the compiled meaning manifest separately, with provider revision and
rights metadata retained.

The Electron/browser harness uses a bounded local-storage cache when the
provider is explicitly enabled. Cache expiry or storage/quota failures are
treated as misses and never interrupt playback.

## Meaning without an LLM

Meaning extraction should remain layered:

1. bounded lexical adapters expose directly evidenced entities/actions;
2. optional multilingual embeddings can rank perceptual concepts once per
   track, but cannot create literal entities without evidence;
3. acoustic features provide affect, energy, rhythm, and material pressure;
4. community tags are song-level priors, never lyric evidence;
5. Whisper remains a provisional recovery path when no timed source exists.

NRC emotion/VAD resources, multilingual sentence encoders, MusicBrainz or
ListenBrainz metadata, and historical AcousticBrainz data are candidates for
offline experiments, not dependencies of the real-time renderer. Any future
source needs a language/evidence/confidence record and an evaluation set before
it can promote a world entity or action.

## Unknown track identity

When title/artist are unavailable, there is no cheap method that can reliably
recover exact lyrics from audio alone. The system should not pretend otherwise.
The correct fallback is a staged evidence path:

```text
audio features → affect/rhythm/material pressure
Whisper windows → provisional language-tagged evidence
repeated bounded cues → grounded action/motif handles
corresponding evidence → committed semantic world change
```

This can produce useful music-reactive visuals quickly, but it cannot promise
lyric accuracy. Identity-free audio-to-meaning models such as CLAP are useful
for broad sound concepts, not proof of sung words or narrative events
([CLAP](https://arxiv.org/abs/2206.04769),
[Whisper](https://arxiv.org/abs/2212.04356)).

## Implementation order

1. Keep exact-track cache and local imports authoritative when present.
2. Compose local, licensed, and development adapters with the ordered provider
   chain; add local audio-tag/sidecar discovery without blocking playback; the
   resolver seam is now present, but host-specific file/tag discovery remains
   outside the renderer.
3. LRCLIB is now the default development/community provider and its unknown-
   rights results may affect committed meaning while retaining the provider,
   rights, confidence, and evidence fields. Measure match rate, language
   coverage, duration mismatches, and semantic promotion. Use
   `npm run app -- --lyrics-rights=off` to restore evidence-only behavior.
4. Add a rights-cleared provider adapter if the intended distribution permits
   lyric synchronization.
5. Only then evaluate multilingual embeddings or emotion resources against a
   labeled English/Japanese/mixed-language set.

The renderer must remain responsive and the director must preserve abstention:
cheap lookup improves evidence; it does not authorize invented story.
