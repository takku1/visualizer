"""Do the h-space directions do what their names say, roughly linearly?

For each axis, run the live loop on the same procedural stand-in with the
strength held at -1, -0.5, 0, +0.5, +1 and measure:

  light    mean luminance of the output          (expect: rises with strength)
  energy   high-frequency energy (Laplacian var)  (expect: rises with strength)
  organic  gradient-orientation coherence         (expect: falls - fewer straight edges)

plus jitter, and the effect size per unit strength against the frame-to-frame
noise floor. A thumbnail grid goes to output/hspace-check.jpg.

  python scripts/hspace-check.py
"""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("knob_experiment", ROOT / "scripts" / "knob-experiment.py")
ke = importlib.util.module_from_spec(spec)
sys.modules["knob_experiment"] = ke
spec.loader.exec_module(ke)
ss = ke.ss

STRENGTHS = (-1.0, -0.5, 0.0, 0.5, 1.0)
FRAMES = 80


def coherence(gray: np.ndarray) -> float:
    """Structure-tensor coherence: 1 = all edges one way (hard lines), 0 = isotropic."""
    g = gray.astype(np.float32) / 255
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)
    jxx, jyy, jxy = [cv2.GaussianBlur(v, (0, 0), 3) for v in (gx * gx, gy * gy, gx * gy)]
    num = np.sqrt((jxx - jyy) ** 2 + 4 * jxy**2)
    return float(np.mean(num / (jxx + jyy + 1e-6)))


def measure(img: np.ndarray) -> dict:
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    return {"light": float(gray.mean()), "energy": float(cv2.Laplacian(gray, cv2.CV_32F).var()), "organic": coherence(gray)}


def main() -> None:
    e = ss.Engine()
    print(f"directions: {None if e.bender.directions is None else tuple(e.bender.directions.shape)}")
    rows, report = [], []
    for axis in ss.HSPACE_AXES:
        tiles, metrics = [], []
        for s in STRENGTHS:
            ke.reset(e)
            proc = ke.Procedural(ss.WIDTH, ss.HEIGHT)
            e.request_checkpoint({"id": "k", "prompt": ke.PROMPT_A, "seed": 1, "spliceFrames": 1})
            vals, jit = [], []
            for i in range(FRAMES):
                t = i / ke.FPS
                jpg, _ = proc.frame(t, t * 0.2, 10.0)
                e.set_source(jpg)
                kw = {f"hs{axis.capitalize()}": s}
                img, meta = e.step(ss.Control(strength=0.45, noise=0.02, noiseWalk=0.08, feedback=0.15, **kw), 1 / ke.FPS)
                if i >= 40:
                    vals.append(measure(img))
                    jit.append(meta["jitter"])
            m = {k: float(np.mean([v[k] for v in vals])) for k in vals[0]}
            m["jitter"] = float(np.mean(jit))
            metrics.append(m)
            tile = cv2.resize(cv2.cvtColor(img, cv2.COLOR_RGB2BGR), (230, 128))
            cv2.putText(tile, f"{axis} {s:+.1f}", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
            tiles.append(tile)
        rows.append(np.hstack(tiles))
        key = {"light": "light", "energy": "energy", "organic": "organic"}[axis]
        series = [m[key] for m in metrics]
        slope = np.polyfit(STRENGTHS, series, 1)[0]
        lin = np.corrcoef(STRENGTHS, series)[0, 1]
        report.append((axis, key, series, slope, lin, [m["jitter"] for m in metrics]))
    cv2.imwrite(str(ROOT / "output" / "hspace-check.jpg"), np.vstack(rows))
    for axis, key, series, slope, lin, jit in report:
        print(f"{axis:8s} {key} by strength {STRENGTHS}: " + " ".join(f"{v:.3f}" for v in series)
              + f"  | slope {slope:+.3f}  linearity r={lin:+.2f}  | jitter " + " ".join(f"{j:.3f}" for j in jit))


if __name__ == "__main__":
    main()
