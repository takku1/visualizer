# Lightweight model strategy

> **Architecture revision:** Models render or update a structured world; they
> do not own identity. See [architecture.md](architecture.md).

## Recommendation

The model stack now has three distinct adapters: slow multimodal perception,
structured spatial perception (masks/tracks/pose/depth), and model-specific
realization. Keeping these separate prevents an image generator from being
asked to solve identity tracking and music interpretation at the same time.

Set up the model seam now, but do not make model weights a runtime requirement yet.

The useful model stack has two adapters: a slow multimodal perception adapter
and a model-specific latent realization adapter. Perception inspects track
metadata, artwork, lyrics, and audio; realization translates WorldState into
supported latent/attention/control tensors. Neither should be called once per
animation frame.

```text
track / section inputs
        |
        v
optional perception adapter
        |
        v
typed semantic targets + confidence
        |
        v
persistent WorldModel
        |
        v
persistent latent/video world
        |
        v
WebGL2 display at frame rate
```

## Contract

The adapter should eventually have a narrow interface equivalent to:

```ts
interface PerceptionAdapter {
  readonly name: string;
  readonly configured: boolean;
  perceive(input: PerceptionInput): Promise<PerceptionResult>;
}
```

`PerceptionResult` must carry provenance, confidence, latency, and the complete distribution or embedding version. If the adapter is unavailable or slow, the local DSP-derived world target remains authoritative.

## What to model first

The first learned signal should answer questions that DSP cannot answer well:

- what the track resembles;
- whether the artwork and music suggest organic, synthetic, intimate, or vast material;
- whether a section continues the existing visual identity or deserves a semantic turn.

Do not spend the first model experiment predicting renderer uniforms. That would preserve the old shallow interface under a new model.

## Cadence and fallback

- Track-level perception: once when the track changes.
- Section-level perception: at boundaries or on a several-second budget.
- Beat-level response: deterministic event impulses only.
- Frame-level rendering: no model calls.

The model is an enhancement adapter. It must be possible to disable it, replay recorded results, and compare it against the deterministic baseline with identical renderer settings.

## Model selection criteria

Choose the smallest model that is:

1. fast enough for section-scale use on the target machine;
2. usable from the project’s actual runtime or an isolated localhost sidecar;
3. able to provide stable embeddings or calibrated enough scores;
4. cheap enough to run repeatedly during evaluation;
5. replaceable without changing `WorldModel` or the renderer.

The initial checkpoint is MERT-v1-95M behind the localhost adapter in
`tools/audio-perception-server.py`. It is selected as a replaceable bootstrap
because it is music-pretrained and emits a stable embedding, not because it is
already proven to improve the visual A/B result. The evaluation harness and
real-track evidence remain the benchmark gate.
