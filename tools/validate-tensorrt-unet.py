"""Compare a TensorRT UNet output with a deterministic PyTorch reference."""

from __future__ import annotations

import argparse
import json

import numpy as np


def check(result):
    if isinstance(result, tuple):
        err, value = result[0], result[1] if len(result) > 1 else None
    else:
        err, value = result, None
    if int(err) != 0:
        raise RuntimeError(f"CUDA error {err}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", default="output/tensorrt/sd-turbo-unet-448x256.plan")
    parser.add_argument("--reference", default="output/tensorrt/unet-reference.npz")
    args = parser.parse_args()
    import tensorrt as trt
    from cuda import cudart

    ref = np.load(args.reference)
    engine = trt.Runtime(trt.Logger(trt.Logger.WARNING)).deserialize_cuda_engine(open(args.engine, "rb").read())
    context = engine.create_execution_context()
    stream = check(cudart.cudaStreamCreate())
    allocations: dict[str, int] = {}
    output_host = None
    for index in range(engine.num_io_tensors):
        name = engine.get_tensor_name(index)
        shape = tuple(int(x) for x in engine.get_tensor_shape(name))
        dtype = np.dtype(trt.nptype(engine.get_tensor_dtype(name)))
        host = np.asarray(ref[name], dtype=dtype) if name != "epsilon" else np.empty(shape, dtype=dtype)
        allocations[name] = check(cudart.cudaMalloc(host.nbytes))
        context.set_tensor_address(name, allocations[name])
        if name != "epsilon":
            check(cudart.cudaMemcpy(allocations[name], host.ctypes.data, host.nbytes, cudart.cudaMemcpyKind.cudaMemcpyHostToDevice))
        else:
            output_host = host
    if not context.execute_async_v3(stream):
        raise RuntimeError("TensorRT enqueue failed")
    check(cudart.cudaStreamSynchronize(stream))
    assert output_host is not None
    check(cudart.cudaMemcpy(output_host.ctypes.data, allocations["epsilon"], output_host.nbytes, cudart.cudaMemcpyKind.cudaMemcpyDeviceToHost))
    expected = ref["epsilon"].astype(np.float32)
    actual = output_host.astype(np.float32)
    delta = np.abs(actual - expected)
    result = {"maxAbs": float(delta.max()), "meanAbs": float(delta.mean()), "expectedRms": float(np.sqrt(np.mean(expected * expected))), "actualRms": float(np.sqrt(np.mean(actual * actual)))}
    for ptr in allocations.values():
        check(cudart.cudaFree(ptr))
    check(cudart.cudaStreamDestroy(stream))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
