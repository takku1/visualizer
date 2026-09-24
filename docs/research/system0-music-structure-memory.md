# Research: System 0, a cheap music-structure memory

Researched 2026-09-24. Every factual claim below links to the source it was
checked against: original papers, library source code, or dataset pages.
Claims marked **(unverified)** were not confirmed against a primary source in
this pass. Numbers marked **(derived)** are my own arithmetic from repo code or
cited parameters, not measurements.

The companion design proposal is
[`system0-design-sketch.md`](system0-design-sketch.md). Lyric-source research
lives in
[`low-overhead-lyrics-and-meaning-sources.md`](low-overhead-lyrics-and-meaning-sources.md)
and is not repeated here.

## Question

Can a cheap pattern-memory layer ("System 0") sit between per-frame perception
(System 1) and the slow semantic director? It would detect real section
boundaries, recognise repeated sections (A/B/chorus recurrence), fingerprint
bar-level drum patterns (motif, fill, drop), and use lyric-line repetition as a
chorus cue. It has to do all of this online, on the renderer CPU, without using
the GPU the diffusion sidecar needs.

## Short answer

- **Yes for repetition and recall. Partly for boundaries.** Every classic
  structure method is built on a self-similarity matrix (SSM). The SSM row for
  the newest beat is cheap to compute online. Repetition, meaning "the last few
  bars match bars we heard N beats ago", can be detected causally. Goto's
  time-lag formulation already defines similarity only against the past
  ([Goto 2006](https://staff.aist.go.jp/m.goto/PAPER/IEEETASLP200609goto.pdf)).
  The factor/audio oracle family is incremental by construction
  ([Wang, Hsu & Dubnov 2015](https://www.ismir2015.uma.es/articles/78_Paper.pdf)).
- **Novelty-based boundaries always arrive late.** A Foote checkerboard kernel
  of half-width L needs frames n−L…n+L, so a boundary can be confirmed only
  about L frames after it happens
  ([FMP, novelty](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S4_NoveltySegmentation.html)).
  The 2020 TISMIR review says SSM methods "need the full song to produce
  results". It points to spectrogram CNNs for causal settings
  ([Nieto et al. 2020](https://transactions.ismir.net/articles/10.5334/tismir.54)).
  I found **no published, evaluated online/causal audio structure-segmentation
  system** (see §2). This is an open gap, not a solved problem.
- **The accuracy ceiling is modest even offline.** Unsupervised methods reach
  boundary F ≈ 0.22–0.32 at ±0.5 s and ≈ 0.38–0.58 at ±3 s on SALAMI
  ([McFee & Ellis 2014](https://archives.ismir.net/ismir2014/paper/000319.pdf)).
  The best supervised models reach ≈ 0.51 (±0.5 s) on SALAMI
  ([Grill & Schlüter 2015](https://grrrr.org/data/pub/grill_schlueter-2015-ismir.pdf))
  and 0.66 HR.5F on Harmonix
  ([Kim & Nam 2023](https://arxiv.org/abs/2307.16425)). An online System 0
  should target bar-quantised, ±3 s-class boundaries, with repetition doing
  the real work.
- **Memory is the payoff.** The second time a section arrives, a system that
  remembers the first occurrence knows how long it lasts. It can predict the
  next boundary instead of detecting it late. This anticipation argument is
  my own synthesis, built on repetition-based MSA (§1) and oracle recall (§6).
  It is not a published result.
- **Heavy learned models are the wrong default here.** All-In-One is small
  (300 K parameters) but depends on Demucs source separation and whole-song
  attention. Foundation models are 95 M–5 B parameters. Several of them do
  worse than a spectrogram baseline on structure
  ([Marmoret et al. 2026](https://arxiv.org/abs/2603.27218)).

## Repo facts this research is grounded in

These come from reading the code on 2026-09-24. They are not literature
claims.

| Fact | Where | Consequence for System 0 |
| --- | --- | --- |
| Without Spotify analysis, `FeatureBus.#synthesize` sets `onSection` every 24 s | `src/audio/bus.ts` | Today's "section" is a timer; any real boundary beats it |
| `AnalysisSource` sets `onSection` from Spotify sections, but they carry no repetition labels | `src/audio/analysis.ts`; [Spotify sections object](https://developer.spotify.com/documentation/web-api/reference/get-audio-analysis) | Segment IDs must come from System 0 even when Spotify is present |
| Spotify restricted audio-analysis for new Web API apps on 2024-11-27 | [Spotify developer blog](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) | The repo reads it through Spicetify's `getAudioData`, which is a separate path; availability is outside our control, so treat it as optional |
| Director asks on `onSection`, every 30 s (`maxIntervalMs`), or on a meaning change, never within 6 s (`minIntervalMs`) | `src/director/director.ts` | A boundary more often than every 6 s is wasted |
| Local engine jitter is keyed by `sectionIndex` | `src/director/local.ts` (`hash(id:label:sectionIndex)`) | A repeated chorus gets a *different* jitter today; recall needs a `segmentId` key |
| Chroma: 2048-point AnalyserNode FFT folded 55 Hz–5 kHz into 12 bins, decayed ×0.85 per frame | `src/audio/loopback.ts` | At 48 kHz the bin spacing is 23.4 Hz; a semitone at 110 Hz is ≈ 6.5 Hz wide, so bins below ≈ 400 Hz smear across semitones **(derived)** |
| Band features pass through `AutoGain` (peak decay 0.35/s) | `src/audio/source.ts` | The same passage gets different band values depending on the last ~2–3 s; bad for recurrence matching **(derived)** |
| Fallback beat grid wandered 103–149 BPM in a live session | `docs/decisions.md` ADR-010 | Beat-synchronous frames are only trustworthy with Spotify, or with `rhythmConfidence > 0.5` (the gate `control.ts` already uses) |
| Bar phase without Spotify is `beat/4` free-running; there is no downbeat estimate | `src/rhythm/analyzer.ts` | Bar-level pattern hashing must be rotation-invariant |
| `parseLrc` exists; LRC gives line start times for the whole song up front | `src/director/lyrics.ts` | Lyric repetition is a *whole-song* (non-causal) prior that costs nothing at runtime |
| AnalyserNode `fftSize` may be any power of two from 32 to 32768 | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/fftSize) | A second, larger analyser for chroma is possible without new dependencies |

## 1. Music structure analysis foundations

### Principles

Structure methods use three principles:

- **Novelty/homogeneity:** sections are internally consistent, and change at
  boundaries.
- **Repetition:** repeated sections show up as diagonal stripes in the SSM.
- **Regularity:** section lengths tend to be regular.

The first two are in
[Paulus, Müller & Klapuri 2010](https://ismir2010.ismir.net/proceedings/ismir2010-107.pdf).
[Nieto et al. 2020](https://transactions.ismir.net/articles/10.5334/tismir.54)
adds regularity. The review also notes that beat-synchronous features improve
boundary precision, and that all the standard metrics are implemented in
`mir_eval`.

### Foote novelty (1999/2000)

A small checkerboard kernel, tapered by a Gaussian, is correlated along the
SSM main diagonal. Peaks mark transitions between self-similar blocks
([Foote 2000, ICME](https://ccrma.stanford.edu/workshops/mir2009/references/Foote_00.pdf);
[FMP notebook](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S4_NoveltySegmentation.html)).

- **Resolution tradeoff:** larger kernels give smoother curves but coarser
  timing.
- **Lookahead:** the value at frame n needs frames n−L…n+L. That makes it
  *semi-causal*, with an L-frame delay.
- **FMP's example settings:** about 10 Hz chroma and kernel sizes of 80–100
  frames. These come from the notebook's WebFetch summary **(unverified
  exact values)**.

Cost per new frame is O(L²) for the kernel plus O(N·D) for one new SSM row.

### Structure features (Serrà et al. 2012/2014)

Method
([Serrà et al., IEEE TMM 16(5), 2014](https://doi.org/10.1109/TMM.2014.2310701);
[FMP explanation](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S4_StructureFeature.html)):

1. Time-delay-embed the features.
2. Build a k-NN recurrence matrix.
3. Convert it to a circular time-lag matrix L(ℓ, n) = S(n+ℓ, n), so repeated
   material becomes horizontal lines.
4. Take novelty as the distance between successive lag columns.

Key property from FMP: when two frames share structural properties, their lag
columns are *identical*. The SSM columns are only shifted copies.

Two variants matter for online use. The published method uses the full-song
lag range. [Grill & Schlüter 2015](https://grrrr.org/data/pub/grill_schlueter-2015-ismir.pdf)
use a *past-only* variant (SSLM): each frame is compared "to points in the
past, up to a certain lag time", with 14 s ("near") or 88 s ("far") context.
The past-only lag row is exactly what an online system can maintain.

Offline results: structure features ("SMGA" in McFee & Ellis's tables) reach
F3 = 0.699 on Beatles-TUT and 0.550 on SALAMI-functions
([McFee & Ellis 2014, Tables 1–2](https://archives.ismir.net/ismir2014/paper/000319.pdf)).

### Laplacian segmentation (McFee & Ellis 2014)

Method
([ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000319.pdf)):

- **Repetition graph:** a k-NN recurrence graph over beat-synchronous
  log-CQT (72 bins, C2–C8), time-delay-embedded with one step of history.
  k = 1 + ⌈2 log₂ n⌉. Links within 3 beats are forbidden.
- **Local graph:** a local-timbre graph from 13 beat-synced MFCCs.
- **Segmentation:** spectral clustering on the Laplacian of the combined
  graph.

It is offline, because the eigenvectors need the whole graph.

Reported results:

| Set | Automatic m | Oracle best m |
| --- | --- | --- |
| Beatles-TUT | F0.5 = 0.312, F3 = 0.579, Fpair = 0.628 | F3 = 0.684 |
| SALAMI-functions | F0.5 = 0.304, F3 = 0.455, Fpair = 0.546 | F3 = 0.579 |

The feature and graph recipe is still the best-documented *feature* recipe
to copy: beat-sync chroma-like + beat-sync MFCC, cosine/Gaussian affinity, no
same-bar links.

librosa's current default k is 2·⌈√(t − 2·width + 1)⌉
([source](https://github.com/librosa/librosa/blob/main/librosa/segment.py)).

### Chorus detection

**RefraiD (Goto 2006).** Source:
[IEEE TASLP 14(5)](https://staff.aist.go.jp/m.goto/PAPER/IEEETASLP200609goto.pdf).

- 12-D chroma over 130 Hz–8 kHz, with an 80 ms hop.
- Similarity r(t, l) between the frame at t and the frame at lag l is only
  defined into the past (l ≤ t), forming a "time-lag triangle".
- Repeated sections are horizontal line segments, found after local-mean
  noise removal.
- Modulated choruses are caught by comparing against 12 cyclically shifted
  chroma vectors. Goto found that 152 of 1481 songs (10.3%) modulate in chorus
  repetitions.
- Correct chorus sections in **80 of 100** RWC Popular songs.
- The line search is evaluated "at the current time (e.g., at the end of a
  song)". The representation is incremental, but the published integration
  runs once, over the whole song. Goto used it for chorus-skipping in a
  listening station (SmartMusicKIOSK).

**Supervised chorus/function models.**

- *CNN-Chorus* (Wang et al., ICASSP 2021) and *SpecTNT* (Wang, Hung & Smith,
  ICASSP 2022, [arXiv:2205.14700](https://arxiv.org/abs/2205.14700)) predict
  "chorusness"/"verseness" curves.
- On Harmonix, SpecTNT (24 s, CTL) gets HR.5F 0.570 and chorus-boundary
  CHR.5F 0.501.
- Unsupervised spectral clustering with the "max-duration group = chorus"
  heuristic gets HR.5F 0.263 and CHR.5F 0.171 on the same data.
- [DeepChorus](https://arxiv.org/abs/2202.06338) (ICASSP 2022) and
  [Pop Music Highlighter](https://transactions.ismir.net/articles/10.5334/tismir.14)
  (F = 0.7994 chorus detection on RWC-Pop) are also whole-song models.

The lesson for System 0: the unsupervised "longest repeated group is the
chorus" heuristic is weak (CHR.5F 0.17). A *label* of "chorus" should be a
low-confidence hint, while "this is segment A again" is the robust output.

### Fitness and thumbnailing (Müller, Jiang & Grosche 2013)

A fitness measure scores how well a segment "explains" the repetitive
structure of the whole recording. The best-scoring segment is the thumbnail
([IEEE TASLP 21(3)](https://ieeexplore.ieee.org/document/6353546/);
[FMP](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S3_AudioThumbnailing.html)).
It needs the whole SSM, so it is offline. It is useful after the first full
listen, to pick which remembered segment deserves the "hero" look.

### Comparison: offline foundations

| Method | Needs | Online? | Reported accuracy | Deps / license |
| --- | --- | --- | --- | --- |
| Foote novelty | SSM near diagonal | Semi-causal, L-frame delay | FMP example, no benchmark here | Trivial to reimplement |
| Structure features (SMGA) | Full lag matrix; past-only variant exists | Offline as published; past-only lag row is causal | F3 0.550 SALAMI-func, 0.699 Beatles ([McFee Tbl](https://archives.ismir.net/ismir2014/paper/000319.pdf)) | Reimplement; MSAF `sf` (MIT) |
| Laplacian (LSD) | Full recurrence graph + eigendecomposition | No | F0.5 0.304 / F3 0.455 SALAMI-func | librosa **(ISC, unverified)**, MSAF `scluster` (MIT) |
| RefraiD | Chroma time-lag triangle, 12 shifts | Similarity causal; line integration run at song end | 80/100 RWC-Pop chorus | Reimplement from paper |
| Fitness thumbnail | Full SSM | No | n/a (thumbnail task) | Reimplement |
| CBM (barwise) | Barwise SSM + DP | No | F0.5 40.0 / F3 56.0 on SALAMI ([Marmoret 2026](https://arxiv.org/abs/2603.27218)) | Research code |

The [TISMIR review table](https://transactions.ismir.net/articles/10.5334/tismir.54),
as summarised in this pass **(verify exact values in the article)**, lists:

- Structural Features top on MIREX 2009: HR.5F 56.4, HR3F 70.4.
- A CNN top on SALAMI: HR.5F 54.1, HR3F 68.9.

Six more datasets have JAMS annotations through `mirdata`.

## 2. Online / real-time / causal structure segmentation

### What exists

- **No evaluated causal audio segmenter found.** arXiv API searches for
  real-time/online/causal structure segmentation (2026-09-24) returned
  nothing relevant. The closest results were beat trackers and a symbolic
  (MIDI) changepoint paper, [arXiv:2303.13881](https://arxiv.org/abs/2303.13881).
  The TISMIR review names causal MSA as an under-addressed setting
  ([Nieto et al. 2020](https://transactions.ismir.net/articles/10.5334/tismir.54)).
- **Supervised CNN boundary detectors are near-causal in spirit but not
  published as causal.** [Ullrich, Schlüter & Grill 2014](https://archives.ismir.net/ismir2014/paper/000271.pdf)
  classify each spectrogram position. Their peak-picking uses a ±6 s maximum
  window and subtracts the mean of the past 12 s and *future 6 s*. So the
  published pipeline has ≥ 6 s of lookahead. SALAMI F rose from 0.33 to 0.46
  (±0.5 s) and from 0.52 to 0.62 (±3 s) over prior art.
- **VMO has an incremental construction.** Wang & Mysore's VMO segmentation
  (ICASSP 2016) was evaluated on Beatles-ISO, reported as "comparable to
  state-of-the-art" ([IEEE](https://ieeexplore.ieee.org/document/7471683/)).
  Adobe's related patent says VMO's "incremental algorithm" makes it
  "appropriate … when real-time or short computation times are desired". It
  quotes O(T log T) against O(T²) for full SSMs
  ([US10074350B2](https://patents.google.com/patent/US10074350B2/en), active,
  assignee Adobe). **Note the patent** before copying that exact pipeline
  (VMO symbolisation → SSM → segmentation → visualisation). This is a flag,
  not legal advice.
- **Lighting control is offline too.** Skip-BART (240 M parameters) states
  plainly: "our method currently supports only offline primary lighting
  generation". It names online control as an open challenge
  ([arXiv:2506.01482](https://arxiv.org/abs/2506.01482)). SeqLight extends it
  to multiple lights ([arXiv:2605.03660](https://arxiv.org/abs/2605.03660)).
  Commercial "music to DMX" tools describe band/BPM reactivity, not
  structure. No primary technical source was found.

### Lookahead arithmetic (derived)

A checkerboard kernel of half-width L beats confirms a boundary L beats after
it happens:

| L | Delay at 120 BPM | Delay at 90 BPM | Comment |
| --- | --- | --- | --- |
| 4 beats (1 bar) | 2.0 s | 2.7 s | Noisy; fills and breaks trigger it |
| 8 beats (2 bars) | 4.0 s | 5.3 s | Reasonable for the 6 s director cadence |
| 16 beats (4 bars) | 8.0 s | 10.7 s | Too slow to feel synchronous |

Detection has to be late. The visual response need not be. Three ways around
the delay:

1. **Repetition onset.** When the current beats start matching an earlier
   segment, a lag-path begins. After W matched beats (W ≈ 4–8), the system
   knows it is in "segment A again". This does not depend on the kernel.
2. **Prediction from memory.** Once segment A has been seen with duration D,
   its next occurrence's end is predicted at start + D, and can be fired on
   the exact downbeat.
3. **Retroactive confirmation.** The director only acts at ≥ 6 s cadence and
   applies looks at checkpoint landing. A 4 s-late boundary can still be
   applied at the *next downbeat* without looking late. This is the same
   deferral ShotGraph already uses (`requiresDownbeat: true` in `core.ts`).

### Incremental SSM computation (derived)

For a ring of N beat vectors of dimension D:

- The new SSM row (cosine against all N) costs N·D multiply-adds. At N = 512
  and D = 32 that is 16,384 multiply-adds per beat, microseconds in JS, done
  about 2 times per second.
- The past-only lag row is the same numbers, indexed by lag.
- Diagonal path enhancement is O(N) per beat as a running sum along each lag.

Memory: an N×N float32 ring is 1 MiB at N = 512. Storing only the lag band
(N × Lmax) is smaller.

## 3. Feature choices and costs

| Feature | Evidence | Cost here | Notes |
| --- | --- | --- | --- |
| Chroma (STFT-folded) | Goto 2006: 130 Hz–8 kHz, 80 ms hop; enough for 80/100 chorus detection ([paper](https://staff.aist.go.jp/m.goto/PAPER/IEEETASLP200609goto.pdf)) | Already computed; fold is ≈ 1 k bins/frame | Current 2048-point FFT under-resolves low pitches (see repo facts). Start the fold at ≈ 200–400 Hz, or add an 8192/16384-point analyser read at 10–20 Hz (bin 5.9 / 2.9 Hz at 48 kHz) **(derived)** |
| CQT chroma / log-CQT | McFee & Ellis use a 72-bin log-CQT, C2–C8 ([paper](https://archives.ismir.net/ismir2014/paper/000319.pdf)) | A real CQT in JS is heavier; not needed | STFT fold + log compression is the pragmatic substitute |
| CENS | librosa: L1-normalise, quantise at 0.4/0.2/0.1/0.05 (weights 0.25), smooth with a 41-frame Hann window, L2-normalise ([source](https://github.com/librosa/librosa/blob/main/librosa/feature/spectral.py)) | Trivial per beat | The smoothing is non-causal as written; use beat-sync averaging instead |
| MFCC / timbre | 13 beat-synced MFCCs for local timbre ([McFee & Ellis](https://archives.ismir.net/ismir2014/paper/000319.pdf)); CNNs prefer mel spectrograms ([Ullrich 2014](https://archives.ismir.net/ismir2014/paper/000271.pdf)) | ≈ 24 log-mel bands + 13-point DCT from the existing 1024-bin spectrum per frame **(derived: < 2 k ops)** | Use raw log energies, not `AutoGain` outputs |
| Tempogram / rhythm | Grill & Schlüter's SSLM on mel features ([2015](https://grrrr.org/data/pub/grill_schlueter-2015-ismir.pdf)) | Onset-lane bar histograms (§4) are cheaper | Rhythm pattern is a separate channel |
| Time-delay embedding | Serrà 2014; McFee & Ellis stack one step of history ([paper](https://archives.ismir.net/ismir2014/paper/000319.pdf)) | ×2 D | Makes single-beat matches less spurious |
| Beat-synchronous aggregation | Improves boundary precision (TISMIR review) | Mean per beat | Only valid on a trusted grid; otherwise fall back to fixed 0.5 s frames |

**Distances.** The literature uses:

- Euclidean distance on max-normalised chroma (Goto).
- A Gaussian kernel with k-NN-estimated bandwidth (McFee & Ellis).
- Cosine distance (Grill & Schlüter's SSLM).

Cosine on L2-normalised, per-track z-scored blocks is the simplest robust
choice.

**Path enhancement.** Müller & Kurth 2006 multi-angle diagonal smoothing is
implemented as `librosa.segment.path_enhance`. It convolves diagonal filters
at several slopes and takes the element-wise max, to survive tempo changes
([source](https://github.com/librosa/librosa/blob/main/librosa/segment.py);
[FMP](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S2_SSM-PathEnhancement.html)).
With a wandering beat grid, repeated sections do not produce clean
45° diagonals. That makes multi-slope smoothing (or plain fixed-time frames)
necessary.

**Transposition invariance.** Take the max over 12 cyclic chroma shifts
([FMP](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C4/C4S2_SSM-PathEnhancement.html);
Goto 2006). It costs 12× for the chroma block only.

## 4. Rhythm pattern, motif, fill, drop, and downbeat tracking

- **Bar-length rhythm patterns.**
  - Dixon, Gouyon & Widmer (ISMIR 2004) characterise music by bar-length
    patterns extracted from audio **(seen via search summary only)**.
  - [Mauch & Dixon 2012](https://ismir2012.ismir.net/event/papers/163_ISMIR_2012.pdf)
    treat bar-length drum patterns like words, over 4.8 M patterns on a grid
    of 12 divisions per beat **(search summary; paper not re-read)**.
  - This supports hashing each bar's quantised onset lanes (bass / treble /
    all) and treating recurring hashes as motifs.
- **Fill detection.** [Tamagnan & Yang 2021](https://link.springer.com/chapter/10.1007/978-3-030-70210-6_6)
  offer two methods: a learned one, and a rule-based one that calls a bar a
  fill "when a sufficient difference of notes is detected with respect to the
  adjacent bars". Both work on symbolic drums. The rule-based version maps
  directly onto hashed onset lanes. Fills "announce transitions to new
  parts", which makes them a boundary cue.
- **EDM drops.** [Yadati et al. 2014](https://archives.ismir.net/ismir2014/paper/000297.pdf)
  run Serrà's unsupervised chroma segmentation as a candidate generator
  (window 209 ms, hop 139 ms). The mean distance from drop to nearest
  boundary was **2.5 s**, with **< 8%** of drops missed. They then classify
  ±windows around candidates with an SVM on spectrogram, MFCC, and rhythm
  features. They note drops are preceded by a buildup, and evaluate with
  tolerance windows of 3–15 s. The existing `control.ts` "lurch" heuristic
  (fast energy > slow + 0.3, 4 s warm-up, 8 s cooldown) is the energy half of
  this. System 0 can supply the "at a boundary, after a buildup" half.
- **Downbeat/beat trackers:**

| System | Online? | Size | Reported | License |
| --- | --- | --- | --- | --- |
| madmom DBN | Has `online` mode for beat programs | CPU | — | Code BSD; **models CC BY-NC-SA 4.0** ([repo](https://github.com/CPJKU/madmom)) |
| BeatNet | Causal CRNN + particle filter; streaming/realtime/online modes | Not stated | "comparable to a baseline offline joint method" on GTZAN ([arXiv:2108.03576](https://arxiv.org/abs/2108.03576)) | CC-BY-4.0, but depends on madmom + pyaudio ([repo](https://github.com/mjhydri/BeatNet)) |
| BEAST | Streaming transformer, < 50 ms latency | Not stated | Beat F1 80.04, **downbeat F1 46.78** ([arXiv:2312.17156](https://arxiv.org/abs/2312.17156)) | — |
| beat_this | **Non-causal** transformer over full excerpt | ≈ 20 M / ≈ 2 M params | GTZAN beat F1 89.1, downbeat 78.3 ([arXiv:2407.21658](https://arxiv.org/abs/2407.21658)) | MIT code and weights ([repo](https://github.com/CPJKU/beat_this)) |
| All-In-One | Non-causal; Demucs stems | 300 K (46 K small) | Harmonix beat F1 .958, downbeat .915 | MIT |

Online downbeat tracking is markedly worse than offline (BEAST 46.78 vs
beat_this 78.3, on different evaluation sets). A System 0 bar hash should not
assume a correct downbeat. It should be invariant to which beat is called
"1". None of these trackers reports CPU real-time cost in the sources read,
so **their CPU feasibility on this laptop is unverified**.

## 5. Lyrics-side repetition

- **Repeated lines mark segments.**
  [Watanabe et al. 2016 (COLING)](https://aclanthology.org/C16-1184/) show
  in a large corpus study that discourse segments in lyrics correlate
  strongly with repeated patterns. They predict segment boundaries from
  repeated-pattern features.
- **Text-only SSM segmentation.**
  [Fell et al. 2018 (COLING)](https://aclanthology.org/C18-1174/) segment
  lyrics with a CNN over line-level self-similarity matrices (string,
  phonetic, syntactic).
- **Text + audio.**
  [Fell et al. 2021 (Natural Language Engineering)](https://www.cambridge.org/core/journals/natural-language-engineering/article/abs/lyrics-segmentation-via-bimodal-textaudio-representation/E54E76EE0348B48A0951365ACE66D116)
  report text-only F 67.4% on 103 k lyrics (previous best 59.2%). Adding an
  audio SSM aligned to lyric lines, on 4.8 k DALI-synchronised songs, raised
  it to **75.3%**. Text and audio capture complementary structure. This is
  the direct evidence for fusing lyric-line repetition with the audio SSM.
- **Implication.** A synced LRC gives the whole song's line repetition *before
  the song plays*. It is a non-causal prior with no audio cost:
  - Repeated line *blocks* suggest chorus spans at known timestamps.
  - A near-exact block repeat is strong evidence of the same section.
  - A missing or mis-timed LRC must degrade to "no prior".

## 6. Associative / pattern memory in interactive music systems

### Factor oracle

[Allauzen, Crochemore & Raffinot 1999 (SOFSEM)](https://link.springer.com/chapter/10.1007/3-540-47849-3_18)
define an acyclic automaton over a string of length m with m + 1 states and a
linear number of transitions. It has an online construction in linear time
and space
([summary](https://en.wikipedia.org/wiki/Factor_oracle)). Each state has one
*suffix link* to the earlier state where the longest repeated suffix ending
here was last seen.

### Audio Oracle and VMO

The Audio Oracle
([Dubnov, Assayag & Cont, ICMC 2007](https://quod.lib.umich.edu/i/icmc/bbp2372.2007.157/1))
and the Variable Markov Oracle
([Wang, Hsu & Dubnov, ISMIR 2015](https://www.ismir2015.uma.es/articles/78_Paper.pdf))
extend the factor oracle to continuous feature frames using a threshold θ.
Two frames get the same symbol if |O[i] − O[j]| ≤ θ.

The fields that matter:

- `sfx[t] = k` means the longest repeated suffix up to t "is recognized in
  k". In musical terms: *the last lrs frames we just heard already occurred,
  ending at k*.
- `lrs[t]` is that suffix's length. **Rising lrs = we are inside a repeat.
  lrs dropping to 0 = new material.**
- The VMO is "a combination of online clustering algorithms with
  variable-order Markov constraints". Its "on-line construction algorithms"
  come from the authors' earlier work.
- **θ is chosen offline** by sweeping θ and maximising Information Rate
  IR = H(xₙ) − H(xₙ | past). A θ that is too low makes every frame unique.
  A θ that is too high makes them all identical. An online System 0 must fix
  θ or adapt it. One option (my proposal): run a few oracles at different θ
  and keep the one with the highest running IR.
- The reference implementation (`wangsix/vmo`) follows suffix links and
  compares the new frame against candidate states with `cdist` under a
  threshold ([source](https://github.com/wangsix/vmo/blob/master/vmo/VMO/oracle.py)).
  It is **GPLv3**, so reimplement from the paper rather than port the code.
  MSAF also ships a `vmo` segmenter ([MSAF, MIT](https://github.com/urinieto/msaf)).

### Improvisation systems (precedent for "online memory → reactive output")

- **OMax.** A factor oracle learned in real time from a live performer,
  navigated to produce stylistically coherent recombinations
  ([IRCAM OMax](http://recherche.ircam.fr/equipes/repmus/OMax/);
  [OMax brothers, ACM AMCMM 2006](https://dl.acm.org/doi/10.1145/1178723.1178742)).
- **Continuator.** Variable-order Markov models of a performer's style,
  learned interactively
  ([Pachet, JNMR 32(3) 2003](https://www.tandfonline.com/doi/abs/10.1076/jnmr.32.3.333.16861)).
- **Somax2.** A corpus-based memory whose machine-listening modules "update
  the model in real time" and steer agent output by live input
  ([Somax2 repo](https://github.com/DYCI2/Somax2);
  [theoretical model](http://repmus.ircam.fr/_media/somax/somax-theoretical-model.pdf)).

These systems prove the pattern of incremental memory plus recall of past
material in response to the present works live, for *audio generation*. I
found no primary source applying oracle recall to *visual* look recall. That
application is this project's proposal, not established practice.

### Is an associative memory over segment embeddings needed?

Probably not at song scale. A song has on the order of 10–20 segments, so a
nearest-prototype table (cosine over segment means) is an exact associative
memory at that size **(derived)**. VMO's own description ("online
clustering" + Markov constraints) is the right level of machinery.
Hopfield-style or learned memories add nothing unless memory spans tracks.
Cross-track memory is a semantic decision the director should own (ADR-016).

## 7. Heavier learned options, and why to avoid them by default

| Model | Size | Temporal behaviour | Structure evidence | License | Verdict |
| --- | --- | --- | --- | --- | --- |
| MERT-v1-95M / 330M | 95 M / 330 M; 24 kHz; 75 Hz features; 5 s context ([HF](https://huggingface.co/m-a-p/MERT-v1-95M)) | Chunked, GPU-class | MusicFM's table: MERT-like FM1 structure HR.5 0.626 ([MusicFM paper](https://arxiv.org/abs/2311.03318)) | **CC BY-NC 4.0** | No: GPU contention, non-commercial |
| MusicFM | 330 M; 25 Hz ([repo](https://github.com/minzwon/musicfm), [paper](https://arxiv.org/abs/2311.03318)) | Chunked | README: FM4's "performance in structural analysis is subpar"; input length critical | Code MIT; weights unclear | No |
| CLAP (LAION) | HTSAT audio encoder; ≈ 10 s clips ([repo](https://github.com/LAION-AI/CLAP)) | Clip-level | Weak structure (Marmoret 2026 includes CLAP; none of the 9 models "systematically" beats baselines) | CC0 repo | Already deferred in `open-work.md` |
| Jukebox (5b) | 5 B-parameter LM; the first 36 layers fit a 12 GB GPU ([Castellon et al. 2021](https://arxiv.org/abs/2107.05677)) | Offline | Strong tagging features | — | Impossible on 6 GB alongside the sidecar |
| Ullrich/Grill CNN | Small CNN on mel ± SSLM | ≥ 6 s lookahead in peak-picking | F0.5 0.51 SALAMI ([2015](https://grrrr.org/data/pub/grill_schlueter-2015-ismir.pdf)) | Research code | Possible later, CPU, if a trained model is available **(unverified)** |
| SpecTNT | Transformer, 24 s chunks | Non-causal | HR.5F 0.570 Harmonix ([arXiv:2205.14700](https://arxiv.org/abs/2205.14700)) | No public weights found **(unverified)** | No |
| All-In-One | 300 K; needs Demucs (HT-Demucs) + NATTEN | Whole song | HR.5F .660, PWF .738 Harmonix ([arXiv:2307.16425](https://arxiv.org/abs/2307.16425)) | MIT ([repo](https://github.com/mir-aidj/all-in-one)) | Only as an optional **offline per-track cache** job, CPU, when idle |

The repo notes: 10 songs (33 min) in 73 s on an RTX 4090 + i9. Demucs cost
on a CPU-only run is **unverified**.

The 2026 embedding study is the clearest warning. Across 9 models and three
unsupervised segmenters, deep embeddings beat a barwise spectrogram baseline
"not systematically". Nearly a third underperformed it, and the best (MATPAC++)
was *below* baseline on SALAMI (F0.5 38.90 vs 40.02)
([Marmoret et al. 2026](https://arxiv.org/abs/2603.27218)). The added VRAM
buys little structure accuracy.

**Offline per-track caching** is the principled use of heavy models. The app
never has the audio file (Spotify is DRM-protected; see `loopback.ts`), so any
offline pass must run on captured loopback audio *after* a first listen, keyed
by `trackId`. A cheaper version of the same idea: cache System 0's own
per-beat feature matrix (a few tens of KB per track **(derived)**). After the
track ends, run full-song Laplacian or structure-feature segmentation over it,
so the *next* play starts with complete structure.

## 8. Evaluation resources

- **Metrics.** `mir_eval.segment` provides:
  - `detection` (hit-rate P/R/F, default window 0.5 s, `trim` option)
  - `deviation`
  - `pairwise` (frame-pair clustering F)
  - `nce` (normalised conditional entropy, over-/under-segmentation)
  - `vmeasure`
  - `evaluate`

  Inputs are interval arrays plus labels
  ([docs](https://mir-eval.readthedocs.io/latest/api/segment.html)). Standard
  reporting is F at 0.5 s and 3 s. Chorus-specific CHR.5F / CF1 follow
  [Wang et al. 2022](https://arxiv.org/abs/2205.14700).
- **Datasets:**
  - [Harmonix Set](https://github.com/urinieto/harmonixset): 912 Western pop
    tracks with beats, downbeats, and functional segments. Annotations are MIT
    licensed. Audio is *not* distributed; mel spectrograms (~1.2 GB) and
    DTW-aligned YouTube URLs are.
  - [SALAMI](https://github.com/DDMAL/salami-data-public): annotations CC0,
    in three layers (upper-case, lower-case, functions), 1–2 annotators per
    piece. No audio; matched YouTube links are provided. The TISMIR review
    counts 1,359 tracks, 884 with ≥ 2 annotations.
  - [RWC / AIST Annotation](https://staff.aist.go.jp/m.goto/RWC-MDB/AIST-Annotation/):
    copyright-cleared research audio (obtained separately), with beat and
    chorus/section annotations.
- **Ceilings to compare against:**
  - Grill & Schlüter estimate an inter-annotator upper bound of F ≈ 0.74 at
    ±0.5 s and a trivial baseline of ≈ 0.15–0.21 on their SALAMI test set
    ([2015, Table 1](https://grrrr.org/data/pub/grill_schlueter-2015-ismir.pdf)).
  - Ullrich et al. put evenly spaced boundaries at F ≈ 0.13 (±0.5 s) and
    ≈ 0.33 (±3 s)
    ([2014](https://archives.ismir.net/ismir2014/paper/000271.pdf)).

  A fixed 24 s timer is in the "evenly spaced" class. That is the baseline
  System 0 must beat.
- **Spotify sections** are themselves algorithmic estimates with a
  `confidence` field
  ([docs](https://developer.spotify.com/documentation/web-api/reference/get-audio-analysis)),
  not ground truth. Use them as a *reference system* for agreement, not as
  annotations.
- **Tooling.** [MSAF](https://github.com/urinieto/msaf) (MIT) runs Foote, SF,
  OLDA, scluster, CNMF, VMO, and 2DFMC offline with a common evaluation
  harness. That gives an "offline upper reference" on the same local audio.
  Essentia is AGPLv3 for non-commercial use, with CC BY-NC-ND models
  ([licensing](https://essentia.upf.edu/licensing_information.html)), so it
  is better avoided as a runtime dependency.

## What contradicts or complicates the proposal

1. **"Foote novelty for real section boundaries" cannot be both real-time and
   on time.** Boundaries are confirmed L beats late (§2). The design must lean
   on repetition onset, prediction from memory, and downbeat-deferred
   application.
2. **"Chorus" labels from unsupervised repetition are unreliable.** The
   max-duration heuristic scored CHR.5F 0.171 on Harmonix
   ([Wang et al. 2022](https://arxiv.org/abs/2205.14700)). Emit abstract
   segment IDs; call something "chorus" only with lyric or supervised
   evidence.
3. **Current features are not recurrence-grade.** `AutoGain`-normalised bands
   and a coarse 2048-point chroma fold must be replaced by raw log energies
   and a better-resolved chroma for the SSM (repo facts table).
4. **Beat-synchronous frames need a trusted grid.** Without Spotify, the
   fallback grid wanders (ADR-010). Bar hashing also lacks a downbeat, so it
   must be rotation-invariant (§4).
5. **Precise offline accuracy is already low.** Expect F3-class agreement at
   best, and design visual behaviour to tolerate a missed or extra boundary.
6. **Adobe's active VMO segmentation-for-visualisation patent**
   (US10074350B2) and the GPLv3 `vmo` code argue for the lag-matrix approach
   (Goto/Serrà lineage, reimplemented) as the primary mechanism, with an
   oracle as an optional research arm.
7. **An associative memory over embeddings is unnecessary at song scale.**
   Nearest-prototype matching over ≤ 20 segments is exact (§6).

## Could not verify in this pass

- FMP's exact recommended kernel sizes and feature rates. The WebFetch
  summary gave "10 Hz, L ≈ 80–100", but the page itself was not read
  line by line.
- The exact TISMIR review table values (reported via summary).
- The Dixon/Gouyon/Widmer 2004 and Mauch/Dixon 2012 grid details (search
  summaries only).
- CPU real-time factors for BeatNet, BEAST, beat_this, and Demucs on this
  laptop.
- librosa's license (ISC is believed, not checked).
- Whether SpecTNT or Grill/Schlüter weights are publicly downloadable.
- Typical section lengths (4/8/16-bar regularity) in Harmonix. The
  regularity principle is in the TISMIR review; the corpus statistics were
  not checked.
