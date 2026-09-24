"""Download the stream sidecar's models into models/ (~2.5 GB).

SD-Turbo (fp16 weights only) is the single UNet both loops share; TAESD is the
tiny VAE the fast loop encodes/decodes with. Chosen for a 6 GB RTX A3000 Laptop
GPU - see docs/decisions.md (ADR-003) for why not SDXS, SDXL-Turbo, or LTX.

SD-Turbo is under the Stability AI Community License (non-commercial use
without a separate license); TAESD is MIT.
"""
from pathlib import Path

from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parent.parent / "models"

snapshot_download(
    "stabilityai/sd-turbo",
    local_dir=ROOT / "sd-turbo",
    allow_patterns=[
        "model_index.json", "scheduler/*", "tokenizer/*",
        "text_encoder/config.json", "text_encoder/model.fp16.safetensors",
        "unet/config.json", "unet/diffusion_pytorch_model.fp16.safetensors",
    ],
)
snapshot_download("madebyollin/taesd", local_dir=ROOT / "taesd", allow_patterns=["config.json", "diffusion_pytorch_model.safetensors"])
print(f"models ready in {ROOT}")
