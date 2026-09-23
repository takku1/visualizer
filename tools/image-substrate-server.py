"""Sparse image substrate sidecar for the semantic visualizer.

This process is intentionally off the render loop. It turns a WorldState into
one small PNG at section/track cadence; the WebGL world remains responsible
for animation, feedback, and HD presentation.

Optional dependencies: pip install diffusers transformers accelerate torch pillow
Run with SUBSTRATE_MODEL pointing at a local model directory.
"""
from __future__ import annotations

import base64
import io
import json
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = os.environ.get("SUBSTRATE_MODEL", "models/tiny-sd")
WIDTH = int(os.environ.get("SUBSTRATE_WIDTH", "256"))
HEIGHT = int(os.environ.get("SUBSTRATE_HEIGHT", "256"))
_pipe = None
_img2img_pipe = None
_last_image = None
_generation_lock = threading.Lock()


def label(values: dict, fallback: str) -> str:
    return max(values.items(), key=lambda item: item[1])[0] if values else fallback


def make_prompt(world: dict, conditioning: dict | None = None) -> str:
    if conditioning and conditioning.get("prompt"):
        prompt = conditioning["prompt"]
        lyrics = conditioning.get("lyrics")
        return f"{prompt}, lyrical atmosphere: {lyrics}" if lyrics else prompt
    semantics = world.get("semantics", {})
    return (
        "abstract generative visual substrate, no text, no frame, no border, "
        f"{label(semantics.get('affect', {}), 'serene')} mood, "
        f"{label(semantics.get('form', {}), 'organic')} forms, "
        f"{label(semantics.get('space', {}), 'vast')} space, "
        f"{label(semantics.get('behavior', {}), 'flowing')} motion, "
        f"{label(semantics.get('abstraction', {}), 'suggestive')} abstraction, "
        "soft layered color fields, low frequency texture, cinematic, dreamlike"
    )


def pipeline():
    global _pipe
    if _pipe is None:
        import torch
        from diffusers import DiffusionPipeline

        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        device = "cuda" if torch.cuda.is_available() else "cpu"
        # Tiny-SD is small enough to load eagerly. Disabling meta-tensor lazy
        # loading avoids a device mismatch with older CUDA/PyTorch builds.
        if device == "cuda":
            # Explicit placement avoids a partially-meta pipeline on the
            # older CUDA/PyTorch stack used by this workstation.
            _pipe = DiffusionPipeline.from_pretrained(
                MODEL, torch_dtype=dtype, safety_checker=None,
                device_map="cuda", use_safetensors=False,
            )
        else:
            _pipe = DiffusionPipeline.from_pretrained(
                MODEL, torch_dtype=dtype, safety_checker=None,
                low_cpu_mem_usage=False, device_map=None,
                use_safetensors=False,
            ).to(device)
        _pipe.set_progress_bar_config(disable=True)
    return _pipe


def image_to_image_pipeline():
    global _img2img_pipe
    if _img2img_pipe is None:
        from diffusers import AutoPipelineForImage2Image
        # Reuse the already-loaded text-to-image modules. This avoids a second
        # copy of the checkpoint and makes continuation practical on the GPU.
        _img2img_pipe = AutoPipelineForImage2Image.from_pipe(pipeline())
        _img2img_pipe.set_progress_bar_config(disable=True)
    return _img2img_pipe


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "POST, OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()

    def do_POST(self) -> None:
        if self.path != "/v1/substrate":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            request = json.loads(self.rfile.read(length))
            world = request.get("world", {})
            conditioning = request.get("conditioning") or {}
            # Diffusion is intentionally serialized: concurrent first-load or
            # generation requests duplicate VRAM use and can starve the app.
            with _generation_lock:
                global _last_image
                continuity = "initial"
                if _last_image is not None:
                    try:
                        strength = float(conditioning.get("transitionStrength", 0.26))
                        image = image_to_image_pipeline()(
                            prompt=make_prompt(world, conditioning),
                            negative_prompt=conditioning.get("negativePrompt", ""),
                            image=_last_image,
                            strength=max(0.12, min(0.42, strength)),
                            num_inference_steps=2,
                            guidance_scale=0.0,
                        ).images[0]
                        continuity = "img2img"
                    except Exception as exc:
                        # Never replace a living world with an unrelated fresh
                        # text-to-image result. The browser keeps the current
                        # material when this request returns 503, and a later
                        # section update can retry continuation.
                        raise RuntimeError(f"img2img continuation rejected: {exc}") from exc
                else:
                    image = pipeline()(make_prompt(world, conditioning), num_inference_steps=1, guidance_scale=0.0, width=WIDTH, height=HEIGHT).images[0]
                if continuity == "img2img":
                    # Tiny-SD at very low step counts can occasionally jump
                    # composition even when the request succeeds. Preserve a
                    # portion of the prior state so the visual world evolves
                    # instead of flashing to a stranger and back.
                    image = Image.blend(_last_image, image.convert("RGB"), 0.68)
                _last_image = image.convert("RGB").copy()
            buffer = io.BytesIO()
            image.save(buffer, format="PNG", optimize=True)
            self._json(200, {"kind": "image", "source": MODEL, "width": image.width, "height": image.height, "continuity": continuity, "previousUsed": continuity == "img2img", "data": base64.b64encode(buffer.getvalue()).decode("ascii")})
        except Exception as exc:  # sidecar errors must not affect the renderer
            traceback.print_exc()
            self._json(503, {"error": str(exc)})

    def log_message(self, *_args) -> None:
        return


if __name__ == "__main__":
    port = int(os.environ.get("SUBSTRATE_PORT", "8766"))
    print(f"image substrate sidecar listening on http://127.0.0.1:{port} using {MODEL}", flush=True)
    # One request at a time is intentional: it keeps CUDA memory bounded and
    # ensures the pipeline is initialized on the server's main thread.
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
