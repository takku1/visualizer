# Iteration patterns and architecture implications

Updated 2026-09-25 from the ten most recent session JSONL logs and the
current source graph. This is operational evidence, not a claim that the
renderer has solved visual identity or semantic truth.

## Observed patterns

| Pattern | Evidence | Interpretation |
| --- | --- | --- |
| Continuous realization is stable | `continuous-song` was present in every recent session | The one-continuous-world-per-song invariant is working and should remain the default. |
| Capture is the unstable boundary | Seven of ten recent sessions contained a capture spike over 250 ms; older runs reached roughly 1–3.8 s | The shared GPU capture/encode path can stall the producer independently of diffusion. Treat capture as a budgeted, backpressured producer rather than a mandatory frame-loop step. |
| Semantic availability is uneven | Seven of ten sessions contained at least one lyric grounding abstention; Japanese and English tracks can acquire lyrics, but acquisition does not guarantee grounded motifs | Meaning availability must be explicit state. Rendering should continue in a perceptual-only mode without fabricating subjects. |
| Persistent world transitions are conservative | Recent live run: three tracks, zero identity breaks, one initial realization per track, later control-plane checkpoints | World state and realization state are correctly separated. Checkpoints are commits/retargets, not song segmentation. |
| Audio and semantic clocks differ | Direction decisions and control telemetry continue while lyric/meaning work is sparse | Keep audio modulation on the fast path; semantic interpretation remains asynchronous and must never block rendering. |

The analyzer intentionally reports maxima from emitted telemetry. A maximum can
remain high after a past stall, so a future health metric should also expose
the timestamp and recovery window for each stall. Do not interpret a high
historical maximum as proof that every later frame is still blocked.

## Architectural conclusion

The strongest architecture is a three-plane system with explicit budgets:

```text
audio clock       -> normalized controls -> procedural/paint modulation
semantic clock    -> evidence-gated intent -> world transition candidate
render clock      -> persistent realization -> display frame
                         ^             |
                         |             v
                    backpressure   bounded telemetry
```

1. **Control plane:** audio features and beat confidence produce smooth,
   numeric controls. A beat or onset can perturb an existing world, but cannot
   create a new semantic subject.
2. **World plane:** `WorldState`, meaning provenance, scene diffs, and
   continuity policy decide what exists and what may change. Abstention is a
   valid state, not a renderer error.
3. **Realization plane:** the current SD-Turbo path maintains the visual
   state, while procedural motion and post-processing provide cheap continuous
   response. Capture, diffusion, encode, and display are independently
   budgeted producers/consumers.

This supports the observed product invariant: one continuously evolving visual
world per song, with rare state transitions. It also explains why a fixed
scene timer is the wrong abstraction: structural changes should be event- and
confidence-gated, while ordinary frames should reuse and gently perturb the
current state.

## Research alignment

The design follows established constraints rather than assuming that a faster
prompt loop will create temporal coherence:

- Real-time beat-synchronous analysis emphasizes causal tempo/phase handling
  and beat-aligned feature aggregation for live systems ([Stark, Davies &
  Plumbley, DAFx 2009](https://www.adamstark.co.uk/pdf/papers/beat-synchronous-DAFX-2009.pdf)).
- Temporal-consistent diffusion work uses recurrent or flow-guided latent
  propagation to preserve continuity across frames, supporting persistent
  state over independent image sampling ([Upscale-A-Video, CVPR 2024]
  (https://openaccess.thecvf.com/content/CVPR2024/papers/Zhou_Upscale-A-Video_Temporal-Consistent_Diffusion_Model_for_Real-World_Video_Super-Resolution_CVPR_2024_paper.pdf)).
- Human audiovisual synchrony judgments are sensitive to audio/visual timing
  offsets, so long capture stalls are perceptually important even when the
  displayed frame rate later recovers ([Audiovisual synchrony perception in
  observing human motion to music](https://pmc.ncbi.nlm.nih.gov/articles/PMC6711538/)).

These sources support the architecture, not a claim that this repository
implements their full algorithms.

## Next measurements

The next benchmark should separate:

- capture draw time and JPEG encode time;
- diffusion generation time;
- display cadence and dropped frames;
- time from an audio onset to the first visible control response;
- time spent in semantic lookup/ASR, which must be outside the frame path.

Run it with the app and all competing GPU processes stopped. Compare a clean
baseline against the current adaptive capture backoff. The next optimization
should be chosen from those measurements, not from the historical maximum
alone.
