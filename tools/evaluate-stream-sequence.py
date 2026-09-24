"""Measure adjacent-frame continuity for a rendered frame directory.

This is a diagnostic proxy, not an identity or action verifier. It reports
normalized pixel change and second difference so hard splices and boiling can
be compared between renderer configurations.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def percentile(values: list[float], p: float) -> float:
    return float(np.percentile(np.asarray(values, dtype=np.float32), p)) if values else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--pattern", default="frame-*.jpg")
    args = parser.parse_args()
    paths = sorted(args.directory.glob(args.pattern))
    frames: list[np.ndarray] = []
    for path in paths:
        image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if image is not None:
            frames.append(cv2.resize(image, (144, 80), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0)
    adjacent = [float(np.abs(curr - prev).mean()) for prev, curr in zip(frames, frames[1:])]
    second = [float(np.abs(curr - 2 * prev + before).mean()) for before, prev, curr in zip(frames, frames[1:], frames[2:])]
    result = {
        "evaluationMode": "diagnostic",
        "identityVerified": False,
        "actionVerified": False,
        "frames": len(frames),
        "adjacent": {"mean": float(np.mean(adjacent)) if adjacent else 0.0, "p95": percentile(adjacent, 95), "max": max(adjacent, default=0.0)},
        "secondDifference": {"mean": float(np.mean(second)) if second else 0.0, "p95": percentile(second, 95), "max": max(second, default=0.0)},
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
