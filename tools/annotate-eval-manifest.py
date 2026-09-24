"""Apply explicit human labels to an evaluation manifest.

This tool never infers labels. Every identity/action value comes from a CLI
argument supplied after inspecting the captured frames.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_indices(value: str, size: int) -> list[int]:
    indices = sorted({int(part.strip()) for part in value.split(",") if part.strip()})
    invalid = [index for index in indices if index < 0 or index >= size]
    if invalid:
        raise ValueError(f"frame indices out of range: {invalid}; manifest has {size} frames")
    return indices


def annotate(
    manifest: dict,
    *,
    identity_group: str | None = None,
    identity: str | None = None,
    identity_indices: list[int] | None = None,
    action: str | None = None,
    action_indices: list[int] | None = None,
    reference: str | None = None,
) -> dict:
    frames = manifest.get("frames")
    if not isinstance(frames, list) or not frames:
        raise ValueError("manifest has no frames")
    if identity_group or identity or identity_indices or reference:
        if not (identity_group and identity and identity_indices and reference):
            raise ValueError("identity annotation requires --identity-group, --identity, --identity-indices, and --reference")
        reference_path = str(reference)
        if reference_path in {str(frame.get("file")) for frame in frames}:
            raise ValueError("reference must be independent of every captured frame")
        manifest.setdefault("references", {})[identity_group] = reference_path
        for index in identity_indices:
            frames[index]["identityGroup"] = identity_group
            frames[index]["identity"] = identity
    if action or action_indices:
        if not (action and action_indices):
            raise ValueError("action annotation requires --action and --action-indices")
        for index in action_indices:
            frames[index]["action"] = action
    manifest.setdefault("capture", {})["annotationStatus"] = "annotated"
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--identity-group")
    parser.add_argument("--identity")
    parser.add_argument("--identity-indices", help="comma-separated zero-based frame indices")
    parser.add_argument("--action")
    parser.add_argument("--action-indices", help="comma-separated zero-based frame indices")
    parser.add_argument("--reference")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    size = len(manifest.get("frames", []))
    updated = annotate(
        manifest,
        identity_group=args.identity_group,
        identity=args.identity,
        identity_indices=parse_indices(args.identity_indices, size) if args.identity_indices else None,
        action=args.action,
        action_indices=parse_indices(args.action_indices, size) if args.action_indices else None,
        reference=args.reference,
    )
    args.manifest.write_text(json.dumps(updated, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"updated {args.manifest}; labels are explicit and require independent reference validation")


if __name__ == "__main__":
    main()
