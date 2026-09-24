"""Opt-in frame-level identity/action evaluator.

Manifest format: {"frames": [{"file": "frame.jpg", "identity": "...",
"action": "..."}]}. It measures annotated captures and never feeds scores
back into the real-time loop.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor


def unit(value: torch.Tensor) -> torch.Tensor:
    return value / value.norm(dim=-1, keepdim=True).clamp_min(1e-8)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--model", type=Path, default=Path("models/clip-vit-b32"))
    parser.add_argument("--threshold", type=float, default=0.2)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    rows = [row for row in manifest.get("frames", []) if row.get("file")]
    if not rows:
        raise SystemExit("manifest has no frames")
    model = CLIPModel.from_pretrained(args.model).eval()
    processor = CLIPProcessor.from_pretrained(args.model)
    images = [Image.open(args.manifest.parent / row["file"]).convert("RGB") for row in rows]
    texts = sorted({row[key] for row in rows for key in ("identity", "action") if row.get(key)})
    with torch.inference_mode():
        image_features = unit(model.get_image_features(**processor(images=images, return_tensors="pt")))
        text_features = unit(model.get_text_features(**processor(text=texts, return_tensors="pt", padding=True, truncation=True)))
    scores = image_features @ text_features.T
    text_index = {text: index for index, text in enumerate(texts)}
    report: dict[str, object] = {"frames": len(rows), "threshold": args.threshold}
    for kind in ("identity", "action"):
        values = [float(score_row[text_index[row[kind]]]) for row, score_row in zip(rows, scores) if row.get(kind)]
        report[kind] = {
            "frames": len(values),
            "mean": float(np.mean(values)) if values else None,
            "std": float(np.std(values)) if values else None,
            "aboveThreshold": float(np.mean(np.array(values) >= args.threshold)) if values else None,
        }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
