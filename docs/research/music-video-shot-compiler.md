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
Music-video shot: story abstained; no evidence-backed song event is asserted.
Action: <story-neutral motion phrase>.
Camera: <shot movement>.
Visual treatment: <style parameters>.
```

This is intentionally not a full narrative generator. A full music video requires
lyrics or another evidence source, section-level story state, and identity
continuity. Those remain separate upstream work rather than being smuggled into
the fallback through increasingly decorative adjectives.
