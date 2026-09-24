# Music-video shot compiler

The scene prompt is a renderer input, but it should read like a shot direction,
not like a bag of visualizer tags. The compiler now emits four roles:

```text
shot      = what kind of music-video moment this is
action    = what changes over the shot
camera    = how the viewer experiences that change
treatment = palette, material, geometry, symmetry, and lighting
```

For a metadata-only track, title words are withheld from the prompt. They are not
treated as motifs or evidence of a story. The compiler supplies a story-neutral
visual action and camera move so the result still has film grammar without
claiming that the song is literally about those nouns.

For an evidence-backed `SongMeaning`, the manifest supplies the subject, relation,
environment, and section action. The same shot/action/camera/treatment structure
is used, so adding semantic evidence deepens the video instead of switching to a
different prompt language.

The procedural `Look` remains the authoritative structured control for geometry,
warp, fold, and palette. The prose treatment is a conditioning aid for the
diffusion checkpoint, not a second source of scene state.

## Current fallback grammar

```text
Music-video realization under uncertainty:
  no literal subject, event, or location is asserted.
  perceptual constraints: form / behavior / space / material / motion / tension
  preserve the dominant visual form across frames;
  audio modulates existing motion, light, and atmosphere.
  visual treatment: <palette and lighting parameters>.
```

This is intentionally not a full narrative generator. A full literal music video
requires lyrics or another evidence source, section-level story state, and
identity continuity. Perceptual constraints give the current backend a bounded
possibility space and allow imagery to emerge without smuggling unsupported nouns
into the fallback through increasingly decorative adjectives.
