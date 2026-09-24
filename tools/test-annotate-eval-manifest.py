import importlib.util
from pathlib import Path


module_path = Path(__file__).with_name("annotate-eval-manifest.py")
spec = importlib.util.spec_from_file_location("annotate_eval_manifest", module_path)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


base = {
    "capture": {"annotationStatus": "unannotated"},
    "references": {},
    "frames": [{"file": "a.jpg"}, {"file": "b.jpg"}, {"file": "c.jpg"}],
}
updated = module.annotate(
    base,
    identity_group="form-a",
    identity="persistent form",
    identity_indices=[0, 1],
    action="moving laterally",
    action_indices=[0, 1],
    reference="reference/form-a.jpg",
)
assert updated["capture"]["annotationStatus"] == "annotated"
assert updated["references"]["form-a"] == "reference/form-a.jpg"
assert updated["frames"][1]["identityGroup"] == "form-a"
assert updated["frames"][1]["action"] == "moving laterally"

try:
    module.annotate(
        base,
        identity_group="bad",
        identity="bad",
        identity_indices=[0],
        reference="a.jpg",
    )
except ValueError as error:
    assert "independent" in str(error)
else:
    raise AssertionError("captured-frame reference should be rejected")

print("evaluation annotation contract ok")
