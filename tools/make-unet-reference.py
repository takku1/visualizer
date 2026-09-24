"""Create deterministic neutral UNet inputs and a PyTorch reference output."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from diffusers import UNet2DConditionModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="models/sd-turbo")
    parser.add_argument("--output", default="output/tensorrt/unet-reference.npz")
    args = parser.parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if device.type == "cuda" else torch.float32
    model_dir = Path(args.model)
    variant = "fp16" if dtype == torch.float16 and any((model_dir / "unet").glob("*.fp16.safetensors")) else None
    model = UNet2DConditionModel.from_pretrained(model_dir / "unet", variant=variant, torch_dtype=dtype).to(device).eval()
    generator = torch.Generator(device=device).manual_seed(20260924)
    sample = torch.randn((1, 4, 32, 56), generator=generator, device=device, dtype=dtype)
    timestep = torch.tensor([500], device=device, dtype=torch.int64)
    hidden = torch.randn((1, 77, 1024), generator=generator, device=device, dtype=dtype)
    with torch.inference_mode():
        epsilon = model(sample, timestep, encoder_hidden_states=hidden).sample
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    np.savez(args.output, sample=sample.cpu().numpy(), timestep=timestep.cpu().numpy(), encoder_hidden_states=hidden.cpu().numpy(), epsilon=epsilon.float().cpu().numpy())
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
