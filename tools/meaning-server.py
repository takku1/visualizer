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
from websockets.exceptions import ConnectionClosed


@dataclass
class Probe:
    model_name: str
    device: str
    language: str | None = None
    pipe: object | None = None

    def load(self) -> None:
        from transformers import pipeline

        dtype = "float16" if self.device.startswith("cuda") else "float32"
        self.pipe = pipeline(
            "automatic-speech-recognition",
            model=self.model_name,
            device=self.device,
            dtype=dtype,
        )
        # Recent Transformers versions may forward pipeline call kwargs into
        # Whisper.generate(). Configure the tokenizer once instead of passing
        # this post-processing option through the generation call.
        tokenizer = getattr(self.pipe, "tokenizer", None)
        if tokenizer is not None and hasattr(tokenizer, "clean_up_tokenization_spaces"):
            tokenizer.clean_up_tokenization_spaces = False
        self._sanitize_generation_params()

    def _sanitize_generation_params(self) -> None:
        """Keep tokenizer post-processing kwargs out of Whisper.generate()."""
        params = getattr(self.pipe, "_forward_params", None)
        if not isinstance(params, dict):
            return
        params.pop("clean_up_tokenization_spaces", None)
        nested = params.get("generate_kwargs")
        if isinstance(nested, dict):
            nested.pop("clean_up_tokenization_spaces", None)

    def transcribe(self, samples: np.ndarray, sample_rate: int, offset_sec: float) -> list[dict]:
        if self.pipe is None:
            return []
        # Whisper can emit plausible filler words for silence. Do not let a
        # repeated silent window become semantic evidence. The threshold is
        # deliberately conservative and configurable for different capture
        # devices; the renderer remains independent of this optional gate.
        min_rms = float(os.environ.get("MEANING_MIN_RMS", "0.003"))
        rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64)))) if samples.size else 0.0
        if rms < min_rms:
            return []
        self._sanitize_generation_params()
        generate_kwargs = {"task": "transcribe"}
        if self.language and self.language.lower() not in {"auto", "und"}:
            generate_kwargs["language"] = self.language
        result = self.pipe(
            {"raw": samples, "sampling_rate": sample_rate},
            return_timestamps=True,
            # Ask Whisper for its decoder language rather than inferring it
            # from noisy sung text. This matters for Japanese, where short
            # kana chunks can otherwise look like an accidental language hit.
            return_language=True,
            generate_kwargs=generate_kwargs,
        )
        hypotheses: list[dict] = []
        detected_language = infer_language(
            str(result.get("language") or self.language or "und"),
            str(result.get("text") or ""),
        )
        for index, chunk in enumerate(result.get("chunks", [])):
            text = str(chunk.get("text", "")).strip()
            if not text:
                continue
            chunk_language = infer_language(detected_language, text)
            timestamps = chunk.get("timestamp") or (None, None)
            start, end = timestamps
            if start is None:
                continue
            # Singing, especially in non-Latin scripts, can produce a text
            # chunk without a terminal timestamp. Keep the evidence bounded
            # to the current window rather than dropping the entire phrase.
            end = end if end is not None and end > start else len(samples) / sample_rate
            if end <= start:
                continue
            hypotheses.append({
                "id": f"asr-{int((offset_sec + start) * 1000)}-{index}",
                "text": text,
                "language": chunk_language,
                "startSec": round(offset_sec + float(start), 3),
                "endSec": round(offset_sec + float(end), 3),
                # Transformers does not expose a calibrated chunk confidence
                # consistently. Keep this as a provisional calibrated floor;
                # repeated-window stability is enforced in the browser.
                "confidence": safe_confidence(chunk.get("confidence", result.get("confidence", 0.7))),
                "stability": 0.0,
                "status": "provisional",
                "source": "live-asr",
            })
        if not hypotheses:
            text = str(result.get("text", "")).strip()
            duration = len(samples) / sample_rate
            if text and duration > 0:
                hypotheses.append({
                    "id": f"asr-window-{int(offset_sec * 1000)}",
                    "text": text,
                    "language": detected_language,
                    "startSec": round(offset_sec, 3),
                    "endSec": round(offset_sec + duration, 3),
                    "confidence": safe_confidence(result.get("confidence", 0.7)),
                    "stability": 0.0,
                    "status": "provisional",
                    "source": "live-asr",
                })
        return hypotheses


def infer_language(reported: str, text: str) -> str:
    """Recover common Whisper omissions without overriding an explicit locale."""
    normalized = reported.strip().lower()
    if normalized not in {"", "auto", "und", "unknown", "none"}:
        if normalized in {"japanese", "日本語"}:
            return "ja"
        return normalized
    # Hiragana/Katakana are a stronger Japanese signal than generic CJK text.
    if any(("\u3040" <= char <= "\u309f") or ("\u30a0" <= char <= "\u30ff") for char in text):
        return "ja"
    return reported or "und"


def safe_confidence(value: object) -> float:
    try:
        confidence = float(value) if value is not None else 0.7
    except (TypeError, ValueError):
        confidence = 0.7
    return max(0.0, min(1.0, confidence))


class Server:
    def __init__(self, probe: Probe):
        self.probe = probe
        self.revision = 0

    async def handler(self, websocket) -> None:
        header: dict | None = None
        try:
            await websocket.send(json.dumps({
            "type": "meaning-ready",
            "model": self.probe.model_name,
            "device": self.probe.device,
            "language": self.probe.language or "auto",
            "buildHash": os.environ.get("S1_BUILD_HASH", "unknown"),
            }))
        except ConnectionClosed:
            return
        try:
            await self._messages(websocket)
        except (ConnectionClosed, ConnectionResetError, OSError):
            # Electron closes the optional worker connection during normal
            # restart. Do not report that owner handoff as an ASR failure.
            return

    async def _messages(self, websocket) -> None:
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
            error: str | None = None
            started = time.perf_counter()
            try:
                hypotheses = await asyncio.to_thread(
                    self.probe.transcribe,
                    samples,
                    int(current.get("sampleRate", 16000)),
                    float(current.get("windowStartSec", 0.0)),
                )
            except Exception as exc:  # optional ASR must not take down the renderer
                hypotheses = []
                error = f"transcription-failed: {type(exc).__name__}"
                print(f"[meaning] {error}", flush=True)
            self.revision += 1
            response = {
                "type": "live-lyrics",
                "trackId": str(current.get("trackId", "")),
                "playheadSec": float(current.get("playheadSec", 0.0)),
                "revision": self.revision,
                "model": self.probe.model_name,
                "hypotheses": hypotheses,
                "latencyMs": round((time.perf_counter() - started) * 1000, 1),
                "windowSec": round(len(samples) / max(int(current.get("sampleRate", 16000)), 1), 3),
            }
            if error:
                response["error"] = error
            try:
                await websocket.send(json.dumps(response))
            except (ConnectionClosed, ConnectionResetError, OSError):
                # The renderer may close normally while optional ASR is still
                # finishing a window. This is not an inference failure.
                return


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("MEANING_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MEANING_PORT", "8772")))
    parser.add_argument("--model", default=os.environ.get("MEANING_ASR_MODEL", "openai/whisper-small"))
    parser.add_argument("--device", default=os.environ.get("MEANING_ASR_DEVICE", "cpu"))
    parser.add_argument("--language", default=os.environ.get("MEANING_ASR_LANGUAGE"))
    args = parser.parse_args()

    started = time.perf_counter()
    probe = Probe(args.model, args.device, args.language)
    language = args.language or "auto"
    print(f"[meaning] loading {args.model} on {args.device} language={language}", flush=True)
    await asyncio.to_thread(probe.load)
    print(f"[meaning] ready in {time.perf_counter() - started:.1f}s ws://{args.host}:{args.port}", flush=True)
    server = Server(probe)
    async with websockets.serve(server.handler, args.host, args.port, max_size=8 * 1024 * 1024):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
