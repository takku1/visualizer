# Live log review — 2026-09-22

> **Interpretation under the revised architecture:** These logs validate
> director/control plumbing only. They do not yet validate a structured scene,
> entity identity, local motion, or multimodal world continuity.

## Observed

The repository contains multiple Electron/dev sessions with JSONL decision records. Recent sessions include:

- captured loopback audio;
- DSP features including flux, band energy, stereo width, chroma-derived key, and dynamic range;
- local System One distributions;
- deterministic baseline distributions;
- the new versioned `perception` payload with `learned: null`.

The newest observed session (`session-2026-09-22T23-16-52-735Z-48431f37.jsonl`) contains four decision windows. The five most recent usable sessions contain 4, 21, 5, 9, and 28 windows respectively.

Across those sessions, System One and baseline top labels diverge frequently:

| Session windows | Motion | Palette | Texture | Geometry | Symmetry | Feedback |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 4 | 4 | 1 | 4 | 3 | 3 |
| 21 | 17 | 21 | 14 | 21 | 14 | 14 |
| 5 | 3 | 5 | 4 | 5 | 2 | 3 |
| 9 | 8 | 9 | 7 | 9 | 7 | 4 |
| 28 | 25 | 28 | 23 | 27 | 14 | 22 |

Observed local decision latency ranges from roughly 1–13 ms on these sessions.

## Interpretation

The current logs prove that the two directors are not mechanically identical. They do not prove that System One contributes better semantic structure. There is no human semantic-fit label, world-state trace, frame-time telemetry in JSONL, or causal intervention record yet.

The sessions also show `track.title` and `track.artist` as null and `hasStructure` as false. That makes them useful DSP stress tests, but not valid evidence for track-identity semantics, section identity, lyrics, or metadata-conditioned perception.

## Changes made after this review

New builds append:

- `world` to every decision record;
- `_telemetry` records approximately every five seconds with FPS, frame time, world projection, and the latest reaction-diffusion health sample.

The active session with build hash `48431f37` predates that telemetry extension. A new session must be launched from the current bundle before those fields appear.

## Next evidence

1. Run a fresh session with the new build and confirm world/telemetry records arrive.
2. Add a semantic causality harness: hold the same features and seed fixed while intervening on one world axis.
3. Run the same captured material with metadata/structure available, if the host can provide it.
4. Only then benchmark a learned audio embedding against the recorded DSP state.
