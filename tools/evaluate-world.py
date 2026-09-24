"""Opt-in frame-level identity/action evaluator.

Manifest format: {"frames": [{"file": "frame.jpg", "identity": "...",
"identityGroup": "alice", "sequenceGroup": "live-track", "action": "..."}],
"references": {"alice": "alice-reference.jpg"}}. It measures annotated
captures and never feeds scores back into the real-time loop. `identityGroup`
groups frames that are expected to show the same persistent entity; if omitted,
the identity text is used as the group key. `sequenceGroup` enables an
unlabeled adjacent-frame diagnostic when no identity claim is justified.
Reference images are optional but provide a stronger identity diagnostic than
text-only CLIP similarity.
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


def embeddings(value: object) -> torch.Tensor:
    """Normalize old and new Transformers CLIP feature return shapes."""
    if isinstance(value, torch.Tensor):
        return value
    for name in ("image_embeds", "text_embeds", "pooler_output"):
        candidate = getattr(value, name, None)
        if isinstance(candidate, torch.Tensor):
            return candidate
    raise TypeError(f"unsupported CLIP feature output: {type(value).__name__}")


def validate_manifest(manifest: dict, root: Path) -> dict[str, object]:
    """Validate evidence coverage without loading a vision model."""
    rows = [row for row in manifest.get("frames", []) if row.get("file")]
    references_manifest = {str(group): path for group, path in (manifest.get("references") or {}).items() if path}
    missing_frames = [str(row["file"]) for row in rows if not (root / row["file"]).is_file()]
    missing_references = [str(path) for path in references_manifest.values() if not (root / path).is_file()]
    groups: dict[str, list[int]] = {}
    sequences: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        if row.get("identity"):
            group = str(row.get("identityGroup") or row["identity"])
            groups.setdefault(group, []).append(index)
        if row.get("sequenceGroup"):
            sequences.setdefault(str(row["sequenceGroup"]), []).append(index)

    missing_group_references = sorted(group for group in groups if group not in references_manifest)
    frame_paths = {str(row["file"]) for row in rows}
    reference_frame_collisions = sorted(
        str(path) for path in references_manifest.values() if str(path) in frame_paths
    )
    multi_frame_identity_groups = {
        group: indices for group, indices in groups.items() if len(indices) >= 2
    }
    action_groups = {
        group: [index for index in indices if rows[index].get("action")]
        for group, indices in groups.items()
    }
    temporal_ready = not missing_frames and any(len(indices) >= 2 for indices in sequences.values())
    identity_ready = (
        not missing_frames
        and not missing_references
        and not missing_group_references
        and not reference_frame_collisions
        and bool(groups)
        and all(len(indices) >= 2 for indices in groups.values())
    )
    action_ready = identity_ready and any(len(indices) >= 2 for indices in action_groups.values())
    return {
        "ready": temporal_ready or identity_ready,
        "evaluationMode": "diagnostic",
        "identityVerified": False,
        "actionVerified": False,
        "temporalReady": temporal_ready,
        "identityReady": identity_ready,
        "actionReady": action_ready,
        "frames": len(rows),
        "missingFrames": missing_frames,
        "missingReferences": missing_references,
        "missingGroupReferences": missing_group_references,
        "referenceFrameCollisions": reference_frame_collisions,
        "identityGroups": {group: len(indices) for group, indices in groups.items()},
        "sequenceGroups": {group: len(indices) for group, indices in sequences.items()},
        "multiFrameIdentityGroups": len(multi_frame_identity_groups),
        "actionAnnotatedFrames": sum(bool(row.get("action")) for row in rows),
        "actionGroups": {group: len(indices) for group, indices in action_groups.items() if indices},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--model", type=Path, default=Path("models/clip-vit-b32"))
    parser.add_argument("--threshold", type=float, default=0.2)
    parser.add_argument("--validate-only", action="store_true", help="check capture files and annotation coverage without loading the model")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    validation = validate_manifest(manifest, args.manifest.parent)
    rows = [row for row in manifest.get("frames", []) if row.get("file")]
    if not rows:
        raise SystemExit("manifest has no frames")
    references_manifest = {str(group): path for group, path in (manifest.get("references") or {}).items() if path}
    missing_frames = validation["missingFrames"]
    missing_references = validation["missingReferences"]
    groups: dict[str, list[int]] = {}
    sequences: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        if row.get("identity"):
            group = str(row.get("identityGroup") or row["identity"])
            groups.setdefault(group, []).append(index)
        if row.get("sequenceGroup"):
            sequences.setdefault(str(row["sequenceGroup"]), []).append(index)
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
        all_features = unit(embeddings(model.get_image_features(**processor(images=all_images, return_tensors="pt"))))
        text_features = unit(embeddings(model.get_text_features(**processor(text=texts, return_tensors="pt", padding=True, truncation=True)))) if texts else None
    image_features = all_features[:len(images)]
    reference_features = all_features[len(images):]
    reference_index = {group: index for index, group in enumerate(references)}
    scores = image_features @ text_features.T if text_features is not None else None
    text_index = {text: index for index, text in enumerate(texts)}
    report: dict[str, object] = {"frames": len(rows), "threshold": args.threshold}
    report["evaluationMode"] = "diagnostic"
    # These remain false by design: CLIP alignment and image cosine are
    # comparison signals, not a correspondence/ground-truth evaluator.
    report["identityVerified"] = False
    report["actionVerified"] = False
    for kind in ("identity", "action"):
        values = [float(score_row[text_index[row[kind]]]) for row, score_row in zip(rows, scores) if row.get(kind)] if scores is not None else []
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
    sequence_consistency: dict[str, object] = {}
    for group, indices in sequences.items():
        adjacent = [float(image_features[a] @ image_features[b]) for a, b in zip(indices, indices[1:])]
        sequence_consistency[group] = {
            "frames": len(indices),
            "adjacentPairs": len(adjacent),
            "meanAdjacentImageCosine": float(np.mean(adjacent)) if adjacent else None,
            "minAdjacentImageCosine": float(np.min(adjacent)) if adjacent else None,
            "temporalEvidence": len(adjacent) > 0,
        }
    report["temporalConsistency"] = {
        "sequences": sequence_consistency,
        "note": "Unlabeled adjacent-frame similarity measures visual continuity only; it does not establish identity or action.",
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
        "actionGroups": validation["actionGroups"],
        "temporalIdentityEvidenceAvailable": any(len(indices) >= 2 for indices in groups.values()),
        "temporalSequenceEvidenceAvailable": any(len(indices) >= 2 for indices in sequences.values()),
        "temporalReady": validation["temporalReady"],
        "identityReady": validation["identityReady"],
        "actionReady": validation["actionReady"],
        "note": "A single frame cannot establish persistence; temporal scores require at least two annotated frames in one identity group. Verification remains false until a correspondence/action evaluator is connected.",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
