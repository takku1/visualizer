"""Optional local audio-native perception provider backed by MERT.

Dependencies: pip install torch transformers
The first run downloads the MERT-v1-95M checkpoint from Hugging Face unless it
is already cached. The model is music-pretrained and expects 24 kHz mono audio;
the browser sends a recent 16 kHz mono loopback window and this sidecar resamples
it before inference.

Run from the repository root:
  python tools/audio-perception-server.py
Then configure `perceptionUrl` to:
  http://127.0.0.1:8767/v1/audio-perception
"""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import torch
import torch.nn.functional as F
from transformers import AutoFeatureExtractor, AutoModel


HOST = "127.0.0.1"
PORT = int(os.environ.get("PERCEPTION_PORT", "8767"))
MODEL_NAME = os.environ.get("PERCEPTION_MODEL", "m-a-p/MERT-v1-95M")
MODEL_REVISION = os.environ.get("PERCEPTION_REVISION", "12af15fef9d0ac838c3f475bfbbf26d2060dd4f5")
INPUT_RATE = 16000
MODEL_RATE = 24000
MAX_BYTES = 4 * 1024 * 1024

print(f"loading audio-native perception encoder: {MODEL_NAME}")
EXTRACTOR = AutoFeatureExtractor.from_pretrained(MODEL_NAME, revision=MODEL_REVISION, trust_remote_code=True)
MODEL = AutoModel.from_pretrained(MODEL_NAME, revision=MODEL_REVISION, trust_remote_code=True)
MODEL.eval()
INFERENCE_LOCK = threading.Lock()


def resample(samples: list[float], source_rate: int) -> torch.Tensor:
    if not samples:
        raise ValueError("audio.samples must not be empty")
    waveform = torch.tensor(samples, dtype=torch.float32).clamp(-1, 1).view(1, 1, -1)
    if source_rate != MODEL_RATE:
        length = round(waveform.shape[-1] * MODEL_RATE / source_rate)
        waveform = F.interpolate(waveform, size=length, mode="linear", align_corners=False)
    waveform = waveform[0, 0, -MODEL_RATE * 5:]
    return waveform


@torch.inference_mode()
def embed(audio: dict[str, Any]) -> list[float]:
    samples = audio.get("samples")
    if not isinstance(samples, list):
        raise ValueError("audio.samples must be an array")
    sample_rate = int(audio.get("sampleRate", INPUT_RATE))
    if sample_rate <= 0 or sample_rate > 192000:
        raise ValueError("audio.sampleRate is out of range")
    waveform = resample(samples, sample_rate)
    inputs = EXTRACTOR(waveform.numpy(), sampling_rate=MODEL_RATE, return_tensors="pt")
    with INFERENCE_LOCK:
        output = MODEL(**inputs)
    hidden = getattr(output, "last_hidden_state", None)
    if hidden is None:
        raise ValueError("audio model returned no last_hidden_state")
    vector = torch.nn.functional.normalize(hidden.mean(dim=1)[0], p=2, dim=0)
    return [round(float(value), 7) for value in vector]


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/audio-perception":
            self.send_error(404)
            return
        size = int(self.headers.get("Content-Length", "0"))
        if size <= 0 or size > MAX_BYTES:
            self.send_error(413)
            return
        try:
            body = json.loads(self.rfile.read(size))
            vector = embed(body["audio"])
            payload = {"learned": {
                "kind": "audio-embedding",
                "model": "MERT-v1-95M",
                "version": MODEL_REVISION,
                "vector": vector,
            }}
            self.respond(200, payload)
        except Exception as exc:
            self.respond(500, {"error": str(exc)})

    def respond(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(fmt % args)


def run() -> None:
    print(f"audio perception sidecar -> http://{HOST}:{PORT}/v1/audio-perception")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    run()
