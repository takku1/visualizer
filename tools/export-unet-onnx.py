"""Export the fixed realtime SD-Turbo UNet for an isolated benchmark.

This is deliberately opt-in. It does not change the live sidecar and does not
claim that the exported graph preserves Bender's activation edits. The output
is a candidate artifact for ONNX/TensorRT validation only.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=os.environ.get("STREAM_MODEL", "models/sd-turbo"))
    parser.add_argument("--output", default="output/onnx/sd-turbo-unet-448x256.onnx")
    parser.add_argument("--height", type=int, default=256)
    parser.add_argument("--width", type=int, default=448)
    parser.add_argument("--opset", type=int, default=17)
    args = parser.parse_args()

    import torch
    from diffusers import UNet2DConditionModel

    model_dir = Path(args.model)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    variant = "fp16" if dtype == torch.float16 and any((model_dir / "unet").glob("*.fp16.safetensors")) else None
    unet = UNet2DConditionModel.from_pretrained(model_dir / "unet", variant=variant, torch_dtype=dtype).eval()
    latent_h, latent_w = args.height // 8, args.width // 8
    sample = torch.zeros((1, 4, latent_h, latent_w), dtype=dtype)
    timestep = torch.tensor([500], dtype=torch.int64)
    hidden = torch.zeros((1, 77, int(unet.config.cross_attention_dim)), dtype=dtype)

    class Wrapper(torch.nn.Module):
        def __init__(self, inner: torch.nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, sample: torch.Tensor, timestep: torch.Tensor, encoder_hidden_states: torch.Tensor) -> torch.Tensor:
            return self.inner(sample, timestep, encoder_hidden_states=encoder_hidden_states).sample

    wrapper = Wrapper(unet)
    torch.onnx.export(
        wrapper,
        (sample, timestep, hidden),
        str(output),
        input_names=["sample", "timestep", "encoder_hidden_states"],
        output_names=["epsilon"],
        opset_version=args.opset,
        do_constant_folding=True,
        # The sidecar currently runs torch 2.13; the newer dynamo exporter
        # requires onnxscript and is not needed for this fixed-shape probe.
        dynamo=False,
        dynamic_axes=None,
    )
    print(json.dumps({
        "output": str(output),
        "shape": [1, 4, latent_h, latent_w],
        "conditioning": [1, 77, int(unet.config.cross_attention_dim)],
        "dtype": str(dtype),
        "opset": args.opset,
        "bender": False,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
