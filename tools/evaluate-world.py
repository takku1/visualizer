"""Opt-in frame-level identity/action evaluator.

Manifest format: {"frames": [{"file": "frame.jpg", "identity": "...",
"identityGroup": "alice", "action": "..."}],
"references": {"alice": "alice-reference.jpg"}}. It measures annotated
captures and never feeds scores back into the real-time loop. `identityGroup`
groups frames that are expected to show the same persistent entity; if omitted,
the identity text is used as the group key. Reference images are optional but
provide a stronger identity diagnostic than text-only CLIP similarity.
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
    parser.add_argument("--validate-only", action="store_true", help="check capture files and annotation coverage without loading the model")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    rows = [row for row in manifest.get("frames", []) if row.get("file")]
    if not rows:
        raise SystemExit("manifest has no frames")
    references_manifest = {str(group): path for group, path in (manifest.get("references") or {}).items() if path}
    missing_frames = [str(row["file"]) for row in rows if not (args.manifest.parent / row["file"]).is_file()]
    missing_references = [str(path) for path in references_manifest.values() if not (args.manifest.parent / path).is_file()]
    groups: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        if row.get("identity"):
            group = str(row.get("identityGroup") or row["identity"])
            groups.setdefault(group, []).append(index)
    validation = {
        "ready": not missing_frames and not missing_references and bool(groups),
        "frames": len(rows),
        "missingFrames": missing_frames,
        "missingReferences": missing_references,
        "identityGroups": {group: len(indices) for group, indices in groups.items()},
        "multiFrameIdentityGroups": sum(len(indices) >= 2 for indices in groups.values()),
        "actionAnnotatedFrames": sum(bool(row.get("action")) for row in rows),
    }
    if args.validate_only:
        print(json.dumps(validation, indent=2))
        if not validation["ready"]:
            raise SystemExit(2)
        return
    model = CLIPModel.from_pretrained(args.model).eval()
    processor = CLIPProcessor.from_pretrained(args.model)
    images = [Image.open(args.manifest.parent / row["file"]).convert("RGB") for row in rows]
    references = {
        str(group): Image.open(args.manifest.parent / path).convert("RGB")
        for group, path in (manifest.get("references") or {}).items()
        if path
    }
    texts = sorted({row[key] for row in rows for key in ("identity", "action") if row.get(key)})
    with torch.inference_mode():
        all_images = images + list(references.values())
        all_features = unit(model.get_image_features(**processor(images=all_images, return_tensors="pt")))
        text_features = unit(model.get_text_features(**processor(text=texts, return_tensors="pt", padding=True, truncation=True)))
    image_features = all_features[:len(images)]
    reference_features = all_features[len(images):]
    reference_index = {group: index for index, group in enumerate(references)}
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
    consistency: dict[str, object] = {}
    for group, indices in groups.items():
        pairwise = [
            float(image_features[a] @ image_features[b])
            for offset, a in enumerate(indices)
            for b in indices[offset + 1:]
        ]
        adjacent = [
            float(image_features[a] @ image_features[b])
            for a, b in zip(indices, indices[1:])
        ]
        consistency[group] = {
            "frames": len(indices),
            "pairs": len(pairwise),
            "meanPairwiseImageCosine": float(np.mean(pairwise)) if pairwise else None,
            "minPairwiseImageCosine": float(np.min(pairwise)) if pairwise else None,
            "adjacentPairs": len(adjacent),
            "meanAdjacentImageCosine": float(np.mean(adjacent)) if adjacent else None,
            "minAdjacentImageCosine": float(np.min(adjacent)) if adjacent else None,
            "temporalEvidence": len(adjacent) > 0,
        }
    report["identityConsistency"] = {
        "groups": consistency,
        "note": "Pairwise image embedding similarity is a diagnostic, not proof of identity.",
    }
    reference_report: dict[str, object] = {}
    for group, reference_index_value in reference_index.items():
        indices = groups.get(group, [])
        if not indices:
            continue
        scores_to_reference = [
            float(image_features[index] @ reference_features[reference_index_value])
            for index in indices
        ]
        reference_report[group] = {
            "frames": len(scores_to_reference),
            "meanReferenceImageCosine": float(np.mean(scores_to_reference)),
            "minReferenceImageCosine": float(np.min(scores_to_reference)),
            "aboveThreshold": float(np.mean(np.array(scores_to_reference) >= args.threshold)),
        }
    report["referenceIdentity"] = {
        "groups": reference_report,
        "note": "Reference-image cosine is a diagnostic for appearance similarity, not proof of temporal correspondence or identity.",
    }
    report["evidenceCoverage"] = {
        "identityGroups": len(groups),
        "multiFrameIdentityGroups": sum(len(indices) >= 2 for indices in groups.values()),
        "actionAnnotatedFrames": sum(bool(row.get("action")) for row in rows),
        "temporalIdentityEvidenceAvailable": any(len(indices) >= 2 for indices in groups.values()),
        "note": "A single frame cannot establish persistence; temporal scores require at least two annotated frames in one identity group.",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
