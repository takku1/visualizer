# Reliable lyrics ingestion for semantic music video direction

Status: research/design decision; no provider integration has been shipped.

## Executive conclusion

There is no single source that reliably and lawfully supplies lyrics for every
track. Spotify exposes the currently playing track, progress, metadata, and an
explicit-lyrics flag through its Web API, but not lyric text or synced lyric
lines. The project should therefore treat lyrics as an external, licensed
content capability rather than as a hidden Spotify feature.

The production architecture should use a provider adapter with this policy:

1. Prefer a commercial provider whose contract explicitly permits the intended
   use: lyric retrieval, semantic analysis, and—if desired—music-video or
   synchronized visual output.
2. Match the exact recording using ISRC when available, then provider track ID;
   artist/title/album/duration matching is only a candidate lookup.
3. Prefer word- or line-synchronized lyrics; accept plain lyrics for ahead-of-
   time planning but mark timing as unavailable.
4. Preserve the original language and source attribution. Translation may help
   semantic extraction, but must not replace the original evidence.
5. Reject ambiguous, region-blocked, stale, or poorly matched results. The
   director must abstain rather than invent a song event.
6. Keep live ASR as the degraded path for unknown or unavailable tracks. Label
   its output `provisional` and do not let it overwrite committed meaning until
   repeated evidence agrees at a section boundary.

## What the available sources establish

### Spotify is an identity and timing source, not a lyric source

Spotify's currently-playing endpoint provides the track object, playback state,
timestamp, and progress in milliseconds. Its track object includes metadata
such as ISRC and an explicit-lyrics boolean, but the documented response does
not include lyric text or lyric timing. See the [currently playing reference]
(https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track)
and [track reference]
(https://developer.spotify.com/documentation/web-api/reference/get-track).

The Web API describes itself as a way to retrieve metadata and control
playback, not as a lyrics API ([Spotify Web API overview]
(https://developer.spotify.com/documentation/web-api)). The app can use
Spotify's track identity and progress to select and align a separately
licensed lyric record, but should not scrape Spotify's private client
endpoints.

### Licensed commercial providers are the production direction

Musixmatch describes its API as a licensed track-lyrics and metadata catalog;
its API documentation includes lyric/subtitle responses with language,
copyright, regional restriction, and tracking fields. It requires an API plan
and key ([Musixmatch developer workspace]
(https://www.postman.com/musixmatch-dev), [lyrics API documentation]
(https://www.postman.com/musixmatch-dev/musixmatch-apis/documentation/pqm8o6w/lyrics-api)).

LyricFind is also a licensing provider, but the end-user terms visible in its
distribution context show why the exact contract matters: lyric use can be
limited to personal/non-commercial use, redistribution can be prohibited, and
karaoke or sing-along rights are not implied ([LyricFind lyrics terms]
(https://www.pandora.com/legal/lyrics)). Those terms are not a production
license for this project; they are evidence that provider selection must be
resolved with a contract, not inferred from availability in a consumer app.

### Open/community sources are useful for development and gap filling

LRCLIB provides a machine-friendly API for plain and synchronized lyrics and
is useful for local experiments and test fixtures ([LRCLIB source repository]
(https://github.com/tranxuanthang/lrclib), [LRCLIB client documentation]
(https://lrclib.js.org/classes/Client.html)). Its public/community nature does
not establish that the project may redistribute lyrics, use them commercially,
or synchronize Spotify playback with generated visuals. It should be an
explicitly configurable development fallback, never silently presented as the
production licensing solution.

## Recommended lookup pipeline

```text
Spotify current track
        |
        v
identity resolver: ISRC -> provider ID -> strict metadata candidate
        |
        v
provider adapter(s): licensed synced -> licensed plain -> development fallback
        |
        v
rights + region + match + language + timing validation
        |
        +--> accepted lyric evidence -> semantic planner -> committed shot plan
        |
        +--> plain lyrics -> ahead-of-time plan, no lyric-time commits
        |
        +--> no acceptable result -> live ASR provisional mode or abstention
```

## Song-start prefetch

The preferred flow is not to discover lyrics line by line while the song is
playing. When the track changes, the host already knows the track identity and
can start a one-shot lookup for the complete lyric record:

```text
track-change event
  -> resolve ISRC/provider identity
  -> request complete synced lyrics
  -> validate match, rights, language, and timing
  -> compile section/shot plan for the whole track
  -> commit only the current section to the renderer
```

The first procedural checkpoint should be allowed immediately so a slow
provider cannot stall playback. When the lookup succeeds, the director can
replace the abstaining plan at the next safe boundary. Future sections can be
compiled in advance, while the hot loop only selects the active timed line,
motif state, and shot transition.

This gives the director a planning horizon without requiring the entire audio
file. A provider can return the full lyric text from track identity; a live ASR
engine cannot know future lyrics unless the complete recording is separately
available and legally processable. ASR therefore remains a fallback for a
lookup miss, not a mechanism for preloading the song's future meaning.

The cache should be keyed by provider plus exact recording identity, preferably
ISRC, and should store the provider's revision, expiry/rights metadata, and
language. A second play of the same track should not repeat the network lookup
or semantic extraction.

The resolver should not trust title and artist alone. Covers, remixes,
translations, live versions, duplicate releases, and regional variants can
share nearly identical metadata. A candidate should include:

- exact ISRC match when the track supplies one;
- normalized artist/title/album comparison;
- duration difference within a configured tolerance;
- provider language and region;
- instrumental flag;
- whether timing is line-level or word-level;
- provider revision and retrieval time;
- rights status for this application and output mode.

Each accepted result should be converted into the existing local meaning
manifest contract, with evidence segments retaining `source: "lyrics"`,
language, timestamps, provider identity, and confidence. The raw lyric text
should not be copied into renderer prompts or logs.

## Provider abstraction to add later

The code should eventually expose a narrow adapter, not provider-specific logic
inside the director:

```ts
type LyricLookup = {
  trackId: string;
  isrc?: string;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
};

type LyricResult = {
  provider: string;
  providerTrackId?: string;
  match: 'isrc' | 'provider-id' | 'metadata';
  language?: string;
  lines: Array<{ startMs?: number; endMs?: number; text: string }>;
  timing: 'word' | 'line' | 'none';
  rights: 'verified' | 'unknown' | 'rejected';
  confidence: number;
  retrievedAt: string;
};

interface LyricsProvider {
  lookup(query: LyricLookup): Promise<LyricResult | null>;
}
```

The adapter must return `null` for an ambiguous or unauthorized result. The
meaning compiler then applies the existing evidence gate. A provider result
with `rights: "unknown"` must not become semantic evidence in production.

## How this fits the two-timescale architecture

The user's architectural correction is right:

- full synced lyrics are the primary path and give the director a planning
  horizon;
- plain lyrics still permit a track-level story plan, but not exact lyric-time
  commits;
- live ASR is a provisional recovery path for unknown tracks;
- only licensed, matched, evidence-bearing meaning can update committed motif
  identity;
- a provisional transcript can influence low-risk motion or camera behavior,
  but cannot introduce a new literal subject until a section-boundary commit.

This preserves the director's job as planning rather than retrospective
guessing. It also makes wrong-but-confident live transcription less damaging:
the provisional layer can expire without contaminating the committed motif
ledger.

## Recommended implementation order

1. Add `LyricsProvider` and `LyricResult` types without a network provider.
2. Add deterministic matching and validation tests using synthetic fixtures.
3. Add a user-imported `.lrc`/plain-text path for immediate experimentation.
4. Evaluate a licensed provider contract for the intended distribution and
   synchronization use before adding credentials or production calls.
5. Add a provider adapter with cache keys based on provider ID/ISRC, not title.
6. Add live ASR only after measuring provider misses and transcript quality.
7. Add an evaluation set covering English, Japanese, multilingual tracks,
   remixes, instrumentals, explicit lyrics, and wrong-match candidates.

## Decision

Do not implement a Spotify-lyrics scraper or claim universal coverage. Build a
rights-aware lyrics adapter seam, start with imported LRC fixtures and a
licensed-provider evaluation, and retain explicit abstention. This is the only
path that preserves the existing evidence-gated architecture while leaving
room for broad catalog coverage.
