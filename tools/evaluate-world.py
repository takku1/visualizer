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
import math
from pathlib import Path


def unit(value):
  import torch
  return value / value.norm(dim=-1, keepdim=True).clamp_min(1e-8)


def embeddings(value):
    """Normalize old and new Transformers CLIP feature return shapes."""
    import torch
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
    frame_paths = {(root / str(row["file"])).resolve() for row in rows}
    reference_frame_collisions = sorted(
        str(path) for path in references_manifest.values()
        if (root / str(path)).resolve() in frame_paths
    )
    multi_frame_identity_groups = {
        group: indices for group, indices in groups.items() if len(indices) >= 2
    }
    action_groups = {
        group: [index for index in indices if rows[index].get("action")]
        for group, indices in groups.items()
    }
    action_pairs = {
        group: sum(
            bool(rows[first].get("action")) and bool(rows[second].get("action"))
            for first, second in zip(indices, indices[1:])
        )
        for group, indices in groups.items()
    }
    direction_pairs = {
        group: sum(
            bool(rows[first].get("actionDirection")) and bool(rows[second].get("actionDirection"))
            for first, second in zip(indices, indices[1:])
        )
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
    next_steps: list[str] = []
    if missing_frames:
        next_steps.append("capture or restore every frame listed in missingFrames")
    if missing_references or missing_group_references or reference_frame_collisions:
        next_steps.append("add one independent reference image for each identity group")
    if not sequences and not groups:
        next_steps.append("add sequenceGroup labels for temporal diagnostics")
    if sequences and not groups:
        next_steps.append("annotate at least two frames with one identityGroup and add an independent reference")
    if sequences and not temporal_ready:
        next_steps.append("add at least two existing frames to one sequenceGroup")
    if groups and not identity_ready:
        next_steps.append("annotate at least two frames per identityGroup and provide independent references")
    if identity_ready and not action_ready:
        next_steps.append("label the intended action on at least two frames in one identityGroup")
    if not next_steps:
        next_steps.append("run the model-backed diagnostic and review identity/action evidence")
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
        "actionAdjacentPairs": {group: count for group, count in action_pairs.items() if count},
        "directionAdjacentPairs": {group: count for group, count in direction_pairs.items() if count},
        "evidenceReadiness": {
            "temporal": temporal_ready,
            "identity": identity_ready,
            "action": action_ready,
            "identityReferenceCoverage": float(len(groups) - len(missing_group_references)) / len(groups) if groups else 0.0,
            "actionAdjacentPairCoverage": float(sum(action_pairs.values())) / max(1, sum(max(0, len(indices) - 1) for indices in groups.values())),
            "directionAdjacentPairCoverage": float(sum(direction_pairs.values())) / max(1, sum(max(0, len(indices) - 1) for indices in groups.values())),
        },
        "nextSteps": next_steps,
    }


def optical_flow_diagnostics(rows: list[dict], root: Path, groups: dict[str, list[int]]) -> dict[str, object]:
    """Measure dense inter-frame motion as an offline action diagnostic.

    This is deliberately not an action classifier. It reports motion magnitude,
    dominant direction, and directional coherence for human-labeled sequences.
    Farneback's dense flow is useful for detecting whether an intended action
    has visible motion, but camera motion, texture, and generated artifacts can
    all confound it.
    """
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("--optical-flow requires opencv-python, numpy, and Pillow") from exc

    loaded: dict[int, object] = {}
    for index, row in enumerate(rows):
        loaded[index] = np.asarray(Image.open(root / row["file"]).convert("L"))
    report: dict[str, object] = {}
    direction_vectors = {
        "left": (-1.0, 0.0), "right": (1.0, 0.0),
        "up": (0.0, -1.0), "down": (0.0, 1.0),
    }
    for group, indices in groups.items():
        pairs: list[dict[str, float]] = []
        for first, second in zip(indices, indices[1:]):
            prev = loaded[first]
            current = loaded[second]
            flow = cv2.calcOpticalFlowFarneback(
                prev, current, None, 0.5, 3, 15, 3, 5, 1.2, 0,
            )
            magnitude, angle = cv2.cartToPolar(flow[..., 0], flow[..., 1], angleInDegrees=True)
            mean_vector = np.array([flow[..., 0].mean(), flow[..., 1].mean()])
            mean_magnitude = float(magnitude.mean())
            expected_direction = str(rows[second].get("actionDirection") or rows[first].get("actionDirection") or "")
            expected_axis = str(rows[second].get("actionAxis") or rows[first].get("actionAxis") or "")
            vector_norm = float(np.linalg.norm(mean_vector))
            direction_agreement = None
            axis_agreement = None
            if expected_direction in direction_vectors and vector_norm > 1e-8:
                expected = np.array(direction_vectors[expected_direction])
                direction_agreement = float(np.dot(mean_vector / vector_norm, expected))
            if expected_axis in {"horizontal", "vertical"} and vector_norm > 1e-8:
                dominant_axis = "horizontal" if abs(float(mean_vector[0])) >= abs(float(mean_vector[1])) else "vertical"
                axis_agreement = float(dominant_axis == expected_axis)
            pairs.append({
                "from": first,
                "to": second,
                "meanMagnitude": mean_magnitude,
                "medianMagnitude": float(np.median(magnitude)),
                "dominantDirectionDegrees": float((math.degrees(math.atan2(mean_vector[1], mean_vector[0])) + 360) % 360)
                if np.linalg.norm(mean_vector) > 1e-8 else None,
                "directionalCoherence": float(np.linalg.norm(mean_vector) / max(mean_magnitude, 1e-8)),
                "meanAngleDegrees": float(np.mean(angle)),
                "expectedDirection": expected_direction or None,
                "expectedAxis": expected_axis or None,
                "directionAgreement": direction_agreement,
                "axisAgreement": axis_agreement,
            })
        magnitudes = [pair["meanMagnitude"] for pair in pairs]
        coherences = [pair["directionalCoherence"] for pair in pairs]
        direction_scores = [pair["directionAgreement"] for pair in pairs if pair["directionAgreement"] is not None]
        axis_scores = [pair["axisAgreement"] for pair in pairs if pair["axisAgreement"] is not None]
        report[group] = {
            "frames": len(indices),
            "adjacentPairs": len(pairs),
            "meanMagnitude": float(np.mean(magnitudes)) if magnitudes else None,
            "meanDirectionalCoherence": float(np.mean(coherences)) if coherences else None,
            "directionLabeledPairs": len(direction_scores),
            "meanDirectionAgreement": float(np.mean(direction_scores)) if direction_scores else None,
            "axisLabeledPairs": len(axis_scores),
            "axisAgreementRate": float(np.mean(axis_scores)) if axis_scores else None,
            "pairs": pairs,
        }
    return {
        "sequences": report,
        "note": "Dense Farneback flow is motion evidence only; it does not identify subjects, separate camera motion, or verify an action label. Direction/axis agreement is meaningful only when human annotation supplies the expected direction or axis and remains a diagnostic.",
        "method": "Farneback-2003 dense optical flow",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--model", type=Path, default=Path("models/clip-vit-b32"))
    parser.add_argument("--threshold", type=float, default=0.2)
    parser.add_argument("--validate-only", action="store_true", help="check capture files and annotation coverage without loading the model")
    parser.add_argument("--out", type=Path, default=None, help="also write the JSON diagnostic report to this path")
    parser.add_argument("--optical-flow", action="store_true", help="add offline dense-motion diagnostics for sequence/identity groups")
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
        rendered = json.dumps(validation, indent=2)
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(rendered + "\n", encoding="utf-8")
        print(rendered)
        if not validation["ready"]:
            raise SystemExit(2)
        return
    # The preflight above intentionally has no ML dependency. Loading these
    # modules only for a real scoring run keeps annotation checks fast and
    # usable on capture/CI machines without CUDA or the vision model stack.
    import numpy as np
    import torch
    from PIL import Image
    from transformers import CLIPModel, CLIPProcessor

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
    if args.optical_flow:
        report["motionDiagnostics"] = optical_flow_diagnostics(rows, args.manifest.parent, {**sequences, **groups})
    rendered = json.dumps(report, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
