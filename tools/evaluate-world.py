"""Opt-in frame-level identity/action evaluator.

Manifest format: {"frames": [{"file": "frame.jpg", "identity": "...",
"identityGroup": "alice", "action": "..."}]}. It measures annotated
captures and never feeds scores back into the real-time loop. `identityGroup`
groups frames that are expected to show the same persistent entity; if omitted,
the identity text is used as the group key.
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
    groups: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        if row.get("identity"):
            group = str(row.get("identityGroup") or row["identity"])
            groups.setdefault(group, []).append(index)
    consistency: dict[str, object] = {}
    for group, indices in groups.items():
        pairwise = [
            float(scores[a, text_index[rows[a]["identity"]]] * 0 + image_features[a] @ image_features[b])
            for offset, a in enumerate(indices)
            for b in indices[offset + 1:]
        ]
        consistency[group] = {
            "frames": len(indices),
            "pairs": len(pairwise),
            "meanPairwiseImageCosine": float(np.mean(pairwise)) if pairwise else None,
            "minPairwiseImageCosine": float(np.min(pairwise)) if pairwise else None,
        }
    report["identityConsistency"] = {
        "groups": consistency,
        "note": "Pairwise image embedding similarity is a diagnostic, not proof of identity.",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
