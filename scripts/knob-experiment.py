"""Live-knob experiment (docs/live-knob-direction.md): does the procedural camera
alone keep the diffusion loop grounded with keyframe splices off, and does
prompt-blend travel read as a scene change?

Runs the real sidecar engine headless on a GPU port of the procedural scene
(infinite zoom through a warped fbm field, palette ramp, beat surges at 128 bpm)
sent through the real JPEG -> set_source path, with mapper-like controls and
network bends. Three conditions:

  keyframes  baseline: initial keyframe, reseed every 16 bars, 2 scene changes
  off        initial keyframe only; the procedural camera alone grounds the loop
  ramp       keyframes off; hold prompt A for 10 s, walk the blend linearly to
             B over 16 bars (30 s), hold B for 10 s. Slow on purpose: a basin
             snap and a smooth morph are only distinguishable on a slow walk.

Metrics per frame: structure correlation (output vs procedural luminance, the
direct *structural* grounding test), jitter (latent second difference), drift
(latent channel-mean deviation from the keyframe), colourfulness. Reported per
30 s window (480 frames at 16 fps). Frames are also dumped at 1 Hz with the
prompts in force, for the *semantic* readout in scripts/clip-score.py.

  python scripts/knob-experiment.py [--frames 4800] [--only off]
  python scripts/clip-score.py

Output goes to output/knob-experiment/.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("stream_server", ROOT / "tools" / "stream-server.py")
ss = importlib.util.module_from_spec(spec)
sys.modules["stream_server"] = ss
spec.loader.exec_module(ss)

FPS = 16.0
BPM = 128.0
WINDOW = 480  # frames = 30 s at 16 fps = 16 bars at 128 bpm
OUT = ROOT / "output" / "knob-experiment"

PROMPT_A = "a vast nebula made of swirling plasma clouds, sodium-vapor amber light, dramatic, cinematic photograph, volumetric light, rich texture, highly detailed"
PROMPT_B = "a lush bioluminescent deep-sea reef made of organic cellular membranes, chlorophyll greens, serene, cinematic photograph, rich texture, highly detailed"
PROMPT_C = "an infinite geometric lattice architecture made of crystalline shards, glacial ice blue light, dramatic, cinematic photograph, highly detailed"


class Procedural:
    """GPU stand-in for src/render/shaders/procedural.glsl."""

    def __init__(self, w: int, h: int, seed: int = 7) -> None:
        g = torch.Generator("cuda").manual_seed(seed)
        self.w, self.h = w, h

        def fbm(size: int) -> torch.Tensor:
            acc = torch.zeros(1, 1, size, size, device="cuda")
            amp = 1.0
            for cells in (6, 12, 24, 48, 96, 192):
                grid = torch.rand(1, 1, cells, cells, device="cuda", generator=g)
                acc += amp * F.interpolate(grid, size=(size, size), mode="bicubic", align_corners=False)
                amp *= 0.5
            acc = (acc - acc.min()) / (acc.max() - acc.min())
            return acc

        self.tex = fbm(1024)
        self.warp = torch.cat([fbm(256), fbm(256)], 1) - 0.5
        ys, xs = torch.meshgrid(torch.linspace(-1, 1, h, device="cuda"), torch.linspace(-1, 1, w, device="cuda"), indexing="ij")
        self.base = torch.stack([xs * (w / h), ys], -1).unsqueeze(0)  # aspect-correct coords
        self.r = torch.sqrt((xs * (w / h)) ** 2 + ys**2)
        self.palette = torch.tensor([[0.08, 0.04, 0.0], [0.95, 0.55, 0.1], [1.0, 0.9, 0.6]], device="cuda")

    def frame(self, t: float, travel: float, beat_age: float) -> tuple[bytes, np.ndarray]:
        f = travel % 1.0
        lum = torch.zeros(1, 1, self.h, self.w, device="cuda")
        wsum = 0.0
        wgrid = F.grid_sample(self.warp, self.base * 0.3 + t * 0.02, padding_mode="reflection", align_corners=False)
        for k in range(3):
            x = (k + 1 - f) / 3
            wk = math.sin(math.pi * x)
            scale = 2 ** (k - f) * 0.35
            grid = self.base * scale + wgrid.permute(0, 2, 3, 1) * 0.6
            v = F.grid_sample(self.tex, grid.clamp(-1, 1), padding_mode="reflection", align_corners=False)
            ridge = 1 - (2 * v - 1).abs()
            lum += wk * (ridge**3 * 0.8 + v * 0.35)
            wsum += wk
        lum = lum / wsum
        lum = (lum * 0.8 + torch.exp(-self.r * 1.1) * 0.35).clamp(0, 1.2)
        a, b, c = self.palette
        s1 = ((lum - 0.1) / 0.45).clamp(0, 1)
        s2 = ((lum - 0.55) / 0.45).clamp(0, 1)
        col = a.view(1, 3, 1, 1) + (b - a).view(1, 3, 1, 1) * s1
        col = col + (c.view(1, 3, 1, 1) - col) * s2
        rgb = (col[0].permute(1, 2, 0).clamp(0, 1) * 255).byte().cpu().numpy()
        ok, jpg = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        return jpg.tobytes(), gray


def colourfulness(rgb: np.ndarray) -> float:
    r, g, b = [rgb[..., i].astype(np.float32) for i in range(3)]
    rg, yb = r - g, 0.5 * (r + g) - b
    return float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean()))


def reset(e) -> None:
    e.gen.manual_seed(0)
    e.n0, e.n1 = e._randn(), e._randn()
    e.z = e.img = e.job = e.anchor = e.last_delta = e.pending = None
    e.theta = 0.0
    e.blend_target, e.blend_weights, e.blend_base = None, {}, None


def run(e, name: str, frames: int, keyframes: bool, ramp: tuple[int, int] | None = None) -> dict:
    """`ramp` = (start frame, length in frames) of a linear A -> B blend walk."""
    reset(e)
    dump = OUT / name
    dump.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    active = PROMPT_A
    proc = Procedural(ss.WIDTH, ss.HEIGHT)
    beat_period = 60.0 / BPM
    travel, push, beat_age, lurch = 0.0, 0.0, 10.0, 0.0
    rows: list[dict] = []
    thumbs = []
    keyframe_count = 0
    dt = 1 / FPS
    t0 = time.perf_counter()

    def checkpoint(prompt: str, seed: int, continuity: float, splice: int, rid: str) -> None:
        nonlocal keyframe_count, active
        keyframe_count += 1
        active = prompt
        e.request_checkpoint({"id": rid, "prompt": prompt, "seed": seed, "continuity": continuity, "spliceFrames": splice})

    for i in range(frames):
        t = i * dt
        # --- music stand-in: 128 bpm beats, a drop every ~90 s ---
        if (t % beat_period) < dt:
            push, beat_age = 1.0, 0.0
        push *= math.exp(-dt / 0.15)
        beat_age += dt
        if i > 0 and i % 1440 == 0:
            lurch = 1.0
        lurch *= math.exp(-dt / 0.4)
        energy = 0.55 + 0.25 * math.sin(t * 0.05)
        travel += dt * (0.05 + 0.18 * energy + 0.9 * push)

        # --- System 2 ---
        if i == 0:
            checkpoint(PROMPT_A, 1, 0.0, 1, "initial")
        elif keyframes:
            if i in (frames // 3, 2 * frames // 3):
                checkpoint(PROMPT_C if i == frames // 3 else PROMPT_B, 100 + i, 0.5, 30, f"scene{i}")
            elif i % WINDOW == 0:
                checkpoint(PROMPT_A if i < frames // 3 else PROMPT_C if i < 2 * frames // 3 else PROMPT_B, i, 0.6, 60, f"reseed{i}")
        u = 0.0
        if ramp is not None and i >= ramp[0]:
            # Weights follow the ramp exactly (tiny tau): the walk itself is the
            # stimulus, not the glide.
            u = min(1.0, (i - ramp[0]) / ramp[1])
            e.set_blend({"prompts": [PROMPT_A, PROMPT_B], "weights": [1.0 - u, u], "tau": 0.05})

        jpg, src_gray = proc.frame(t, travel, beat_age)
        e.set_source(jpg)
        c = ss.Control(
            strength=0.42 + 0.1 * push, noise=0.02, detail=0.05, noiseWalk=0.08, feedback=0.15,
            hue=0.5 * math.sin(t * 0.1), swell=0.25 * push, glass=0.3 if (t % (beat_period / 2)) < dt else 0.0,
            lurch=0.18 * lurch, rotate=0.05,
        )
        img, meta = e.step(c, dt)
        if img is None:
            continue
        out_gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        small_o = cv2.resize(out_gray, (144, 80)).astype(np.float32).ravel()
        small_s = cv2.resize(src_gray, (144, 80)).astype(np.float32).ravel()
        rows.append({
            "i": i, "corr": float(np.corrcoef(small_o, small_s)[0, 1]), "jitter": meta.get("jitter", 0.0),
            "change": meta.get("change", 0.0), "drift": meta.get("drift", 0.0), "colour": colourfulness(img),
            "input": meta.get("input"),
        })
        rows[-1]["u"] = u
        if i % int(FPS) == 0:
            fname = f"f{i:05d}.jpg"
            cv2.imwrite(str(dump / fname), cv2.cvtColor(cv2.resize(img, (288, 160)), cv2.COLOR_RGB2BGR))
            manifest.append({"arm": name, "i": i, "t": round(t, 2), "file": fname,
                             "prompt": active, "u": round(u, 4)})
        ramp_marks = () if ramp is None else (ramp[0] - 1, ramp[0] + ramp[1] // 4, ramp[0] + ramp[1] // 2, ramp[0] + 3 * ramp[1] // 4, ramp[0] + ramp[1])
        if i % WINDOW == WINDOW - 1 or i in ramp_marks:
            thumbs.append((i, cv2.resize(cv2.cvtColor(img, cv2.COLOR_RGB2BGR), (288, 160))))
        if i % 600 == 0:
            print(f"  [{name}] frame {i}/{frames}  {time.perf_counter() - t0:.0f}s", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    if thumbs:
        tiles = []
        for i, im in thumbs:
            im = im.copy()
            cv2.putText(im, f"{name} {i}", (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            tiles.append(im)
        while len(tiles) % 5:
            tiles.append(np.zeros_like(tiles[0]))
        cv2.imwrite(str(OUT / f"{name}.jpg"), np.vstack([np.hstack(tiles[k:k + 5]) for k in range(0, len(tiles), 5)]))

    windows = []
    for w0 in range(0, len(rows), WINDOW):
        ws = rows[w0:w0 + WINDOW]
        if len(ws) < WINDOW // 2:
            continue
        windows.append({k: round(float(np.mean([r[k] for r in ws])), 4) for k in ("corr", "jitter", "change", "drift", "colour")})
    (dump / "manifest.json").write_text(json.dumps({
        "arm": name,
        "prompts": {"A": PROMPT_A, "B": PROMPT_B, "C": PROMPT_C},
        "fps": FPS,
        "dumpHz": 1,
        "frames": manifest,
    }, indent=1))
    result = {"condition": name, "frames": len(rows), "keyframes": keyframe_count, "windows": windows,
              "inputs": sorted({r["input"] for r in rows})}
    if ramp is not None:
        # Per-frame change along the walk, binned by ramp position: a basin
        # snap would show as a spike in one bin rather than a flat profile.
        walk = [r for r in rows if ramp[0] <= r["i"] < ramp[0] + ramp[1]]
        bins = [[] for _ in range(10)]
        for r in walk:
            bins[min(9, int(r["u"] * 10))].append(r["change"])
        result["ramp_change_by_u"] = [round(float(np.mean(b)), 4) if b else None for b in bins]
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=4800)
    ap.add_argument("--only", choices=["keyframes", "off", "ramp"])
    args = ap.parse_args()
    engine = ss.Engine()
    print(f"engine ready ({engine.load_s:.1f}s), graphs: {list(engine.graphs)}", flush=True)
    results = []
    plan = [("keyframes", args.frames, True, None), ("off", args.frames, False, None), ("ramp", 800, False, (160, 480))]
    for name, frames, keyframes, ramp in plan:
        if args.only and args.only != name:
            continue
        print(f"running {name} ({frames} frames)", flush=True)
        results.append(run(engine, name, frames, keyframes, ramp))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    for r in results:
        print(f"\n== {r['condition']}: {r['frames']} frames, {r['keyframes']} keyframes, input {r['inputs']}")
        print("   window   corr   jitter  change  drift   colour")
        for k, w in enumerate(r["windows"]):
            print(f"   {k * 30:4d}s  {w['corr']:6.3f}  {w['jitter']:6.3f}  {w['change']:6.3f}  {w['drift']:6.3f}  {w['colour']:6.1f}")
        if "ramp_change_by_u" in r:
            print("   ramp: mean per-frame change by blend position u (10 bins):", r["ramp_change_by_u"])


if __name__ == "__main__":
    main()
