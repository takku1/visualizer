# Verified low-overhead lyrics, metadata, and meaning sources

Status: source verification note. It adds primary-source facts to
[low-overhead-lyrics-and-meaning-sources.md](low-overhead-lyrics-and-meaning-sources.md);
this note changes no code or provider policy.

Verified on 2026-09-24. All claims below were checked against the linked
primary page, repository, or live endpoint on that date unless marked
**unverified**.

## Summary

- **Lyrics.** Three things are local and free: embedded tags, sidecar `.lrc`
  files, and a self-hosted LRCLIB SQLite dump. LRCLIB's public API needs no
  key and returns plain and line-synced lyrics. Its current dump is one
  ~47.6 GB gzip SQLite file. LRCLIB does not publish a license for the
  lyric data itself, so rights stay `unknown`.
- **Metadata.** Windows SMTC gives the title, artist, and album but no ISRC.
  Local files can carry an ISRC (ID3 `TSRC`, Vorbis `ISRC`). MusicBrainz
  gives CC0 core metadata. Tags and genres are CC BY-NC-SA supplementary data.
  MusicBrainz ships dumps twice a week and limits its API to 1 request per
  second per IP.
- **Meaning without an LLM.** The NRC lexicons (EmoLex, VAD v2.1) and a small
  multilingual sentence encoder (for example `multilingual-e5-small`, 118 M
  parameters) can each run once per track on CPU. AcousticBrainz high-level
  mood data is CC0 but frozen in 2022 and keyed by MBID. Essentia mood models
  are CC BY-NC-SA 4.0.
- **Excluded.** Genius's API does not return lyric text, and its terms forbid
  scraping. Musixmatch needs a key and a paid plan for production use. Last.fm
  needs a key, allows non-commercial use only, and caps stored data at 100 MB.

## Recommended pipeline

The lookup runs once at each track change and never in the frame loop. The
cascade and cache identity rules are the ones in
[low-overhead-lyrics-and-meaning-sources.md](low-overhead-lyrics-and-meaning-sources.md);
this section only adds where each verified source fits.

```text
SMTC (title/artist/album/position/duration; no ISRC)
  -> exact-track local cache (meaning/<id>.json + raw provider record)
  -> embedded tags of the local file, if one is known:
       ID3 SYLT (ms) > sidecar .lrc (enhanced <mm:ss.xx> word tags) > ID3 USLT /
       Vorbis LYRICS / MP4 ©lyr (plain; may contain LRC text)
       + ISRC from ID3 TSRC / Vorbis ISRC for exact identity
  -> LRCLIB: local SQLite dump (offline, preferred) or keyless API
       (flagged network; UA required; honour 429 + Retry-After)
  -> Whisper sidecar (provisional, language-tagged)
  -> abstention

Offline interpretation (once per track, stored in the meaning manifest):
  lyric lines -> NRC EmoLex / VAD v2 counts per line and section
              -> multilingual-e5-small (or MiniLM-L12) line/section embeddings
                 -> nearest perceptual-concept prototypes
  optional priors: MusicBrainz genres/tags (song-level only),
                   AcousticBrainz high-level (if MBID known), Essentia audio mood
```

Lexicon hits and embeddings are **interpretation signals**, not lyric
evidence. They should be stored with `source`, `method`, `version`, and
`confidence`, as the existing evidence gate expects, and should never create a
literal entity.

## Comparison

| Source | Gives | Offline? | Key? | License / terms | Overhead |
| --- | --- | --- | --- | --- | --- |
| Embedded tags (USLT/SYLT, LYRICS, ©lyr) | plain lyrics; SYLT synced (ms) | yes | no | whatever the user's file carries | file read; music-metadata (MIT) / mutagen (GPL-2) |
| Sidecar `.lrc` | line (+ optional word) timing | yes | no | user file | trivial parse (existing `meaning:import`) |
| LRCLIB API | plain + line-synced lyrics, `instrumental`, Lyricsfile YAML | no (flag) | no | server MIT; **data license unstated** | 1 HTTP call/track; UA required |
| LRCLIB dump | same, whole DB | yes | no | as above | ~47.6 GB `.sqlite3.gz` download |
| MusicBrainz API | recordings, ISRC lookup, tags, genres | no (flag) | no (UA required) | core CC0; tags/genres CC BY-NC-SA 3.0 | 1 req/s per IP |
| MusicBrainz dumps | full DB (PostgreSQL) | yes | no | as above | `mbdump` 7 GB + `mbdump-derived` 495 MB (bz2) |
| ListenBrainz API/dumps | recording tags (with genre MBIDs), listens, labs similarity | API no / dumps yes | no for metadata reads | listens/user data CC0 | 1 call/s; large dumps |
| AcoustID + Chromaprint | fingerprint → MBID when tags are missing | fingerprint local, lookup online | yes (app key) | service non-commercial only; data CC BY-SA 3.0; Chromaprint LGPL-2.1 | fpcalc on ~120 s of audio + 1 call; max 3 req/s |
| Last.fm `track.getTopTags` | crowd tags | no | yes | non-commercial; 100 MB cap | 1 call/track |
| AcousticBrainz dumps | mood_*, danceability, genre, etc. per MBID | yes | no | CC0 | ~30 zstd parts, ~1–2 GB each |
| NRC EmoLex | 8 emotions + 2 sentiments per word, 14,182 words | yes | no | non-commercial research/education; no redistribution | dictionary lookup |
| NRC VAD v2.1 | V/A/D scores, >55k words and phrases | yes | no | same as EmoLex | dictionary lookup |
| multilingual-e5-small | 384-d multilingual embeddings | yes | no | MIT | 118 M params, 471 MB fp32 |
| Essentia mood models | audio mood/arousal-valence | yes | no | CC BY-NC-SA 4.0 (library AGPL-3.0) | small TF/ONNX heads on embeddings |
| CLAP (LAION) | audio–text similarity | yes | no | Apache-2.0 weights | 615–776 MB checkpoints |

## Lyrics

### LRCLIB

The LRCLIB web app ships its API documentation inside the page bundle at
[lrclib.net/docs](https://lrclib.net/docs). The quotes in this section were
extracted from that bundle.

- **No key.** "There is no need for an API key or any kind of registering!"
- **Client identification is required.** Clients must set `User-Agent` to
  "application's name, version, and a link to its homepage or project page or
  an email address". `X-User-Agent` or `Lrclib-Client` are accepted when a
  client cannot set that header. The
  [server router](https://github.com/tranxuanthang/lrclib/blob/main/server/src/router.rs)
  reads all three.
- **Rate limits.** The docs promise "generous rate limiting" but give no number.
  An over-limit request gets `429 Too Many Requests` with `Retry-After`, which
  clients "**must** honor". Ignoring it "may result in a temporary ban". The
  docs recommend sequential requests with a 200–500 ms delay for batch scans.
- **`GET /api/get`.** Parameters are `track_name` (required), `artist_name`
  (required), `album_name` (optional, recommended), and `duration` (optional,
  seconds, 1–3600). The docs say a match needs the duration to be exact "or at
  least with a difference of ±2 seconds". The
  [repository SQL](https://github.com/tranxuanthang/lrclib/blob/main/server/src/repositories/track_repository.rs)
  uses `duration >= d - 2.0 AND duration <= d + 2.0`. A miss returns `404`,
  and the track "may become available in a later request" through a background
  fetcher. The response contains `id`, `trackName`, `artistName`, `albumName`,
  `duration`, `instrumental`, `plainLyrics`, `syncedLyrics`, and `lyricsfile`
  (a YAML "Lyricsfile" document that is always present). A live call on the
  documented example returned this shape.
- **`GET /api/get/{id}`.** Looks up a record by its LRCLIB ID.
- **`GET /api/search`.** Parameters are `q` or `track_name` (one is required),
  plus optional `artist_name` and `album_name`. It returns at most 20 results
  and has no pagination.
- **`/api/get-cached` is not verified.** It is not in the current docs or the
  current server's route table
  ([router.rs](https://github.com/tranxuanthang/lrclib/blob/main/server/src/router.rs)).
  A probe of it returned `404` on 2026-09-24. The server now caches
  `/api/get` lookups internally, with the cache key using the rounded duration
  ([get_lyrics_by_metadata.rs](https://github.com/tranxuanthang/lrclib/blob/main/server/src/routes/get_lyrics_by_metadata.rs)).
  Older clients such as
  [lrclibapi](https://lrclibapi.readthedocs.io/en/stable/lrclib.html) expose a
  `cached` flag. Do not depend on it.
- **Database dumps.** The dumps are listed at
  [lrclib.net/db-dumps](https://lrclib.net/db-dumps) and served from
  `https://db-dumps.lrclib.net/<key>`. On 2026-09-24 the listing held one file,
  `lrclib-db-dump-20260923T042405Z.sqlite3.gz` (47,588,708,546 bytes, uploaded
  2026-09-23). A search snapshot showed an earlier
  `lrclib-db-dump-20260828T090200Z.sqlite3.gz` at 43.2 GiB, which suggests
  roughly monthly releases with only the latest kept. The cadence is **not
  documented**.
- **Self-hosting.** The server is Rust (Axum) on SQLite3 under the MIT license
  ([README and license](https://github.com/tranxuanthang/lrclib)). It runs as
  `cargo run --release -- serve --database db.sqlite3` or in a container.
  Serving a downloaded dump locally is therefore a fully offline option. The
  dump schema was **not checked** against the server version.
- **Data license is unverified.** The docs, dump page, and repository state
  no license for the lyric data. The MIT license covers the server code only.
  Keep `rights: "unknown"`.

### Embedded and sidecar lyrics

- **ID3v2.4 `USLT`.** Fields are text encoding, 3-byte language, a content
  descriptor, and the full lyrics text. `SYLT` adds a time-stamp format
  (`$01` MPEG frames or `$02` milliseconds, both absolute from file start) and
  a content type (`$01` lyrics, `$02` transcription, and so on). It stores a
  sequence of terminated text chunks ("typically a syllable"), each followed by
  a 32-bit timestamp, so `SYLT` can carry sub-line timing
  ([ID3v2.4 frames, mutagen spec mirror](https://mutagen-specs.readthedocs.io/en/latest/id3/id3v2.4.0-frames.html);
  id3.org returned HTTP 500 on the verification date).
- **Vorbis/FLAC.** The Vorbis comment spec's proposed field list has no lyrics
  field, but it does define `ISRC`
  ([Vorbis comment spec](https://xiph.org/vorbis/doc/v-comment.html)). In
  practice:
  - Picard maps lyrics to `LYRICS` and has no Vorbis mapping for synced
    lyrics ([Picard tag mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html)).
  - A Picard ticket notes that `LYRICS` often holds synced (LRC) text while
    `UNSYNCEDLYRICS` holds plain text
    ([PICARD-3199](https://tickets.metabrainz.org/browse/PICARD-3199)).
  - A `SYNCEDLYRICS` key is a tagger convention, not a standard. Readers should
    therefore sniff for `[mm:ss.xx]` in any of these fields.
- **MP4.** Lyrics live in the `©lyr` atom (plain), and there is no synced atom
  in Picard's mapping. ASF uses `WM/Lyrics` and `WM/Lyrics_Synchronised`
  ([Picard tag mapping](https://picard-docs.musicbrainz.org/en/latest/appendices/tag_mapping.html)).
- **LRC / enhanced LRC.** Lines look like `[mm:ss.xx]text`, with ID tags such
  as `[ar:]`, `[ti:]`, `[al:]`, `[length:]`, and `[offset:]`. The "A2"
  extension adds inline `<mm:ss.xx>` word tags. There is no formal
  specification ([LRC format overview](https://en.wikipedia.org/wiki/LRC_(file_format));
  secondary source). The
  [syncedlyrics](https://github.com/moehmeni/syncedlyrics) client exposes an
  `--enhanced` option for this word-level form.
- **Libraries.**
  - **music-metadata (Node, MIT).** It lists LRC, `SYLT`, and `USLT` as
    supported lyric formats
    ([README](https://github.com/Borewit/music-metadata)). Its common `lyrics`
    tag is `ILyricsTag { descriptor?, language?, contentType, timeStampFormat,
    text?, syncText: { text, timestamp? }[] }`
    ([type.ts](https://github.com/Borewit/music-metadata/blob/master/lib/type.ts)).
    It maps ID3 `USLT`/`SYLT`, iTunes `©LYR`, Vorbis `LYRICS`, APEv2
    `LYRICS`/`UNSYNCEDLYRICS`, and ASF `WM/Lyrics`
    ([common metadata](https://github.com/Borewit/music-metadata/blob/master/doc/common_metadata.md)).
    This makes `SYLT` usable directly from the Electron host.
  - **mutagen (Python, GPL-2).** `SYLT` exposes `encoding`, `lang`, `format`,
    `type`, `desc`, and `text` as a list of `(text, time)` pairs decoded from
    32-bit big-endian stamps
    ([_frames.py](https://github.com/quodlibet/mutagen/blob/main/mutagen/id3/_frames.py),
    [_specs.py](https://github.com/quodlibet/mutagen/blob/main/mutagen/id3/_specs.py),
    [COPYING](https://github.com/quodlibet/mutagen/blob/main/COPYING)).
    GPL is fine for a local sidecar but matters if the project redistributes a
    bundled binary.
- **The SMTC limit.** The SMTC media-properties class exposes `Title`,
  `Artist`, `AlbumTitle`, `AlbumArtist`, `Subtitle`, `Genres`, `TrackNumber`,
  `AlbumTrackCount`, `PlaybackType`, and `Thumbnail`, but no file path, ISRC,
  or lyrics
  ([Microsoft Learn](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmediaproperties)).
  Embedded-tag lookup therefore works only when the host can resolve the
  playing file, for example through a user-configured music-library index.
  Streaming players give only title, artist, and album.

## Metadata and identity

### MusicBrainz

- **Rate limit.** Requests are limited per source IP to "on average 1 request
  per second". Exceeding it declines **all** requests (HTTP 503) until the rate
  drops. There is also a global limit of 300 requests per second
  ([Rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)).
- **User-Agent.** Every request needs a `User-Agent` in the form
  `Application name/<version> ( contact-url or contact-email )`. Anonymous
  agents such as a blank value or `Python-urllib` are throttled (same page).
- **Tags and genres.** `inc=tags`, `inc=genres`, and `inc=ratings` work on
  lookups, including recording lookups. Non-MBID lookups by ISRC are supported
  ([MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)).
- **Licensing.** Core data is CC0. Supplementary data is CC BY-NC-SA 3.0 and
  includes "user submitted annotations, tags (including genre associations)
  and ratings" ([Data License](https://musicbrainz.org/doc/About/Data_License),
  [MusicBrainz Database](https://musicbrainz.org/doc/MusicBrainz_Database)).
- **Dumps.** Full exports come in PostgreSQL format. On 2026-09-23 the export
  directory held `mbdump.tar.bz2` (7 GB), `mbdump-derived.tar.bz2` (495 MB,
  where tags live), `mbdump-edit` (16 GB), and others. Consecutive exports were
  dated 2026-09-19 and 2026-09-23, which fits a twice-weekly cadence
  ([download docs](https://musicbrainz.org/doc/MusicBrainz_Database/Download),
  [fullexport index](https://data.metabrainz.org/pub/musicbrainz/data/fullexport/)).
  Loading requires a local PostgreSQL. That is heavy for a laptop app, so a
  cached per-track API lookup is lower overhead.

### ListenBrainz

- **Recording metadata.** `GET /1/metadata/recording/?recording_mbids=…&inc=tag`
  returns tags for the recording, artist, and release group, some with
  `genre_mbid`
  ([metadata API](https://listenbrainz.readthedocs.io/en/latest/users/api/metadata.html)).
- **Rate limit.** Clients must "never make more than ONE call per second" and
  must use the `X-RateLimit-*` headers
  ([API index](https://listenbrainz.readthedocs.io/en/latest/users/api/index.html)).
- **Similarity.** A session-based similar-recordings dataset is hosted at
  [labs.api.listenbrainz.org/similar-recordings](https://labs.api.listenbrainz.org/similar-recordings),
  with a tag-similarity sibling. These are labs services with no stated
  stability guarantee.
- **Dumps and license.** Full dumps are made twice a month and incremental
  dumps twice a week
  ([dumps](https://listenbrainz.readthedocs.io/en/latest/users/listenbrainz-dumps.html)).
  "User listen data and text is made public under the … CC0 license"
  ([Footer.tsx](https://github.com/metabrainz/listenbrainz-server/blob/master/frontend/js/src/components/Footer.tsx)).
  The license of tag data re-served from MusicBrainz is **not stated**
  separately. Treat it as MusicBrainz supplementary data.

### AcoustID and Chromaprint

- **Service terms.** The service is "provided for free for non-commercial use
  only". Clients must not exceed 3 requests per second and need a registered
  application API key (the `client` parameter)
  ([web service](https://acoustid.org/webservice)).
- **Short snippets do not work.** The service "has been designed for
  identifying full audio" and cannot identify short snippets
  ([FAQ](https://acoustid.org/faq)). `fpcalc` processes 120 s by default
  ([fpcalc.cpp](https://github.com/acoustid/chromaprint/blob/master/src/cmd/fpcalc.cpp)).
  Loopback capture would need about two minutes of clean playback first.
- **Licenses.** The fingerprint database is CC BY-SA 3.0 and the server is MIT
  ([license](https://acoustid.org/license)). Chromaprint's own code is MIT but
  "as a whole … LGPL 2.1" because of bundled FFmpeg parts
  ([LICENSE.md](https://github.com/acoustid/chromaprint/blob/master/LICENSE.md)).

### Last.fm

`track.getTopTags` takes a track and artist, or an MBID, and requires
`api_key`, but no user authentication
([method docs](https://www.last.fm/api/show/track.getTopTags)). Under the
[API terms](https://www.last.fm/api/tos):

- data may be used "solely for non-commercial purposes";
- stored data must stay within a "Reasonable Usage Cap" of 100 MB;
- clients must cache according to HTTP headers;
- the data must not be sub-licensed;
- Last.fm "reserves the right to share in revenue".

The key requirement and terms make Last.fm a poor fit here, even though it
has the best tag coverage.

### AcousticBrainz (historical)

- **Status.** The project ran from 2015 to 2022, and "In 2022, the decision
  was made to stop collecting data". The site and API "will continue to be
  available". A high-level API request returned HTTP 200 on 2026-09-24. All
  data is CC0 ([home](https://acousticbrainz.org/)).
- **Final dumps (2022-07-06).** The dumps cover 29,460,584 submissions. The
  high-level JSON dump is split into 30 `tar.zst` parts of about 0.5–2 GB
  each (roughly 35–40 GB in total by directory listing), and a 100k-item
  sample and low-level feature CSVs are also available
  ([downloads](https://acousticbrainz.org/download),
  [high-level dump index](https://data.metabrainz.org/pub/musicbrainz/acousticbrainz/dumps/acousticbrainz-highlevel-json-20220623/)).
  The deduplicated dump (about 7 M recordings) was still marked "Pending".
- **High-level classifiers**
  ([data page](https://acousticbrainz.org/data)):
  - mood: `mood_acoustic`, `mood_aggressive`, `mood_electronic`,
    `mood_happy`, `mood_party`, `mood_relaxed`, `mood_sad`, `moods_mirex`;
  - rhythm and genre: `danceability`, `ismir04_rhythm`, and the
    `genre_dortmund`, `genre_electronic`, `genre_rosamerica`, and
    `genre_tzanetakis` families;
  - other: `gender`, `timbre`, `tonal_atonal`, `voice_instrumental`.
- **Usefulness.** The data is keyed by recording MBID and needs identity
  first. Recordings released after 2022 are absent.

## Interpretation without an LLM

### NRC lexicons

- **EmoLex v0.92.** It covers 14,182 English unigrams with 8 emotions and 2
  sentiments. Google-Translate versions exist for 108 languages (August 2022),
  and the page warns that some translations may be wrong or mere
  transliterations
  ([EmoLex](https://saifmohammad.com/WebPages/NRC-Emotion-Lexicon.htm)).
- **VAD v2 (v2.1, March 2025).** It has ratings for "more than 55,000 English
  words and phrases", including about 10k multi-word expressions. Scores run
  from 0 to 1 per dimension on the page's description
  ([VAD page](https://saifmohammad.com/WebPages/nrc-vad.html),
  [arXiv:2503.23547](https://arxiv.org/abs/2503.23547)). The translations
  were made from **v1** (20k words, August 2022). No translated v2 was found.
- **Terms (both lexicons).** Use is free for "non-commercial research and
  educational purposes", and commercial use needs a paid license. "Do not
  redistribute the data", and a product using a lexicon must credit it in its
  About page and documentation (same pages). **Consequence:** the lexicon must
  not be committed to this repository. Each user downloads it, and only
  derived per-track scores are stored.

### Multilingual sentence encoders

Parameter counts come from the Hugging Face API, and sizes are fp32 checkpoint
files. ONNX exports exist for the first three.

| Model | Params | Disk | Dim / max tokens | Languages | License |
| --- | --- | --- | --- | --- | --- |
| [paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) | 118 M | 471 MB | 384 / 128 | 50+ | Apache-2.0 |
| [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) | 118 M | 471 MB | 384 / 512; needs a `query: ` prefix | ~94 listed | MIT |
| [LaBSE](https://huggingface.co/sentence-transformers/LaBSE) | 471 M | 1.88 GB | 768 | 109 | Apache-2.0 |
| [bge-m3](https://huggingface.co/BAAI/bge-m3) | ~568 M (inferred from the 2.27 GB checkpoint) | 2.27 GB | 1024 / 8192 | "more than 100" | MIT |

Either 118 M model fits the "compute once per track on CPU" budget and leaves
the 6 GB GPU to Whisper. LaBSE and bge-m3 are better as offline batch tools.
Throughput on the A3000 and on CPU was **not measured**.

### Small text-emotion classifiers

- [SamLowe/roberta-base-go_emotions](https://huggingface.co/SamLowe/roberta-base-go_emotions)
  is MIT-licensed, English only, has 28 multi-label outputs, and comes with an
  INT8 ONNX variant.
- [j-hartmann/emotion-english-distilroberta-base](https://huggingface.co/j-hartmann/emotion-english-distilroberta-base)
  (7 emotions),
  [MilaNLProc/xlm-emo-t](https://huggingface.co/MilaNLProc/xlm-emo-t)
  (multilingual; "refer users to the original licenses accompanying each
  dataset"), and
  [cardiffnlp/twitter-xlm-roberta-base-sentiment](https://huggingface.co/cardiffnlp/twitter-xlm-roberta-base-sentiment)
  declare **no license** in their model metadata. Treat them as unusable until
  that is clarified.
- The lyrics-specific models found (for example
  `sherelyn912/distilbert-base-uncased-lyrics-emotion`) have single-digit
  downloads and no evaluation. They are not worth depending on
  ([HF search](https://huggingface.co/models?search=lyrics%20emotion)).

All of these models are trained on social-media or dialogue text, not lyrics.
Expect domain shift and evaluate on the project's labeled set before relying
on them.

### Audio-side mood (no lyrics needed)

- **Essentia.** It provides mood heads (`mood_happy`, `mood_sad`,
  `mood_relaxed`, `mood_aggressive`, and others), arousal/valence regressors
  (`deam`, `emomusic`, `muse`), `danceability`, `approachability`,
  `engagement`, and the 56-class MTG-Jamendo mood/theme model. They run on
  Discogs-EffNet, MusiCNN, VGGish, or YAMNet embeddings in TF, TF.js, or ONNX
  form. "All the models created by the MTG are licensed under CC BY-NC-SA
  4.0", with a proprietary license on request
  ([Essentia models](https://essentia.upf.edu/models.html)). The Essentia
  library is AGPL-3.0
  ([repo](https://github.com/MTG/essentia)).
- **CLAP.**
  - [laion/clap-htsat-unfused](https://huggingface.co/laion/clap-htsat-unfused)
    is a 615 MB checkpoint;
    [laion/larger_clap_music](https://huggingface.co/laion/larger_clap_music)
    is 776 MB; both are Apache-2.0.
  - The [LAION-AI/CLAP](https://github.com/LAION-AI/CLAP) code is CC0-1.0,
    and [microsoft/CLAP](https://github.com/microsoft/CLAP) is MIT.
  - CLAP gives broad sound and mood concepts, not sung words.

## Excluded and why

- **Genius.** The documented `songs` resource describes the document and its
  annotations. The API docs show no lyric-body field, and the site documents
  a client token requirement. "Commercial use of the Genius API is not allowed
  without a license" ([API docs](https://docs.genius.com/)). The terms forbid
  "data mining, robots, scraping or similar data gathering"
  ([terms](https://genius.com/static/terms)). Lyrics would therefore require
  scraping, which is prohibited.
- **Musixmatch.** `track.lyrics.get` returns `lyrics_body` and
  `lyrics_copyright` and documents "country restrictions" and "Lyrics views
  tracking" obligations
  ([endpoint docs](https://developer.musixmatch.com/documentation/api-reference/track-lyrics-get)).
  It needs a key and a plan. The free-tier limits (about 2,000 calls/day and
  30% of lyric text) are **unverified from a primary source**: the pricing page
  blocked automated fetches, and the numbers appear only on third-party
  summaries such as
  [freeapihub](https://freeapihub.com/apis/musixmatch). Excluded because it
  needs a key and a commercial contract.
- **Last.fm.** Excluded because it needs a key, is non-commercial only, and
  caps storage at 100 MB (see above).
- **NetEase, QQ, Kugou, and the Musixmatch desktop endpoint.** Open-source
  clients call undocumented endpoints:
  - `syncedlyrics` (MIT) uses `music.163.com/api/song/lyric` and
    `apic-desktop.musixmatch.com` with a scraped user token
    ([netease.py](https://github.com/moehmeni/syncedlyrics/blob/main/syncedlyrics/providers/netease.py),
    [musixmatch.py](https://github.com/moehmeni/syncedlyrics/blob/main/syncedlyrics/providers/musixmatch.py));
  - LyricsX's LyricsKit lists NetEase, QQ Music, Kugou, and others
    ([LyricsKit](https://github.com/ddddxxx/LyricsKit)).

  No public terms that authorize this use were found. Excluded as legally
  ambiguous and brittle.
- **AcoustID in the default path.** Excluded because it needs a key, is
  non-commercial, needs about 120 s of audio, and makes a network call. Keep
  it as an optional offline-tagging tool for local libraries.

## Open questions and unverified items

1. **LRCLIB lyric data license.** Nothing is published. Ask the maintainer
   before redistributing anything derived from the dump.
2. **LRCLIB dump cadence and schema.** Only the latest dump is listed, and the
   interval is inferred (Aug 28 → Sep 23). Confirm the schema matches the
   current server before relying on `serve --database <dump>`.
3. **LRCLIB numeric rate limit.** Undocumented. Measure `429` behavior
   conservatively, one request at a time.
4. **`/api/get-cached`.** Not in the current docs or code. Treat it as removed.
5. **Musixmatch free-tier numbers.** Primary page not reachable, as noted
   above.
6. **ListenBrainz tag license.** Presumed to follow MusicBrainz supplementary
   terms (CC BY-NC-SA). No explicit statement was found.
7. **NRC VAD v2 translations and score range.** Translated files were found
   for v1 only. Confirm the v2 score range in the downloaded README before
   parsing.
8. **Runtime cost.** Encoder latency on CPU versus the A3000, and whether it
   co-exists with Whisper in 6 GB, is not measured.
9. **Resolving the playing file.** SMTC gives no file path. Embedded-tag and
   ISRC paths need a library index or player-specific integration.
