# Dynamic lyrics realization research

> **Architecture revision:** Lyrics can emit semantic events targeting existing
> world entities and regions. Text remains an optional presentation branch.

## Summary

Dynamic lyrics should be treated as a timed semantic realization branch, not
as a subtitle overlay. The lyric source supplies text and timing; the existing
world state supplies the visual behavior; a typography adapter turns that
combination into crisp glyphs, masks, fields, and persistent traces.

## Findings

### Timing format

WebVTT is the best interchange boundary for timed lyric cues. The W3C format
defines cues with start and end timestamps, text payloads, optional identifiers,
and positioning settings. Cues may overlap, which is useful for backing vocals,
echoes, translations, or a line that persists while the next line begins.
[W3C WebVTT presentation](https://www.w3.org/AudioVideo/WebVTT-presentation.html)
and the [WebVTT specification](https://www.w3.org/TR/webvtt/all/) define these
semantics.

The internal runtime should normalize every source into the same model rather
than depend on WebVTT at every boundary. An LRC importer, a provider-specific
lyrics adapter, or a hand-authored cue file can all produce the same timed cue
objects.

### Typography measurement

Typography layout must be measured after the selected font is available. The
browser `FontFaceSet.load()` API returns a promise that resolves when requested
fonts are loaded, and accepts sample text for the load request. This supports a
font-cache gate before generating glyph masks.
[MDN FontFaceSet.load](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/load)

Canvas `measureText()` returns `TextMetrics`, including text width, so the
adapter can fit lines to a composition region without guessing from character
count.
[MDN measureText](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText)

### GPU realization

The existing WebGL path can accept lyric masks as textures. WebGL's
`texImage2D()` accepts an `ImageBitmap` source, which allows glyph masks to be
rasterized asynchronously and uploaded without putting font layout inside the
shader.
[MDN texImage2D](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D)

The lyric branch should therefore produce one of three artifacts:

- a crisp overlay texture for legible text;
- a glyph mask that can seed flow, reaction-diffusion, or particles;
- a low-opacity memory mask retained after the main line dissolves.

### Accessibility and safety

The system should keep a plain-text lyric representation even when the visual
realization is distorted. Lyric payloads must be treated as text, never as
HTML, and should be sanitized before entering any DOM overlay. The visual
effect must be independently disableable so the visualizer can run without
lyrics, without fetching lyric content, or without rendering readable text.

## Architectural conclusion

Lyrics belong beside procedural and image-model realization, downstream of the
semantic waist:

```text
timed lyric source ─┐
audio perception ───┼──> PerceptualState + WorldState
metadata/artwork ──┘             │
                         TypographyDirector
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
                 overlay       glyph mask      memory mask
                    │             │             │
                    └─────────────┼─────────────┘
                                  ▼
                           world compositor
```

Lyrics are an optional input and an optional realization. Neither absence of
lyrics nor disabling the realization may change the audio clock, world seed,
or procedural/image-model state.

## Source and rights boundary

The architecture should accept lyrics only through an explicit
`LyricSource` adapter. It must not assume that a provider-specific lyrics
endpoint is stable, authorized, or suitable for redistribution. Provider
integration, caching, and licensing are separate decisions from typography
rendering.
