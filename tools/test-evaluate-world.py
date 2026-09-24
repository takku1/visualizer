"""Regression checks for identity/action evidence preflight."""
from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("evaluate_world", Path(__file__).with_name("evaluate-world.py"))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / "a.jpg").write_bytes(b"a")
    (root / "b.jpg").write_bytes(b"b")
    (root / "ref.jpg").write_bytes(b"ref")

    base = {
        "references": {"form-a": "ref.jpg"},
        "frames": [
            {"file": "a.jpg", "identity": "form", "identityGroup": "form-a", "action": "flowing"},
            {"file": "b.jpg", "identity": "form", "identityGroup": "form-a", "action": "flowing"},
        ],
    }
    valid = module.validate_manifest(base, root)
    assert valid["evaluationMode"] == "diagnostic"
    assert valid["identityVerified"] is False
    assert valid["actionVerified"] is False
    assert valid["identityReady"] is True
    assert valid["actionReady"] is True
    assert valid["nextSteps"] == ["run the model-backed diagnostic and review identity/action evidence"]

    missing_reference = module.validate_manifest({**base, "references": {}}, root)
    assert missing_reference["identityReady"] is False
    assert missing_reference["missingGroupReferences"] == ["form-a"]
    assert "independent reference" in missing_reference["nextSteps"][0]

    temporal_only = module.validate_manifest({
        "frames": [
            {"file": "a.jpg", "sequenceGroup": "track"},
            {"file": "b.jpg", "sequenceGroup": "track"},
        ],
    }, root)
    assert "identityGroup" in temporal_only["nextSteps"][0]

    colliding_reference = module.validate_manifest({**base, "references": {"form-a": "a.jpg"}}, root)
    assert colliding_reference["identityReady"] is False
    assert colliding_reference["referenceFrameCollisions"] == ["a.jpg"]

    one_action = module.validate_manifest({**base, "frames": [base["frames"][0], {**base["frames"][1], "action": None}]}, root)
    assert one_action["identityReady"] is True
    assert one_action["actionReady"] is False

print("world evaluation preflight contract ok")
