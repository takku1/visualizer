"""Fast regression checks for multilingual ASR evidence boundaries."""
from __future__ import annotations

import importlib.util
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
        assert _kwargs["generate_kwargs"]["suppress_tokens"] is None
        assert _kwargs["generate_kwargs"]["begin_suppress_tokens"] is None
        assert _kwargs["clean_up_tokenization_spaces"] is False
        return {"text": "雨の駅", "language": "ja", "chunks": []}


probe = module.Probe("fake", "cpu", "ja", WholeWindow())
hypotheses = probe.transcribe(np.zeros(16000, dtype=np.float32), 16000, 12.0)
assert hypotheses[0]["language"] == "ja"
assert hypotheses[0]["startSec"] == 12.0
assert hypotheses[0]["endSec"] == 13.0


class OpenChunk:
    def __call__(self, *_args, **_kwargs):
        return {"language": "ja", "chunks": [{"text": "雨", "timestamp": (0.2, None)}]}


probe.pipe = OpenChunk()
hypotheses = probe.transcribe(np.zeros(16000, dtype=np.float32), 16000, 12.0)
assert hypotheses[0]["endSec"] == 13.0


class UndJapanese:
    def __call__(self, *_args, **_kwargs):
        return {"text": "雨の駅", "language": "und", "chunks": [], "confidence": None}


probe.pipe = UndJapanese()
hypotheses = probe.transcribe(np.zeros(16000, dtype=np.float32), 16000, 0.0)
assert hypotheses[0]["language"] == "ja"
assert hypotheses[0]["confidence"] == 0.7
print("multilingual ASR contract ok")
