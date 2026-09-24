"""Local first-listen ASR probe.

This is intentionally a separate localhost worker from the diffusion sidecar.
The browser sends short overlapping PCM windows; the worker returns timestamped
live-lyrics hypotheses. It never calls a lyrics service and never writes
transcript text to a prompt or log.

Run after installing the existing stream requirements:

    python tools/meaning-server.py --model openai/whisper-small

The first run may download the selected model from its model registry. Set
MEANING_ASR_MODEL to use a locally cached path instead. The browser transport
client is added separately so this probe can be measured before enabling it in
the main render loop.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from dataclasses import dataclass

import numpy as np
import websockets


@dataclass
class Probe:
    model_name: str
    device: str
    pipe: object | None = None

    def load(self) -> None:
        from transformers import pipeline

        torch_dtype = "float16" if self.device.startswith("cuda") else "float32"
        self.pipe = pipeline(
            "automatic-speech-recognition",
            model=self.model_name,
            device=self.device,
            torch_dtype=torch_dtype,
        )

    def transcribe(self, samples: np.ndarray, sample_rate: int, offset_sec: float) -> list[dict]:
        if self.pipe is None:
            return []
        result = self.pipe(
            {"raw": samples, "sampling_rate": sample_rate},
            return_timestamps=True,
            generate_kwargs={"task": "transcribe"},
        )
        hypotheses: list[dict] = []
        for index, chunk in enumerate(result.get("chunks", [])):
            text = str(chunk.get("text", "")).strip()
            timestamps = chunk.get("timestamp") or (None, None)
            start, end = timestamps
            if not text or start is None or end is None or end <= start:
                continue
            hypotheses.append({
                "id": f"asr-{int((offset_sec + start) * 1000)}-{index}",
                "text": text,
                # The default Whisper pipeline does not expose a stable
                # language tag in every transformers version. `und` is honest
                # until a language-aware backend supplies one.
                "language": "und",
                "startSec": round(offset_sec + float(start), 3),
                "endSec": round(offset_sec + float(end), 3),
                "confidence": 0.5,
                "stability": 0.0,
                "status": "provisional",
                "source": "live-asr",
            })
        return hypotheses


class Server:
    def __init__(self, probe: Probe):
        self.probe = probe
        self.revision = 0

    async def handler(self, websocket) -> None:
        header: dict | None = None
        await websocket.send(json.dumps({
            "type": "meaning-ready",
            "model": self.probe.model_name,
            "device": self.probe.device,
        }))
        async for message in websocket:
            if isinstance(message, str):
                try:
                    value = json.loads(message)
                except json.JSONDecodeError:
                    continue
                if value.get("type") == "audio-window":
                    header = value
                continue
            if header is None:
                continue
            samples = np.frombuffer(message, dtype=np.float32)
            current = header
            header = None
            hypotheses = await asyncio.to_thread(
                self.probe.transcribe,
                samples,
                int(current.get("sampleRate", 16000)),
                float(current.get("windowStartSec", 0.0)),
            )
            self.revision += 1
            await websocket.send(json.dumps({
                "type": "live-lyrics",
                "trackId": str(current.get("trackId", "")),
                "playheadSec": float(current.get("playheadSec", 0.0)),
                "revision": self.revision,
                "model": self.probe.model_name,
                "hypotheses": hypotheses,
            }))


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("MEANING_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MEANING_PORT", "8772")))
    parser.add_argument("--model", default=os.environ.get("MEANING_ASR_MODEL", "openai/whisper-small"))
    parser.add_argument("--device", default=os.environ.get("MEANING_ASR_DEVICE", "cpu"))
    args = parser.parse_args()

    started = time.perf_counter()
    probe = Probe(args.model, args.device)
    print(f"[meaning] loading {args.model} on {args.device}", flush=True)
    await asyncio.to_thread(probe.load)
    print(f"[meaning] ready in {time.perf_counter() - started:.1f}s ws://{args.host}:{args.port}", flush=True)
    server = Server(probe)
    async with websockets.serve(server.handler, args.host, args.port, max_size=8 * 1024 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
