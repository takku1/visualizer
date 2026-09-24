# Project context

## Rhythmic structure

**Rhythmic structure** is the complete time-organization of a track as the
visualizer can observe or infer it. It is broader than tempo or beat detection.
It includes pulse, meter, bar position, subdivisions, simultaneous rhythmic
layers, tempo interpretations, expressive feel, provenance, and confidence.

**Pulse** is a recurring temporal reference, such as a quarter-note beat. A
track may expose more than one pulse when a polyrhythm or nested subdivision is
present.

**Meter** is the grouping of pulses into bars and accents, including simple,
compound, odd, changing, and ambiguous meters.

**Subdivision** is a finer temporal grid inside a pulse or bar, such as eighths,
triplets, or sixteenths.

**Rhythmic layer** is one independently tracked stream of periodic or event
timing, such as kick, snare, hi-hat, bass phrase, or a competing metric cycle.

**Feel** is the expressive interpretation of timing, including straight,
swing, shuffle, syncopation, laid-back, pushed, and half-time/double-time
interpretation. Feel is an estimate, not a replacement for measured timing.

**Rhythmic structure is evidence-backed.** Every inferred property must retain
its source and confidence, and the renderer must degrade gracefully when only
coarse onset or spectrum evidence is available.

## Semantic direction

Song meaning follows the same evidence rule. `SongMeaning` is an optional,
versioned manifest of motifs, relations, section actions, and evidence. The
motif ledger preserves anchors; the scene compiler produces a typed shot and
fingerprint. Missing or abstained meaning falls back to metadata concepts or
abstract visual direction, never an invented narrative presented as fact.

## Persistent audiovisual world

**WorldState** is the authoritative description of what currently exists:
entities, environment, relationships, action, camera, visual state, time, and
provenance. It is not a prompt and it is not renderer memory.

The default visual mode is **emergent**: the director should prefer a typed
**PerceptualIntent** (form, behavior, spatiality, materiality, motion, light,
color, tension, affect, and continuity pressure) over authoring a literal
storyboard. Literal entities are evidence-backed anchors, not mandatory
content. **EmergentWorldHypotheses** are anonymous, confidence-bearing
observations of what the renderer appears to have formed; they are not asserted
identities until a measured observer supports that claim. **RealizationState**
is backend memory such as latents, references, masks, depth, motion, and
telemetry; it never becomes semantic truth by itself.

**SceneDiff** is the smallest evidence-backed transition proposed between two
world states. It is applied by a deterministic reducer; it does not regenerate
the entire world by default.

**Shot** describes how the current world is framed and presented. **Scene** is
the current compatibility/realization artifact compiled from world state and
shot intent. **Realization** turns that request into pixels but does not own
semantic truth.

Music acts continuously on an existing world through bounded physical forces
and emphasis. It may affect motion, lighting, atmosphere, camera energy, and
color modulation without inventing new entities on every beat.
