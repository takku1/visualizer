"""Semantic readout for scripts/knob-experiment.py: does the painted loop still
depict its prompt, and how sharply does a blend walk cross between prompts?

CLIP ViT-B/32 (LAION, safetensors, CPU) embeds each 1 Hz frame dump and the
experiment's prompts. For every frame:

  margin = sim(frame, prompt in force) - mean sim(frame, the other prompts)

A margin that holds over minutes means the loop stays on-prompt; a margin that
decays toward 0 means semantics are liquefying even if structure holds. The
report also includes within-window variance, since a flat mean can hide mode
snapping.

For the ramp arm, `pref = sim(B) - sim(A)` is traced against blend position u
and fit with a bounded logistic. Its midpoint slope and transition width
separate a smooth morph from a basin snap.

  python scripts/clip-score.py            # after knob-experiment.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "models" / "clip-vit-b32"
OUT = ROOT / "output" / "knob-experiment"
WINDOW_S = 30


def logistic(u: np.ndarray, lo: float, hi: float, k: float, x0: float) -> np.ndarray:
    z = np.clip(k * (u - x0), -60.0, 60.0)
    return lo + (hi - lo) / (1.0 + np.exp(-z))


def fit_logistic(u: np.ndarray, y: np.ndarray) -> dict[str, float] | None:
    """Fit a monotone logistic without adding scipy to the scoring environment."""
    if len(u) < 8 or float(np.ptp(y)) < 1e-5:
        return None
    lo = float(np.mean(y[u <= 0.05]))
    hi = float(np.mean(y[u >= 0.95]))
    if abs(hi - lo) < 1e-5:
        lo, hi = float(y.min()), float(y.max())
    best = None
    for k in np.geomspace(0.5, 100.0, 80):
        for x0 in np.linspace(0.05, 0.95, 91):
            pred = logistic(u, lo, hi, float(k), float(x0))
            mse = float(np.mean((pred - y) ** 2))
            if best is None or mse < best[0]:
                best = (mse, float(k), float(x0))
    assert best is not None
    mse, k, x0 = best
    total = float(np.sum((y - y.mean()) ** 2))
    return {
        "lo": round(lo, 4), "hi": round(hi, 4),
        "midpoint_u": round(x0, 4),
        "midpoint_slope": round((hi - lo) * k / 4.0, 4),
        "steepness": round(k, 4),
        "r2": round(1.0 - mse * len(y) / (total + 1e-12), 4),
    }


def unit(out, model) -> torch.Tensor:
    """Projected, L2-normalised features. transformers 5 returns an output
    object whose pooler_output is the projection; older versions a tensor."""
    feats = out if isinstance(out, torch.Tensor) else out.pooler_output
    assert feats.shape[-1] == model.config.projection_dim, feats.shape
    return feats / feats.norm(dim=-1, keepdim=True)


def main() -> None:
    torch.set_grad_enabled(False)
    model = CLIPModel.from_pretrained(MODEL).eval()
    proc = CLIPProcessor.from_pretrained(MODEL)
    report = {}
    for arm in ("keyframes", "off", "ramp"):
        mpath = OUT / arm / "manifest.json"
        if not mpath.exists():
            continue
        m = json.loads(mpath.read_text())
        names = list(m["prompts"])
        texts = [m["prompts"][k] for k in names]
        tfeat = unit(model.get_text_features(**proc(text=texts, return_tensors="pt", padding=True, truncation=True)), model)
        frames = m["frames"]
        sims = []
        for k in range(0, len(frames), 32):
            batch = [Image.open(OUT / arm / f["file"]).convert("RGB") for f in frames[k:k + 32]]
            ifeat = unit(model.get_image_features(**proc(images=batch, return_tensors="pt")), model)
            sims.append((ifeat @ tfeat.T).numpy())
        sims = np.concatenate(sims)  # [frames, prompts]
        idx = {k: i for i, k in enumerate(names)}
        by_text = {m["prompts"][k]: k for k in names}

        if arm != "ramp":
            margins = []
            for f, s in zip(frames, sims):
                a = idx[by_text[f["prompt"]]]
                others = [s[j] for j in range(len(names)) if j != a]
                margins.append(float(s[a] - np.mean(others)))
            windows = [{"mean": round(float(np.mean(margins[w:w + WINDOW_S])), 4),
                        "std": round(float(np.std(margins[w:w + WINDOW_S])), 4)}
                       for w in range(0, len(margins), WINDOW_S)
                       if len(margins[w:w + WINDOW_S]) >= WINDOW_S // 2]
            slope = float(np.polyfit(np.arange(len(margins)) / 60.0, margins, 1)[0])  # per minute
            active_sims = [float(s[idx[by_text[f["prompt"]]]]) for f, s in zip(frames, sims)]
            report[arm] = {"margin_by_30s": windows,
                           "active_similarity_mean": round(float(np.mean(active_sims)), 4),
                           "active_similarity_std": round(float(np.std(active_sims)), 4),
                           "margin_slope_per_min": round(slope, 4),
                           "on_prompt_share": round(float(np.mean([mg > 0 for mg in margins])), 3)}
        else:
            u = np.array([f["u"] for f in frames])
            pref = sims[:, idx["B"]] - sims[:, idx["A"]]
            walk = (u > 0) & (u < 1)
            lo, hi = np.mean(pref[u == 0]), np.mean(pref[u >= 1])
            # Normalised progress of the preference across the walk, monotonised.
            prog = np.clip((pref - lo) / (hi - lo + 1e-9), 0, 1)
            uw, pw = u[walk], np.maximum.accumulate(prog[walk])
            u10 = float(uw[np.searchsorted(pw, 0.1)]) if (pw >= 0.1).any() else 1.0
            u90 = float(uw[np.searchsorted(pw, 0.9)]) if (pw >= 0.9).any() else 1.0
            report[arm] = {
                "pref_A_hold": round(float(lo), 4), "pref_B_hold": round(float(hi), 4),
                "swing": round(float(hi - lo), 4),
                "u_at_10pct": round(u10, 3), "u_at_90pct": round(u90, 3), "transition_width": round(u90 - u10, 3),
                "transition_std": round(float(np.std(pref[walk])), 4),
                "pref_by_u": [round(float(np.mean(pref[(u >= b / 10) & (u < (b + 1) / 10)])), 4) if ((u >= b / 10) & (u < (b + 1) / 10)).any() else None for b in range(10)],
            }
            # Include both plateau holds so they anchor the logistic asymptotes.
            # Fitting only the interior walk can turn a failed crossover into
            # an artificial edge at u=0 or u=1.
            fit = fit_logistic(np.clip(u, 0.0, 1.0), pref)
            if fit is not None:
                report[arm]["logistic"] = fit
    (OUT / "clip-scores.json").write_text(json.dumps(report, indent=2))
    for arm, r in report.items():
        print(f"== {arm}")
        for k, v in r.items():
            print(f"   {k}: {v}")


if __name__ == "__main__":
    main()
