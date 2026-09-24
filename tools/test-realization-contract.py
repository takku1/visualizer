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
    "world": {"entities": [{"id": "woman", "label": "woman", "attributes": ["red coat"]}], "intent": {"form": ["organic"], "behavior": ["reaching"], "spatiality": ["deep"], "materiality": ["fibrous"], "motion": ["flowing"], "tension": ["expanding"]}, "emergent": {"hypotheses": [{"handle": "form-1", "descriptors": ["upright", "fibrous"]}]}, "visualIdentity": {"color": {"scheme": "complementary", "temperature": 0.7, "accentWeight": 0.4}, "lighting": {"direction": "side", "warmth": 0.8, "atmosphere": 0.5}}},
    "shot": {"id": "shot-1", "worldRevision": 2, "grammar": "follow"},
    "diff": {"identityBreak": False},
    "continuousForces": {"bass": 0.8},
    "legacy": {"prompt": "woman walking", "look": {}, "seed": 3, "continuity": 0.5, "spliceFrames": 16},
}

assert module.normalize_realization_request({"realization": base}) == base
compiled = module.compile_structured_prompt(base)
assert "woman" in compiled
assert "shot grammar: follow" in compiled
assert "woman walking" in compiled
assert "persistent color scheme: complementary" in compiled
assert "persistent lighting: side" in compiled
assert "perceptual form: organic" in compiled
assert "perceptual behavior: reaching" in compiled
assert "persistent emergent forms: upright, fibrous" in compiled
summary = module.structured_conditioning_summary(base, compiled)
assert summary["version"] == "structured-world-v1"
assert set(("entities", "intent", "emergent", "shot", "visualIdentity", "diff")).issubset(summary["fields"])
assert summary["entityCount"] == 1
assert len(summary["promptSha256"]) == 16
assert module.normalize_realization_request({"realization": {**base, "legacy": {"look": {}}}}) is None
assert module.normalize_realization_request({}) is None
print("realization contract ok")
