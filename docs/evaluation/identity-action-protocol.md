# Identity/action evaluation protocol

This is an offline diagnostic protocol for grounded or emergent-world runs.
It is deliberately outside the real-time loop.

1. Capture frames at fixed section/beat positions from one song session.
   The sidecar can sample its actual output without changing the realtime
   path:

   ```powershell
   npm run app -- --eval-dir output/eval-capture --eval-every 30
   ```

   Package the resulting frames for annotation:

   ```powershell
   python tools/prepare-eval-manifest.py output/eval-capture `
     --sequence-group song-a
   ```

   This creates an explicitly `unannotated` manifest. It never invents
   identity or action labels from prompts, telemetry, or filenames.
2. Have a human annotate which frames are expected to contain the same
   persistent form. Use `identityGroup` for that correspondence claim.
3. Keep reference images separate from generated frames. A reference may be a
   pre-song anchor or an independently selected frame, never a copy of the
   frame being scored.
4. Annotate the intended action at the same timestamps. If action is
   ambiguous, omit it rather than inventing a label.
5. Preflight the capture and annotation set before loading the model:

```powershell
python tools/evaluate-world.py path/to/manifest.json --validate-only
```

Add `--out path/to/report.json` to persist the validation or model-backed
diagnostic report alongside the capture.

The preflight must report the frame/reference files as present and at least
one identity group with two or more frames before temporal identity claims are
interpretable. Every annotated identity group must have its own reference
image, and the reference path must be independent of the captured frame paths.
`actionReady` requires action labels on at least two frames in one identity
group; a single action label is descriptive evidence, not an action evaluation.

6. Run:

```powershell
python tools/evaluate-world.py docs/evaluation/identity-action-manifest.example.json `
  --model models/clip-vit-b32
```

The report contains text/action similarity, all-pairs and adjacent-frame
temporal consistency, and optional reference-image similarity. Adjacent-frame
scores are the more relevant continuity diagnostic; all-pairs scores are useful
for detecting broad identity drift across a section. The report also states
whether enough multi-frame identity evidence exists. These are evidence for
comparison between conditions, not proof of object identity, correspondence,
or narrative truth. Every report explicitly declares `evaluationMode:
diagnostic`, `identityVerified: false`, and `actionVerified: false` until a
correspondence/action evaluator with ground-truth validation is connected.

For an abstaining or emergent run where no persistent subject can be honestly
annotated, use `sequenceGroup` without `identity`, `identityGroup`, or `action`.
The evaluator will report unlabeled adjacent-frame temporal consistency while
leaving identity/action evidence unavailable. This is the correct way to record
continuity without laundering “same stream” into “same entity.” Preflight
reports `temporalReady`, `identityReady`, and `actionReady` separately; a green
temporal result does not satisfy either identity/action gate.

For a meaningful experiment, compare at least:

- continuous realization with the same-song checkpoint policy;
- an ablation with keyframes/reseeding changed;
- a procedural-only or disconnected-sidecar control;
- human ratings of persistence and action correctness.

Do not optimize only for CLIP similarity. A system can increase prompt
similarity while losing temporal coherence, motion plausibility, diversity, or
audio timing.

This separation follows the capabilities of the underlying representations:
CLIP is trained for transferable image-text alignment, not temporal
correspondence ([Radford et al., 2021](https://arxiv.org/abs/2103.00020));
self-supervised visual features such as DINOv2 are a stronger future candidate
for appearance retrieval, but still require annotated correspondence and
independent evaluation ([Oquab et al., 2023](https://arxiv.org/abs/2304.07193)).
Therefore this project treats embedding scores as diagnostics and keeps
identity/action verification outside the renderer hot path.
