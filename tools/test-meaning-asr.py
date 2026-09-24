"""Fast regression checks for multilingual ASR evidence boundaries."""
from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("meaning_server", Path(__file__).with_name("meaning-server.py"))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class WholeWindow:
    def __call__(self, *_args, **_kwargs):
        assert "suppress_tokens" not in _kwargs["generate_kwargs"]
        assert "begin_suppress_tokens" not in _kwargs["generate_kwargs"]
        assert "clean_up_tokenization_spaces" not in _kwargs
        assert _kwargs["return_language"] is True
        return {"text": "雨の駅", "language": "ja", "chunks": []}


probe = module.Probe("fake", "cpu", "ja", WholeWindow())
probe.pipe._forward_params = {
    "clean_up_tokenization_spaces": True,
    "generate_kwargs": {"clean_up_tokenization_spaces": True},
}
probe._sanitize_generation_params()
assert probe.pipe._forward_params == {"generate_kwargs": {}}
hypotheses = probe.transcribe(np.full(16000, 0.1, dtype=np.float32), 16000, 12.0)
assert hypotheses[0]["language"] == "ja"
assert hypotheses[0]["startSec"] == 12.0
assert hypotheses[0]["endSec"] == 13.0


class OpenChunk:
    def __call__(self, *_args, **_kwargs):
        return {"language": "ja", "chunks": [{"text": "雨", "timestamp": (0.2, None)}]}


probe.pipe = OpenChunk()
hypotheses = probe.transcribe(np.full(16000, 0.1, dtype=np.float32), 16000, 12.0)
assert hypotheses[0]["endSec"] == 13.0


class UndJapanese:
    def __call__(self, *_args, **_kwargs):
        return {"text": "雨の駅", "language": "und", "chunks": [], "confidence": None}


probe.pipe = UndJapanese()
hypotheses = probe.transcribe(np.full(16000, 0.1, dtype=np.float32), 16000, 0.0)
assert hypotheses[0]["language"] == "ja"
assert hypotheses[0]["confidence"] == 0.7

probe.pipe = WholeWindow()
assert probe.transcribe(np.zeros(16000, dtype=np.float32), 16000, 0.0) == []


class CloseOnReady:
    async def send(self, _message):
        raise module.ConnectionClosed(None, None)


asyncio.run(module.Server(module.Probe("fake", "cpu", pipe=WholeWindow())).handler(CloseOnReady()))


class CloseOnResponse:
    def __init__(self):
        self.sends = 0

    async def send(self, _message):
        self.sends += 1
        if self.sends == 2:
            raise module.ConnectionClosed(None, None)

    def __aiter__(self):
        async def messages():
            yield json.dumps({"type": "audio-window", "sampleRate": 16000, "windowStartSec": 0})
            yield np.zeros(160, dtype=np.float32).tobytes()
        return messages()


asyncio.run(module.Server(module.Probe("fake", "cpu", pipe=WholeWindow())).handler(CloseOnResponse()))
print("multilingual ASR contract ok")
