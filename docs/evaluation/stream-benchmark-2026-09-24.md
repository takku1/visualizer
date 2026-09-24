# SD-Turbo continuous-stream benchmark — 2026-09-24

Hardware: NVIDIA RTX A3000 Laptop GPU, 6144 MB

Profile: `448×256`, `torch.float16`, same local SD-Turbo/TAESD backend,
150 frames, five warm-up frames excluded from the summary.

## Controlled engine benchmark

| Measure | Prior same-profile baseline | Current run |
| --- | ---: | ---: |
| Median frame time | 53.298 ms | **49.249 ms** |
| P90 frame time | 70.298 ms | **49.775 ms** |
| P95 frame time | not recorded | **50.575 ms** |
| Median throughput | 18.762 FPS | **20.305 FPS** |
| Peak VRAM | 2434.3 MB | **2434.3 MB** |
| JPEG/browser included | no | no |

The current run is approximately 7.6% faster at the median than the prior
same-profile report and has a much tighter tail. The first report in this
document used a profiler that synchronized the GPU after every measured stage;
the current report records CUDA events and synchronizes once per frame. The
improvement is therefore primarily a corrected measurement of the existing
runtime, not a claimed model speedup. This remains an engine-only result; it
does not claim the same rate for the Electron compositor or network path.

Current stage medians:

| Stage | Median | Calls |
| --- | ---: | ---: |
| VAE encode | 5.707 ms | 145 |
| UNet | 35.502 ms | 145 |
| VAE decode | 6.246 ms | 146 |

The corrected run made three text-encoder calls (initial blank conditioning,
checkpoint A, and checkpoint B) and zero cache hits. This is expected for the
benchmark's two distinct prompts; stable playback should keep ordinary frames
at zero text-encoder calls.

The UNet remains the dominant measured stage. Peak memory is unchanged, so
the current optimization has not bought speed by consuming the A3000's headroom.

## End-to-end smoke test

`npm run smoke` passed against an isolated sidecar:

- 79 calm and 79 aggressive frames received in each phase;
- stream rate 19.8 FPS, generation 49.5 ms;
- every payload passed JPEG validation;
- aggressive controls increased mean latent change from 0.0165 to 0.7195;
- checkpoint phases were observed in order: `idle → denoising → splicing → idle`;
- the keyframe completed in 134 ms while the live loop continued.

This is a protocol and causal-control smoke test, not a perceptual identity
benchmark. It proves that numeric audio pressure reaches the current
realization loop and that checkpoint work is time-sliced, but it cannot prove
that an emergent subject remains the same subject.

## Reproduction

Stop all other GPU users, then run:

```powershell
$env:STREAM_WIDTH='448'
$env:STREAM_HEIGHT='256'
npm run stream:bench -- --bench-json output/stream-bench/current.json

# In a second terminal with `npm run stream` running:
npm run smoke
```

The benchmark report is written under `output/stream-bench/`; those generated
frames and reports remain local artifacts rather than source-of-truth code.
