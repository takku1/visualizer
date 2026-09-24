"""Benchmark a fixed-shape TensorRT engine with CUDA events."""

from __future__ import annotations

import argparse
import json
import statistics
import time

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
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--iterations", type=int, default=100)
    args = parser.parse_args()

    import tensorrt as trt
    from cuda import cudart

    blob = open(args.engine, "rb").read()
    runtime = trt.Runtime(trt.Logger(trt.Logger.WARNING))
    engine = runtime.deserialize_cuda_engine(blob)
    if engine is None:
        raise RuntimeError("could not deserialize TensorRT engine")
    context = engine.create_execution_context()
    stream = check(cudart.cudaStreamCreate())
    allocations: dict[str, int] = {}
    shapes: dict[str, tuple[int, ...]] = {}
    for index in range(engine.num_io_tensors):
        name = engine.get_tensor_name(index)
        shape = tuple(int(x) for x in engine.get_tensor_shape(name))
        size = int(np.prod(shape)) * np.dtype(trt.nptype(engine.get_tensor_dtype(name))).itemsize
        allocations[name] = check(cudart.cudaMalloc(size))
        shapes[name] = shape
        context.set_tensor_address(name, allocations[name])

    def run() -> None:
        if not context.execute_async_v3(stream):
            raise RuntimeError("TensorRT enqueue failed")

    for _ in range(args.warmup):
        run()
    check(cudart.cudaStreamSynchronize(stream))
    start = check(cudart.cudaEventCreate())
    end = check(cudart.cudaEventCreate())
    samples: list[float] = []
    for _ in range(args.iterations):
        check(cudart.cudaEventRecord(start, stream))
        run()
        check(cudart.cudaEventRecord(end, stream))
        check(cudart.cudaEventSynchronize(end))
        samples.append(float(check(cudart.cudaEventElapsedTime(start, end))))

    for ptr in allocations.values():
        check(cudart.cudaFree(ptr))
    check(cudart.cudaStreamDestroy(stream))
    samples.sort()
    p95 = samples[min(len(samples) - 1, int(len(samples) * 0.95))]
    print(json.dumps({
        "engine": args.engine,
        "iterations": len(samples),
        "warmup": args.warmup,
        "medianMs": round(statistics.median(samples), 3),
        "p95Ms": round(p95, 3),
        "meanMs": round(statistics.mean(samples), 3),
        "fps": round(1000 / statistics.mean(samples), 2),
        "ioShapes": shapes,
        "wallSeconds": round(time.perf_counter(), 3),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
