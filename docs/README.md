# Docs

Local song meaning manifests: [../meaning/README.md](../meaning/README.md).

- [architecture.md](architecture.md) — the perception/direction/realization
  design, the loop
  math, the audio→physics table, and ownership.
- [decisions.md](decisions.md) — ADRs, including the measured model choice for
  the 6 GB RTX A3000.
- [roadmap.md](roadmap.md) — feel pass, speed, and the FiLM adapter research
  piece.
- [task-queue.md](task-queue.md) — the current ordered execution queue and
  acceptance gates.
- [rhythm-model.md](rhythm-model.md) — how beat, bar, and feel are inferred.
- [live-knob-direction.md](live-knob-direction.md) — proposal: the director
  steers model knobs continuously instead of splicing keyframes.

The previous architecture's docs (the semantic world model, world compiler,
LTX temporal backend, and lyrics/perception research) are recoverable from
`git show refs/backup/pre-stream-redesign:docs/<file>`.
