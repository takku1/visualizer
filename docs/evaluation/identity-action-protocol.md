# Identity/action evaluation protocol

This is an offline diagnostic protocol for grounded or emergent-world runs.
It is deliberately outside the real-time loop.

1. Capture frames at fixed section/beat positions from one song session.
2. Have a human annotate which frames are expected to contain the same
   persistent form. Use `identityGroup` for that correspondence claim.
3. Keep reference images separate from generated frames. A reference may be a
   pre-song anchor or an independently selected frame, never a copy of the
   frame being scored.
4. Annotate the intended action at the same timestamps. If action is
   ambiguous, omit it rather than inventing a label.
5. Run:

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
or narrative truth.

For a meaningful experiment, compare at least:

- continuous realization with the same-song checkpoint policy;
- an ablation with keyframes/reseeding changed;
- a procedural-only or disconnected-sidecar control;
- human ratings of persistence and action correctness.

Do not optimize only for CLIP similarity. A system can increase prompt
similarity while losing temporal coherence, motion plausibility, diversity, or
audio timing.
