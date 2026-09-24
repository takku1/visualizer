"""Probe the optional TensorRT installation without loading the diffusion model.

This is intentionally a capability check, not an engine export.  Exporting the
UNet is model- and operator-specific; the stream benchmark must remain the
source of truth until an exported engine is validated against the live path.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    try:
        import tensorrt as trt
    except Exception as exc:  # pragma: no cover - exercised by the CLI
        print(json.dumps({"available": False, "error": repr(exc)}))
        return 1

    result: dict[str, object] = {
        "available": True,
        "version": getattr(trt, "__version__", "unknown"),
        "python": sys.version.split()[0],
        "api": "modern" if hasattr(trt, "IBuilderConfig") else "legacy",
    }
    try:
        logger = trt.Logger(trt.Logger.WARNING)
        builder = trt.Builder(logger)
        # TensorRT 10/11 no longer exposes EXPLICIT_BATCH; 0 creates an
        # explicit-shape network in the modern API.
        network = builder.create_network(0)
        x = network.add_input("x", trt.float32, (1, 4))
        y = network.add_identity(x).get_output(0)
        y.name = "y"
        network.mark_output(y)
        config = builder.create_builder_config()
        config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 1 << 20)
        serialized = builder.build_serialized_network(network, config)
        result["builder_smoke"] = serialized is not None
        result["serialized_bytes"] = int(serialized.nbytes) if serialized is not None else 0
    except Exception as exc:  # pragma: no cover - depends on driver/runtime
        result["builder_smoke"] = False
        result["error"] = repr(exc)

    onnx_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if onnx_path is not None:
        try:
            logger = trt.Logger(trt.Logger.WARNING)
            builder = trt.Builder(logger)
            network = builder.create_network(0)
            parser = trt.OnnxParser(network, logger)
            parsed = parser.parse_from_file(str(onnx_path))
            result["onnx"] = {
                "path": str(onnx_path),
                "parsed": bool(parsed),
                "errors": [str(parser.get_error(i)) for i in range(parser.num_errors)],
            }
        except Exception as exc:  # pragma: no cover - depends on TensorRT parser
            result["onnx"] = {"path": str(onnx_path), "parsed": False, "error": repr(exc)}

    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("builder_smoke") else 2


if __name__ == "__main__":
    raise SystemExit(main())
