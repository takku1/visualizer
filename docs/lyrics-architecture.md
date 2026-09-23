# Dynamic lyrics architecture

> **Architecture revision:** Lyrics are semantic events and entity/world cues,
> not merely a text overlay. They may target existing regions or motifs while
> preserving world identity.

Dynamic lyrics are a realization branch of the semantic world. They are not a
subtitle layer pasted over the visualizer and they are not a new collection of
font-name questions for System One.

## Runtime pipeline

```text
LyricSource
  └─> timed LyricCue[]
        └─> LyricClock
              └─> active cue + word/character progress
                    └─> TypographyDirector
                          └─> TypographyPlan
                                ├─> readable overlay
                                ├─> glyph field/mask
                                └─> lyric memory mask
                                      └─> WorldCompositor
```

The full visual architecture becomes:

```text
                         WORLDSTATE
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       procedural base   image-model base   typography
       realization       realization        realization
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                       persistent world
```

The image model may provide the base material. Typography can remain crisp,
become a mask inside that material, or leave a persistent trace in the world.

## Contracts

```ts
export interface LyricCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words?: LyricWord[];
  source: string;
  confidence: number;
}

export interface LyricWord {
  text: string;
  start: number;
  end: number;
}

export interface LyricSource {
  readonly name: string;
  readonly configured: boolean;
  load(track: TrackContext): Promise<LyricCue[]>;
}

export type LyricsMode = 'off' | 'overlay' | 'world' | 'hybrid';

export interface LyricsConfig {
  enabled: boolean;
  mode: LyricsMode;
  opacity: number;
  readable: boolean;
  retainMemory: boolean;
}

export interface TypographyPlan {
  presence: number;
  legibility: number;
  scale: number;
  tracking: number;
  weight: number;
  delicate: number;
  monumental: number;
  handwritten: number;
  geometric: number;
  emerge: number;
  dissolve: number;
  fracture: number;
  linger: number;
  intimate: number;
  environmental: number;
  distortion: number;
  memory: number;
}
```

The plan contains semantic axes, not font names. A curated typography adapter
maps those axes to a finite font set, weight, tracking, line wrapping, glyph
layout, and mask behavior.

## Toggle architecture

The toggle is an explicit policy boundary, not a CSS visibility switch.

| Mode | Fetch lyrics | Layout text | Upload masks | Affect world state | Readable text |
| --- | --- | --- | --- | --- | --- |
| `off` | no | no | no | no | no |
| `overlay` | yes | yes | optional | no | yes |
| `world` | yes | yes | yes | yes | optional |
| `hybrid` | yes | yes | yes | yes | yes |

Required behavior:

- `off` must remove lyric fetches, layout work, glyph uploads, and lyric world
  impulses. The audio clock, world seed, and non-lyric realization must remain
  identical.
- `overlay` is the safe first visible implementation: clear, measurable, and
  easy to compare against a no-lyrics baseline.
- `world` converts lyric masks into fields/particles/feedback and may leave
  memory traces, but it must preserve a plain-text cue for accessibility and
  debugging.
- `hybrid` renders a readable anchor briefly, then allows the same cue to enter
  the world as a mask.

The public application seam should be one configuration object:

```ts
interface LyricsRuntime {
  config: LyricsConfig;
  source?: LyricSource;
  setConfig(config: LyricsConfig): void;
}
```

No downstream component should independently invent its own “lyrics enabled”
flag. The runtime owns the policy and passes an explicit `LyricsFrame` to the
overlay and world compositor.

## World interaction

The lyric branch emits typed events rather than drawing directly:

```ts
type LyricEvent =
  | { kind: 'cue-enter'; cueId: string; strength: number }
  | { kind: 'word-enter'; cueId: string; wordIndex: number; strength: number }
  | { kind: 'cue-hold'; cueId: string; progress: number }
  | { kind: 'cue-exit'; cueId: string; strength: number }
  | { kind: 'lyric-memory'; cueId: string; strength: number };
```

The world decides how an event manifests. A cue-enter event might seed a
reaction-diffusion pattern, attract particles to glyph contours, or create a
brief clean overlay depending on `LyricsMode`, `TypographyPlan`, and current
world state.

When memory is enabled, the glyph mask is downsampled and retained as a bounded
world-memory layer. Repeated lines may reuse a stable cue identity or lyric
fingerprint, allowing a chorus recurrence to inherit visual structure without
requiring the exact previous pixels to survive forever.

## Typography semantics

System One should reason over distributions such as:

```text
character: delicate .71 · monumental .12 · handwritten .31 · geometric .18
behavior:  emerge .62 · dissolve .51 · fracture .09 · linger .73
space:     intimate .67 · environmental .28
```

The adapter then derives font family, weight, size, tracking, alignment,
position, entrance, distortion, and memory. Font selection stays curated and
bounded so semantic decisions remain portable and testable.

## Rendering modes

### Overlay

Use a dedicated 2D canvas or DOM/canvas overlay for readable lyric anchors.
Layout is performed only when the active cue or typography plan changes, not
every frame. The render loop only interpolates opacity, transform, and glyph
progress.

### World mask

Rasterize the glyphs into an alpha mask, upload it as a WebGL texture, and let
the world compositor use it as a field seed, particle emitter, or distortion
source. The mask is a material input, not a finished frame.

### Hybrid

Render the first part of a cue clearly, then reduce legibility while increasing
mask/world strength. This provides the intentional semantic anchor while
preserving the visualizer's ambiguity and memory.

## Implementation order

1. Add `LyricCue`, `LyricSource`, `LyricsConfig`, and a disabled runtime.
2. Add a fixture source with WebVTT-like cues and a deterministic clock.
3. Implement `off` and `overlay`; verify disabled mode is observationally
   identical to the no-lyrics baseline.
4. Add typography semantic plans and bounded font/measurement adapters.
5. Add glyph-mask upload and `world` mode.
6. Add hybrid transitions and bounded lyric memory.
7. Connect a real lyrics provider only after the source/rights boundary is
   explicit.

## Non-goals

- karaoke word highlighting as the only experience;
- arbitrary font selection from model output;
- lyrics becoming an uncontrolled prompt to the image model;
- per-frame font layout or image-model generation;
- silently fetching lyrics when the mode is `off`;
- allowing lyric text to alter the audio clock or world seed.
