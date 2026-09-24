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
    "world": {"entities": [{"id": "woman", "label": "woman", "attributes": ["red coat"]}], "relation": "woman approaches train", "intent": {"form": ["organic"], "behavior": ["reaching"], "spatiality": ["deep"], "materiality": ["fibrous"], "motion": ["flowing"], "tension": ["expanding"]}, "emergent": {"hypotheses": [{"handle": "form-1", "descriptors": ["upright", "fibrous"]}]}, "visualIdentity": {"color": {"scheme": "complementary", "temperature": 0.7, "accentWeight": 0.4}, "lighting": {"direction": "side", "warmth": 0.8, "atmosphere": 0.5}}},
    "shot": {"id": "shot-1", "worldRevision": 2, "grammar": "follow"},
    "diff": {
        "identityBreak": False,
        "keep": [{"id": "platform", "label": "rainy platform"}],
        "add": [{"id": "train", "label": "approaching train"}],
        "remove": [{"id": "umbrella", "label": "umbrella"}],
        "action": {"from": "waiting", "to": "walking"},
        "camera": {"from": "wide", "to": "tracking"},
    },
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
assert "persistent relation: woman approaches train" in compiled
assert "preserve through this transition: rainy platform" in compiled
assert "introduce only at this transition: approaching train" in compiled
assert "remove only at this transition: umbrella" in compiled
assert "action transition: waiting -> walking" in compiled
assert "camera transition: wide -> tracking" in compiled
summary = module.structured_conditioning_summary(base, compiled)
assert summary["version"] == "structured-world-v1"
assert set(("entities", "intent", "emergent", "shot", "visualIdentity", "diff")).issubset(summary["fields"])
assert summary["entityCount"] == 1
assert len(summary["promptSha256"]) == 16
assert module.normalize_realization_request({"realization": {**base, "legacy": {"look": {}}}}) is None
assert module.normalize_realization_request({}) is None
control = module.Control.parse({
    "flow": 0.03, "zoom": 0.01, "glass": 0.1,
    "resonance": {"weatherIntensity": 1, "cameraImpulse": 1, "lightPulse": 1, "entityMotion": {"woman": 1}},
})
before = (control.flow, control.zoom, control.glass)
resonant = module.apply_resonance(control)
assert resonant.flow > before[0] and resonant.zoom > before[1] and resonant.glass > before[2]
assert resonant.flow <= 0.1 and resonant.glass <= 0.9
assert (control.flow, control.zoom, control.glass) == before
print("realization contract ok")
