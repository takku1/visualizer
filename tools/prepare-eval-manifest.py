"""Build an annotation-ready manifest from an opt-in stream capture.

The sidecar writes sampled JPEGs and ``frames.jsonl`` when ``STREAM_EVAL_DIR``
is set. This tool packages that capture for ``evaluate-world.py`` without
inventing identity or action labels. Human annotation and independent
references remain required before identity/action claims are possible.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def build_manifest(capture_dir: Path, sequence_group: str = "capture") -> dict[str, Any]:
    metadata_path = capture_dir / "frames.jsonl"
    if not metadata_path.is_file():
        raise FileNotFoundError(f"missing capture metadata: {metadata_path}")

    frames: list[dict[str, Any]] = []
    for line_number, line in enumerate(metadata_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        record = json.loads(line)
        relative_file = str(record.get("file", ""))
        if not relative_file:
            raise ValueError(f"frames.jsonl line {line_number} has no file")
        image_path = capture_dir / relative_file
        if not image_path.is_file():
            raise FileNotFoundError(f"capture frame listed on line {line_number} is missing: {image_path}")
        meta = record.get("meta") if isinstance(record.get("meta"), dict) else {}
        frame: dict[str, Any] = {
            "file": relative_file,
            "sequenceGroup": sequence_group,
        }
        for key in ("t", "frame", "checkpoint", "phase", "worldDiff", "realization"):
            if key in meta:
                frame[key] = meta[key]
        frames.append(frame)

    if not frames:
        raise ValueError("capture metadata contains no frames")
    return {
        "schema": "visualizer-evaluation-v1",
        "capture": {
            "source": "stream-sidecar",
            "directory": ".",
            "sequenceGroup": sequence_group,
            "annotationStatus": "unannotated",
        },
        "references": {},
        "frames": frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_dir", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--sequence-group", default="capture")
    args = parser.parse_args()
    output = args.out or args.capture_dir / "manifest.json"
    manifest = build_manifest(args.capture_dir, args.sequence_group)
    output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(manifest['frames'])} unlabeled frames to {output}")
    print("next: annotate identityGroup/action fields and add independent references before scoring")


if __name__ == "__main__":
    main()
