import importlib.util
import json
import tempfile
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("prepare-eval-manifest.py")
SPEC = importlib.util.spec_from_file_location("prepare_eval_manifest", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / "frame-0001.jpg").write_bytes(b"jpeg")
    (root / "frame-0002.jpg").write_bytes(b"jpeg")
    (root / "frames.jsonl").write_text(
        "\n".join([
            json.dumps({"file": "frame-0001.jpg", "meta": {"frame": 1, "t": 0.5, "checkpoint": "k1"}}),
            json.dumps({"file": "frame-0002.jpg", "meta": {"frame": 2, "t": 1.5, "worldDiff": {"identityBreak": False}}}),
        ]) + "\n",
        encoding="utf-8",
    )
    manifest = MODULE.build_manifest(root, "song-a")
    assert manifest["capture"]["annotationStatus"] == "unannotated"
    assert manifest["frames"][0]["sequenceGroup"] == "song-a"
    assert manifest["frames"][1]["worldDiff"]["identityBreak"] is False
    assert "identity" not in manifest["frames"][0]
    assert "action" not in manifest["frames"][0]

print("evaluation manifest preparation contract ok")
