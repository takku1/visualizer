"""Build a fixed-shape TensorRT engine from the validated UNet ONNX graph."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx", default="output/onnx/sd-turbo-unet-448x256.onnx")
    parser.add_argument("--output", default="output/tensorrt/sd-turbo-unet-448x256.plan")
    parser.add_argument("--workspace-gb", type=float, default=2.0)
    args = parser.parse_args()

    import tensorrt as trt

    onnx_path = Path(args.onnx)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    logger = trt.Logger(trt.Logger.WARNING)
    builder = trt.Builder(logger)
    network = builder.create_network(0)
    parser = trt.OnnxParser(network, logger)
    if not parser.parse_from_file(str(onnx_path)):
        errors = [str(parser.get_error(i)) for i in range(parser.num_errors)]
        raise RuntimeError("TensorRT ONNX parse failed: " + " | ".join(errors))

    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, int(args.workspace_gb * (1 << 30)))
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError("TensorRT returned no serialized engine")
    output.write_bytes(bytes(serialized))
    print(json.dumps({
        "onnx": str(onnx_path),
        "engine": str(output),
        "bytes": output.stat().st_size,
        "workspaceGb": args.workspace_gb,
        "tensorrt": trt.__version__,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
