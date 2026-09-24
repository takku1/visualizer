"""Fast contract checks for the structured browser -> sidecar envelope."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("stream_server", Path(__file__).with_name("stream-server.py"))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

base = {
    "world": {"entities": [{"id": "woman"}]},
    "shot": {"id": "shot-1", "worldRevision": 2, "grammar": "follow"},
    "diff": {"identityBreak": False},
    "continuousForces": {"bass": 0.8},
    "legacy": {"prompt": "woman walking", "look": {}, "seed": 3, "continuity": 0.5, "spliceFrames": 16},
}

assert module.normalize_realization_request({"realization": base}) == base
assert module.normalize_realization_request({"realization": {**base, "legacy": {"look": {}}}}) is None
assert module.normalize_realization_request({}) is None
print("realization contract ok")
