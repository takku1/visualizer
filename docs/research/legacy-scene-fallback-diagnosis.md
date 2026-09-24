# Diagnosis: legacy scene text is still visible

## Observed symptom

The Electron log contains output like:

```text
miku, within enormous flowers blooming open, made of layered rock strata,
starburst forms, monochrome black and white, stark contrast, mirror symmetric
composition, dramatic, volumetric light, cinematic photograph, volumetric light,
rich texture, highly detailed
```

## Confirmed cause

The current `meaning/` directory contains no JSON manifests, only its README.
The sidecar therefore returns `meaning: null` for the track. `core.ts` passes no
`ctx.meaning` to the director, so `sceneFromPlan()` takes its legacy branch:

```ts
semantic?.prompt ?? (subject
  ? `${subject}, within ${WORLD[plan.motion.top]}`
  : WORLD[plan.motion.top])
```

The observed fragments map directly to that branch:

| Log fragment | Current source |
| --- | --- |
| `miku` | title-derived `concepts` fallback |
| `enormous flowers blooming open` | `WORLD['bloom']` |
| `layered rock strata` | `TEXTURE['strata']` |
| `starburst forms` | `GEOMETRY['stars']` |
| `monochrome...` | `PALETTE['monochrome']` |
| `mirror symmetric composition` | `SYMMETRY['mirror']` |
| `dramatic...` | `mood(plan.intensity)` |

This was expected fallback behavior, not evidence that the manifest compiler was
being ignored. The fallback is now non-narrative and explicitly labeled in logs.

## Secondary legacy leakage

The scene compiler was hybrid. Even when `semantic?.prompt` existed, it still
appended the old texture, geometry, palette, symmetry, mood, and photographic
suffix fields. That made a semantic scene read like:

```text
semantic story prompt + legacy world styling vocabulary
```

The duplicated `volumetric light` in the observed line comes from both the
intensity mood and the fixed photographic suffix.

## Implemented correction

The fallback remains, but the compiler now has three named modes:

```text
semantic mode:
  manifest scene + renderer look/style suffix

metadata fallback:
  metadata concepts are recorded but withheld from the narrative prompt

abstract fallback:
  abstract motion vocabulary only
```

Semantic mode receives the existing visual plan as structured style parameters,
not as a second prose world. The prompt compiler deduplicates the photographic
suffix and exposes source telemetry:

```text
scene_source: semantic-manifest | metadata-fallback | abstract-fallback
meaning_revision: number | null
```

## Reproduction checklist

1. Start the local sidecar and Electron app.
2. Observe `[stream] no local song meaning; semantic direction abstains`.
3. Observe the next `[director]` line labeled `metadata-fallback` or
   `abstract-fallback`; it should not contain `within <WORLD>`.
4. Add a correctly hashed JSON manifest under `meaning/` for the active track.
5. Restart/reconnect the stream and confirm `[stream] local song meaning
   revision N`.
6. Confirm the next director line contains the manifest action/relation and no
   `within <WORLD>` phrase.

The scene-generation regression test now proves semantic, metadata, and abstract
outputs are distinct and that the full prompt has no legacy `within`/`made of`
leakage. Metadata-only output also asserts `story abstained` and excludes title
tokens. `npm run typecheck`, `npm test` (35 tests), and the production build pass.
The initial restricted-shell failure was an environment access issue, not a
product or test failure.
