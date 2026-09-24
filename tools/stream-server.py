"""Realization-plane streaming diffusion sidecar.

Fast realization: a StreamDiffusion-style img2img loop. Its camera input is
the browser's procedural scene, sent as binary websocket frames: structure and
motion at exact beat sync. When no procedural frame has arrived for 1 s, it
falls back to the current keyframe, moved by an audio-driven camera and flow
field. A small share of the previous frame is mixed in, the result is
re-noised a little and denoised in ONE SD-Turbo UNet step (no CFG).

Audio never describes anything here. It perturbs the sampling physics
(strength, fresh-noise temperature, detail, camera, flow, beat pushes) and,
through network bending (Bender), the UNet's own activations. The browser
computes all of it (src/stream/control.ts) and streams it in.

Checkpoint realization: when the browser asks for a new
scene, a 4-step SD-Turbo keyframe is denoised *time-sliced into the fast loop*:
each fast frame carries one keyframe step in the same UNet batch. It starts
from the procedural frame when one is arriving (continuity >= 0.5, so the
scene is painted over the structure the viewer sees), otherwise from noise or
the live latent. It is then painted into the loop region by region, with the
prompt embedding crossfading. Re-seeding is what bounds drift; it is
architecture, not a workaround.

Why one model for both loops: the target is a 6 GB RTX A3000 Laptop GPU. SD-Turbo
fp16 (1.7 GB UNet + 0.7 GB OpenCLIP-H) plus TAESD fits with headroom; a second,
stronger keyframe model (SDXL/FLUX/LTX) does not.

  python tools/stream-server.py             # websocket on ws://127.0.0.1:8771
  python tools/stream-server.py --bench 120 # headless throughput check

Binds to 127.0.0.1 only.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import re
import hashlib
import struct
import threading
import time
from dataclasses import dataclass, field, replace
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.environ.get("STREAM_MODEL", ROOT / "models" / "sd-turbo"))
TAESD_DIR = Path(os.environ.get("STREAM_TAESD", ROOT / "models" / "taesd"))
PORT = int(os.environ.get("STREAM_PORT", "8771"))
BUILD_HASH = os.environ.get("S1_BUILD_HASH", "unknown")
# 448x256 is ~16:9 and keeps every UNet level integral (latent 56x32). On the
# 6 GB A3000 it is the default realtime profile: the isolated benchmark is
# about 30% faster than 576x320 at nearly identical VRAM. Set both variables
# to 576x320 for the higher-resolution quality profile.
WIDTH = int(os.environ.get("STREAM_WIDTH", "448"))
HEIGHT = int(os.environ.get("STREAM_HEIGHT", "256"))
KEY_STEPS = int(os.environ.get("STREAM_KEY_STEPS", "4"))
JPEG_QUALITY = int(os.environ.get("STREAM_JPEG_QUALITY", "88"))
MAX_FPS = float(os.environ.get("STREAM_MAX_FPS", "30"))
MEANING_DIR = Path(os.environ.get("STREAM_MEANING_DIR", ROOT / "meaning"))
EVAL_DIR = Path(os.environ["STREAM_EVAL_DIR"]) if os.environ.get("STREAM_EVAL_DIR") else None
EVAL_EVERY = max(1, int(os.environ.get("STREAM_EVAL_EVERY", "15")))
if EVAL_DIR:
    EVAL_DIR.mkdir(parents=True, exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def apply_resonance(c: "Control") -> "Control":
    """Apply bounded pressure to handles already present in the world."""
    resonance = c.resonance
    if not isinstance(resonance, dict):
        return c
    weather = _clamp(float(resonance.get("weatherIntensity") or 0.0), 0.0, 1.0)
    camera = _clamp(float(resonance.get("cameraImpulse") or 0.0), 0.0, 1.0)
    light = _clamp(float(resonance.get("lightPulse") or 0.0), 0.0, 1.0)
    entity_motion = resonance.get("entityMotion")
    entity = max((float(value) for value in entity_motion.values()), default=0.0) if isinstance(entity_motion, dict) else 0.0
    entity = _clamp(entity, 0.0, 1.0)
    # Audio remains primary; semantic state only gates existing channels.
    return replace(
        c,
        flow=_clamp(c.flow + 0.018 * weather + 0.012 * entity, 0.0, 0.1),
        zoom=_clamp(c.zoom + 0.025 * camera, -1.0, 1.0),
        glass=_clamp(c.glass + 0.04 * light, 0.0, 0.9),
    )


def normalize_realization_request(msg: dict) -> dict | None:
    """Validate the additive structured realization envelope.

    The legacy checkpoint fields remain the compatibility wire contract. A
    malformed or absent envelope is ignored rather than taking down the live
    stream, which lets older browser builds continue to drive this sidecar.
    """
    raw = msg.get("realization")
    if not isinstance(raw, dict):
        return None
    if not all(isinstance(raw.get(key), dict) for key in ("world", "shot", "diff", "legacy", "continuousForces")):
        return None
    legacy = raw["legacy"]
    if not isinstance(legacy.get("prompt"), str):
        return None
    if not isinstance(legacy.get("look"), dict):
        return None
    return raw


def structured_hspace(realization: dict) -> dict[str, float]:
    """Read bounded perceptual directions for the current UNet adapter.

    This is intentionally not an identity/reference interface. It is the
    small, measured bridge from structured world intent into the existing
    Network-Bending bottleneck directions, so the structured request changes
    activations rather than only changing prompt text.
    """
    conditioning = realization.get("conditioning")
    raw = conditioning.get("hspace", {}) if isinstance(conditioning, dict) else {}
    return {
        axis: _clamp(float(raw.get(axis, 0.0)), -1.0, 1.0)
        for axis in ("energy", "light", "organic")
    }


def compile_structured_prompt(realization: dict) -> str:
    """Compile authoritative world/shot state into this backend's text control.

    Text remains a compatibility artifact for the current SD-Turbo adapter, but
    it is now derived from the structured request instead of silently ignoring
    world and shot fields. Future adapters can replace this compiler with
    references, masks, depth, or temporal conditioning.
    """
    legacy = realization.get("legacy", {})
    world = realization.get("world", {})
    shot = realization.get("shot", {})
    diff = realization.get("diff", {})
    parts = [str(legacy.get("prompt", "")).strip()]
    entities = []
    for entity in world.get("entities", []) if isinstance(world.get("entities"), list) else []:
        if not isinstance(entity, dict):
            continue
        label = str(entity.get("label", "")).strip()
        attributes = ", ".join(str(item) for item in entity.get("attributes", [])[:3])
        if label:
            entities.append(f"{label}{', ' + attributes if attributes else ''}")
    if entities:
        parts.append("persistent subjects/objects: " + "; ".join(entities[:6]))
    intent = world.get("intent", {})
    if isinstance(intent, dict):
        for key, label in (("form", "form"), ("behavior", "behavior"), ("spatiality", "space"), ("materiality", "material"), ("motion", "motion"), ("tension", "tension")):
            values = intent.get(key)
            if isinstance(values, list) and values:
                parts.append(f"perceptual {label}: " + ", ".join(str(value) for value in values[:4]))
    emergent = world.get("emergent", {})
    hypotheses = emergent.get("hypotheses", []) if isinstance(emergent, dict) else []
    if isinstance(hypotheses, list):
        descriptors = [str(value) for item in hypotheses[:4] if isinstance(item, dict) for value in item.get("descriptors", [])[:3]]
        if descriptors:
            parts.append("persistent emergent forms: " + ", ".join(descriptors))
    environment = world.get("environment", [])
    if isinstance(environment, list) and environment:
        parts.append("persistent environment: " + ", ".join(str(item) for item in environment[:6]))
    for key, label in (("action", "current action"), ("camera", "camera")):
        value = world.get(key)
        if value:
            parts.append(f"{label}: {value}")
    if world.get("relation"):
        parts.append(f"persistent relation: {world['relation']}")
    if shot.get("grammar"):
        parts.append(f"shot grammar: {shot['grammar']}")
    if shot.get("framing"):
        parts.append(f"framing: {shot['framing']}")
    visual = world.get("visualIdentity", {})
    color = visual.get("color", {}) if isinstance(visual, dict) else {}
    lighting = visual.get("lighting", {}) if isinstance(visual, dict) else {}
    if isinstance(color, dict) and color.get("scheme"):
        parts.append(f"persistent color scheme: {color['scheme']}, temperature {float(color.get('temperature', 0.5)):.2f}, accent weight {float(color.get('accentWeight', 0.0)):.2f}")
    if isinstance(lighting, dict) and lighting.get("direction"):
        parts.append(f"persistent lighting: {lighting['direction']}, warmth {float(lighting.get('warmth', 0.5)):.2f}, atmosphere {float(lighting.get('atmosphere', 0.0)):.2f}")
    additions = diff.get("add", []) if isinstance(diff, dict) else []
    kept = diff.get("keep", []) if isinstance(diff, dict) else []
    removals = diff.get("remove", []) if isinstance(diff, dict) else []
    if kept:
        labels = [str(item.get("label")) for item in kept if isinstance(item, dict) and item.get("label")]
        if labels:
            parts.append("preserve through this transition: " + ", ".join(labels[:6]))
    if additions:
        labels = [str(item.get("label")) for item in additions if isinstance(item, dict) and item.get("label")]
        if labels:
            parts.append("introduce only at this transition: " + ", ".join(labels[:4]))
    if removals:
        labels = [str(item.get("label")) for item in removals if isinstance(item, dict) and item.get("label")]
        if labels:
            parts.append("remove only at this transition: " + ", ".join(labels[:4]))
    action_change = diff.get("action") if isinstance(diff, dict) else None
    if isinstance(action_change, dict) and action_change.get("to"):
        from_action = action_change.get("from") or "the prior action"
        parts.append(f"action transition: {from_action} -> {action_change['to']}")
    camera_change = diff.get("camera") if isinstance(diff, dict) else None
    if isinstance(camera_change, dict) and camera_change.get("to"):
        from_camera = camera_change.get("from") or "the prior camera"
        parts.append(f"camera transition: {from_camera} -> {camera_change['to']}")
    if diff.get("identityBreak"):
        parts.append("intentional identity replacement at this checkpoint")
    return ", ".join(part for part in parts if part)


def structured_conditioning_summary(realization: dict, compiled_prompt: str) -> dict:
    """Expose exactly which structured state reached this legacy backend.

    The current SD-Turbo adapter still consumes text, so this is not a claim
    of object-level model conditioning. It is an auditable bridge: later
    backends can replace the prompt compiler while retaining the same field
    coverage and request hash in telemetry.
    """
    world = realization.get("world", {})
    shot = realization.get("shot", {})
    diff = realization.get("diff", {})
    fields: list[str] = []
    if isinstance(world.get("entities"), list) and world["entities"]:
        fields.append("entities")
    if isinstance(world.get("environment"), list) and world["environment"]:
        fields.append("environment")
    if world.get("relation"):
        fields.append("relation")
    if isinstance(world.get("intent"), dict) and world["intent"]:
        fields.append("intent")
    if isinstance(world.get("emergent"), dict) and world["emergent"].get("hypotheses"):
        fields.append("emergent")
    for key in ("action", "camera", "visualIdentity"):
        if world.get(key):
            fields.append(key)
    if isinstance(shot, dict) and any(shot.get(key) for key in ("id", "grammar", "framing", "camera")):
        fields.append("shot")
    if isinstance(diff, dict):
        fields.append("diff")
    conditioning = realization.get("conditioning")
    if isinstance(conditioning, dict) and isinstance(conditioning.get("hspace"), dict):
        fields.append("semantic-hspace")
    return {
        "version": "structured-world-v2",
        "fields": fields,
        "promptSha256": hashlib.sha256(compiled_prompt.encode("utf-8")).hexdigest()[:16],
        "entityCount": len(world.get("entities", [])) if isinstance(world.get("entities"), list) else 0,
        "emergentHypothesisCount": len(world.get("emergent", {}).get("hypotheses", [])) if isinstance(world.get("emergent"), dict) and isinstance(world.get("emergent", {}).get("hypotheses"), list) else 0,
        "identityBreak": bool(diff.get("identityBreak")) if isinstance(diff, dict) else False,
        "semanticHspace": structured_hspace(realization),
    }


@dataclass
class Control:
    """Sampling physics for one fast frame. Mirrors SamplerControl in src/stream/control.ts."""

    strength: float = 0.3  # fraction of the diffusion trajectory re-run (0 freeze .. 1 new image)
    noise: float = 0.1  # fresh (incoherent) share of the injected noise: audio "temperature"
    detail: float = 0.0  # high-frequency latent noise amplitude
    zoom: float = 0.02  # latent zoom rate, per second (positive = push in)
    rotate: float = 0.0  # radians per second
    driftX: float = 0.0  # latent translation, fraction of frame per second
    driftY: float = 0.0
    noiseWalk: float = 0.4  # radians per second the coherent noise field rotates
    feedback: float = 0.15  # share of the previous frame in the input; the rest is the keyframe
    flow: float = 0.03  # flow-field displacement amplitude, fraction of the frame
    flowSpeed: float = 0.4  # radians per second the flow field evolves
    # Network bending (see Bender): audio transforms inside the UNet.
    hue: float = 0.0  # mid-layer channel rotation, radians: harmony
    swell: float = 0.0  # early-layer dilation blend: bass
    glass: float = 0.0  # late-layer soft-threshold blend: treble onsets
    lurch: float = 0.0  # early-layer inversion blend: drops
    # h-space directions (see HSPACE_AXES): signed strengths at the bottleneck.
    hsEnergy: float = 0.0
    hsLight: float = 0.0
    hsOrganic: float = 0.0
    seq: int = 0
    # Structured semantic resonance; never creates content, only modulates
    # existing world handles in the fast realization loop.
    resonance: dict | None = None

    @staticmethod
    def parse(msg: dict) -> "Control":
        c = Control()
        c.strength = _clamp(float(msg.get("strength", c.strength)), 0.05, 0.95)
        c.noise = _clamp(float(msg.get("noise", c.noise)), 0.0, 1.0)
        c.detail = _clamp(float(msg.get("detail", c.detail)), 0.0, 1.0)
        c.zoom = _clamp(float(msg.get("zoom", c.zoom)), -1.0, 1.0)
        c.rotate = _clamp(float(msg.get("rotate", c.rotate)), -1.0, 1.0)
        c.driftX = _clamp(float(msg.get("driftX", c.driftX)), -0.5, 0.5)
        c.driftY = _clamp(float(msg.get("driftY", c.driftY)), -0.5, 0.5)
        c.noiseWalk = _clamp(float(msg.get("noiseWalk", c.noiseWalk)), 0.0, 6.0)
        # Measured on the A3000 sweep: at >= 0.5 the loop leaves the keyframe
        # for a "circuit board" attractor within ~90 frames. Motion comes from
        # the flow field instead of from self-feedback.
        c.feedback = _clamp(float(msg.get("feedback", c.feedback)), 0.0, 0.35)
        c.flow = _clamp(float(msg.get("flow", c.flow)), 0.0, 0.1)
        c.flowSpeed = _clamp(float(msg.get("flowSpeed", c.flowSpeed)), 0.0, 4.0)
        c.hue = _clamp(float(msg.get("hue", c.hue)), -math.pi, math.pi)
        # Caps from the A3000 operator sweep: swell 0.7 and lurch 0.35 shatter
        # the frame into mosaic; 0.3 / 0.15 read as a swell and a portal.
        c.swell = _clamp(float(msg.get("swell", c.swell)), 0.0, 0.4)
        c.glass = _clamp(float(msg.get("glass", c.glass)), 0.0, 0.9)
        c.lurch = _clamp(float(msg.get("lurch", c.lurch)), 0.0, 0.2)
        c.hsEnergy = _clamp(float(msg.get("hsEnergy", c.hsEnergy)), -1.5, 1.5)
        c.hsLight = _clamp(float(msg.get("hsLight", c.hsLight)), -1.5, 1.5)
        c.hsOrganic = _clamp(float(msg.get("hsOrganic", c.hsOrganic)), -1.5, 1.5)
        c.seq = int(msg.get("seq", 0))
        raw_resonance = msg.get("resonance")
        c.resonance = raw_resonance if isinstance(raw_resonance, dict) else None
        return c


# h-space axes (Asyrp, "Diffusion Models Already Have a Semantic Latent Space",
# arXiv:2210.10960): directions in the UNet bottleneck that shift an image
# along a concept consistently across timesteps. Built without training, from
# the mean mid-block difference between each pair's prompts.
HSPACE_AXES = {
    "energy": ("explosive chaotic intense energy, dynamic motion, bursting", "calm still serene quiet, gentle, motionless"),
    "light": ("luminous bright radiant glowing light, daylight, airy", "dark shadowy dim night, deep shadows, murky"),
    "organic": ("organic flowing natural soft curved living forms", "geometric hard-edged angular architectural crystalline forms"),
}


# Title words that carry no image.
STOPWORDS = set("""
a an the and or but of in on at to for from by with without into onto over under through across
is are was were be been being am do does did have has had i you he she it we they me him her us them
my your his its our their this that these those what which who whom whose when where why how
not no nor so too very just only than then there here all any each every some more most much many
feat ft featuring remix remaster remastered version edit mix live radio original extended vip instrumental
mono stereo demo bonus track single album part pt vol intro outro interlude reprise acoustic
""".split())


def title_concepts(title: str, tokenizer, limit: int = 3) -> list[str]:
    """Image-bearing words from a song title, safe to put in a prompt.

    Credits and version tags go: "(feat. X)", "[Live]", " - 2011 Remaster".
    Only words the CLIP tokenizer holds as a single token survive. That keeps
    common words ("smoke", "dance") and drops invented names ("Yurail"),
    which SD-Turbo would otherwise paint as literal letters.
    """
    t = re.sub(r"[\(\[].*?[\)\]]", " ", title)
    t = re.split(r"\s[-\u2013\u2014]\s", t)[0]
    words: list[str] = []
    for w in re.findall(r"[A-Za-z']+", t.lower()):
        w = w.strip("'")
        if len(w) < 3 or w in STOPWORDS or w in words:
            continue
        if len(tokenizer.tokenize(w)) == 1:
            words.append(w)
    return words[:limit]


def _meaning_key(value: str) -> str:
    """Stable, filesystem-safe key for a local meaning manifest."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]


def load_local_meaning(track_id: str, title: str, artist: str) -> dict | None:
    """Load an explicit local SongMeaning manifest, never infer one here.

    The sidecar is deliberately not a lyric fetcher. A manifest is opt-in and
    evidence-bearing; absent or malformed data means semantic abstention and
    the browser falls back to its non-narrative director prompt.
    """
    candidates = [_meaning_key(track_id)]
    if title or artist:
        candidates.append(_meaning_key(f"{title}\0{artist}"))
    for key in candidates:
        path = MEANING_DIR / f"{key}.json"
        try:
            with path.open("r", encoding="utf-8") as handle:
                meaning = json.load(handle)
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            continue
        if not isinstance(meaning, dict):
            continue
        if not isinstance(meaning.get("revision"), int):
            continue
        if not isinstance(meaning.get("motifs"), list) or not isinstance(meaning.get("sections"), list):
            continue
        if not isinstance(meaning.get("evidence", []), list):
            continue
        language = meaning.get("language")
        if language is not None and (not isinstance(language, str) or not re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", language)):
            continue
        meaning.setdefault("relations", [])
        meaning.setdefault("thesis", None)
        meaning.setdefault("abstained", False)
        return meaning
    return None


class Bender:
    """Network bending: audio-driven transforms applied to the UNet's own
    activations (Dzwonczyk et al., "Network Bending of Diffusion Models",
    arXiv:2406.19589; JAES 2025). Early layers change *what* is depicted,
    late layers restyle while keeping the image coherent, so each musical
    dimension gets the depth that matches it:

      conv_in      (early)  swell: max-pool dilation     - bass swells structure
                            lurch: inversion blend       - drops shift the scene
      mid_block    (mid)    hue:   pairwise channel rotation - harmony moves color
      up_blocks.2  (late)   glass: soft threshold        - treble onsets glint

    Strengths live in one static GPU tensor updated before each call, so the
    hooks are captured into the CUDA graphs and cost no launches of their own.
    `mask` gates bending per batch sample: the live frame is bent, a keyframe
    step batched alongside it never is.
    """

    def __init__(self, unet) -> None:
        # hue, swell, glass, lurch, then one strength per h-space axis
        self.params = torch.zeros(4 + len(HSPACE_AXES), device=DEVICE, dtype=torch.float32)
        self.mask = torch.zeros(2, device=DEVICE, dtype=torch.float32)
        # `set` runs once per live frame. Keep the tiny CPU staging buffers
        # alive so control updates do not allocate two temporary tensors on
        # every call before copying into the graph-visible GPU state.
        self._params_host = torch.empty(4 + len(HSPACE_AXES), dtype=torch.float32)
        self._mask_host = torch.empty(2, dtype=torch.float32)
        self.directions: torch.Tensor | None = None  # [axes, C, H, W] at the bottleneck
        unet.conv_in.register_forward_hook(self._early)
        unet.mid_block.register_forward_hook(self._mid)
        unet.up_blocks[2].register_forward_hook(self._late)

    def set(self, c: "Control", live: list[float]) -> None:
        self._params_host[0] = c.hue
        self._params_host[1] = c.swell
        self._params_host[2] = c.glass
        self._params_host[3] = c.lurch
        self._params_host[4] = c.hsEnergy
        self._params_host[5] = c.hsLight
        self._params_host[6] = c.hsOrganic
        for index, value in enumerate(live):
            self._mask_host[index] = value
        self.params.copy_(self._params_host)
        self.mask[: len(live)].copy_(self._mask_host[: len(live)])

    def _gate(self, h: torch.Tensor, i: int) -> torch.Tensor:
        return (self.params[i] * self.mask[: h.shape[0]]).view(-1, 1, 1, 1).to(h.dtype)

    def _early(self, _m, _i, h: torch.Tensor) -> torch.Tensor:
        swell = self._gate(h, 1)
        h = torch.lerp(h, F.max_pool2d(h, 3, 1, 1), swell)
        return torch.lerp(h, -h, self._gate(h, 3))

    def _mid(self, _m, _i, h: torch.Tensor) -> torch.Tensor:
        angle = self._gate(h, 0)
        b, c, hh, ww = h.shape
        pairs = h.view(b, c // 2, 2, hh, ww)
        x, y = pairs[:, :, 0], pairs[:, :, 1]
        cos, sin = torch.cos(angle), torch.sin(angle)
        h = torch.stack([x * cos - y * sin, x * sin + y * cos], dim=2).view(b, c, hh, ww)
        if self.directions is not None and self.directions.shape[-2:] == h.shape[-2:]:
            # Signed h-space shifts, gated per sample like every other bend.
            strengths = (self.params[4:].view(1, -1) * self.mask[:b].view(-1, 1)).to(h.dtype)  # [b, axes]
            h = h + torch.einsum("ba,achw->bchw", strengths, self.directions)
        return h

    def _late(self, _m, _i, h: torch.Tensor) -> torch.Tensor:
        # Keep strong activations, suppress weak ones: the "stained glass" look,
        # softened so it glints instead of shattering the frame.
        scale = h.float().std(dim=(1, 2, 3), keepdim=True).to(h.dtype)
        keep = torch.sigmoid((h.abs() - scale) * (6 / scale))
        return torch.lerp(h, h * keep, self._gate(h, 2))


class Graphed:
    """Replays a fixed-shape GPU call as a CUDA graph.

    The frame is hundreds of small kernels; on a laptop GPU, launch overhead is
    a large share of the UNet's time (93 -> 60 ms measured on the A3000). CUDA
    graphs need no Triton, unlike torch.compile on Windows. Outputs live in a
    static buffer overwritten by the next replay, so callers copy what they keep.
    """

    def __init__(self, fn, *example: torch.Tensor, pool=None) -> None:
        self.inputs = [x.clone() for x in example]
        side = torch.cuda.Stream()
        side.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(side):
            for _ in range(3):
                fn(*self.inputs)
        torch.cuda.current_stream().wait_stream(side)
        self.graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.graph, pool=pool):
            self.output = fn(*self.inputs)

    def __call__(self, *args: torch.Tensor) -> torch.Tensor:
        for dst, src in zip(self.inputs, args):
            dst.copy_(src)
        self.graph.replay()
        return self.output


@dataclass
class KeyJob:
    """One System 2 checkpoint, denoised one step per fast frame."""

    id: str
    emb: torch.Tensor
    z: torch.Tensor
    timesteps: list[int]
    splice_frames: int
    step: int = 0
    splice_pos: int = 0
    x0: torch.Tensor | None = None
    home: torch.Tensor | None = None  # decoded x0
    reveal: torch.Tensor | None = None  # per-pixel paint-in order, 0..1
    started: float = field(default_factory=time.perf_counter)

    @property
    def phase(self) -> str:
        return "denoising" if self.step < len(self.timesteps) else "splicing"


class Engine:
    def __init__(self) -> None:
        from diffusers import AutoencoderTiny, UNet2DConditionModel
        from transformers import CLIPTextModel, CLIPTokenizer

        if DEVICE == "cuda":
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            # Not cudnn.benchmark: it re-autotunes on every new batch shape,
            # which stalls the live loop for ~12 s the first time a keyframe
            # step is batched in.

        def variant(sub: str) -> str | None:
            return "fp16" if DTYPE == torch.float16 and any((MODEL_DIR / sub).glob("*.fp16.safetensors")) else None

        t0 = time.perf_counter()
        self.tokenizer = CLIPTokenizer.from_pretrained(MODEL_DIR / "tokenizer")
        self.text_encoder = CLIPTextModel.from_pretrained(
            MODEL_DIR / "text_encoder", variant=variant("text_encoder"), torch_dtype=DTYPE
        ).to(DEVICE).eval()
        self.unet = UNet2DConditionModel.from_pretrained(
            MODEL_DIR / "unet", variant=variant("unet"), torch_dtype=DTYPE
        ).to(DEVICE).eval()
        self.bender = Bender(self.unet)
        # Prefer the checkpoint's own tiny VAE (SDXS ships one finetuned for
        # its UNet); otherwise the generic TAESD for SD 1.x/2.x latents.
        own_vae = MODEL_DIR / "vae" / "config.json"
        tiny = own_vae.exists() and json.loads(own_vae.read_text()).get("_class_name") == "AutoencoderTiny"
        self.taesd = AutoencoderTiny.from_pretrained(MODEL_DIR / "vae" if tiny else TAESD_DIR, torch_dtype=DTYPE).to(DEVICE).eval()
        if os.environ.get("STREAM_COMPILE") == "1":
            self.unet = torch.compile(self.unet, mode="reduce-overhead")

        cfg = json.loads((MODEL_DIR / "scheduler" / "scheduler_config.json").read_text())
        if cfg.get("prediction_type", "epsilon") != "epsilon":
            raise RuntimeError("stream sampler supports epsilon-prediction checkpoints only")
        betas = torch.linspace(cfg["beta_start"] ** 0.5, cfg["beta_end"] ** 0.5, cfg["num_train_timesteps"], dtype=torch.float64) ** 2
        self.alphas = torch.cumprod(1.0 - betas, 0).to(DEVICE, torch.float32)
        self.train_steps = cfg["num_train_timesteps"]

        self.h, self.w = HEIGHT // 8, WIDTH // 8
        self.gen = torch.Generator(DEVICE).manual_seed(0)
        self.n0 = self._randn()
        self.n1 = self._randn()
        self.theta = 0.0
        self.z: torch.Tensor | None = None
        self.img: torch.Tensor | None = None  # last displayed frame, [-1, 1], the feedback state
        self.home: torch.Tensor | None = None  # current keyframe image, [-1, 1]: the loop's "camera input"
        self.cam = [0.0, 0.0, 0.0, 0.0]  # log-zoom, angle, x, y - sprung back toward identity
        self.phi = 0.0  # flow-field phase
        self.last_delta: torch.Tensor | None = None  # previous frame's latent change, for jitter
        self.flow_prev: torch.Tensor | None = None
        self.fields = (self._smooth_field(2, 5), self._smooth_field(2, 5))
        self.emb: torch.Tensor | None = None
        self.anchor: tuple[torch.Tensor, torch.Tensor] | None = None
        self.job: KeyJob | None = None
        self.pending: dict | None = None
        self.last_key: dict = {"id": None, "ms": 0}
        self.last_world_diff: dict | None = None
        self.last_realization: dict = {"structured": False}
        self.semantic_hspace = {"energy": 0.0, "light": 0.0, "organic": 0.0}
        self._emb_cache: dict[str, torch.Tensor] = {}
        self.embed_calls = 0
        self.embed_cache_hits = 0
        self.control = Control()
        self.source_np: np.ndarray | None = None  # latest procedural frame (RGB uint8), set by the socket thread
        self.source_at = 0.0
        self.source: torch.Tensor | None = None  # the same frame on the GPU, [-1, 1]
        self.input_kind = "keyframe"
        # Prompt blend (live knob): target weights per prompt, glided per frame.
        self.blend_target: dict[str, float] | None = None
        self.blend_weights: dict[str, float] = {}
        self.blend_tau = 2.0
        self.blend_base: torch.Tensor | None = None  # the embedding the first blend glides away from
        self._hspace_directions()
        self.graphs: dict[str, Graphed] = {}
        if DEVICE == "cuda" and os.environ.get("STREAM_CUDA_GRAPHS", "1") == "1":
            try:
                self._capture()
            except Exception as exc:  # eager still works, just slower
                print(f"cuda graph capture failed, running eager: {exc}", flush=True)
                self.graphs = {}
        self.load_s = time.perf_counter() - t0

    # ---------- helpers ----------

    @torch.inference_mode()
    def _hspace_directions(self) -> None:
        """Mean bottleneck difference per prompt pair, cached per resolution.

        Scaled so strength 1 moves the bottleneck by one standard deviation of
        its ordinary activations: the same unit on every axis.
        """
        cache = ROOT / "models" / f"hspace-{WIDTH}x{HEIGHT}.pt"
        if cache.exists():
            saved = torch.load(cache, map_location=DEVICE, weights_only=True)
            if saved.get("axes") == list(HSPACE_AXES):
                self.bender.directions = saved["directions"].to(DEVICE, DTYPE)
                return
        seen: list[torch.Tensor] = []
        hook = self.unet.mid_block.register_forward_hook(lambda _m, _i, out: seen.append(out.float()))
        gen = torch.Generator(DEVICE).manual_seed(1234)
        noises = [torch.randn((1, 4, self.h, self.w), generator=gen, device=DEVICE) for _ in range(6)]
        dirs, scale = [], []
        try:
            for pos, neg in HSPACE_AXES.values():
                diffs = []
                for p_emb, sign in ((self.embed(pos), 1.0), (self.embed(neg), -1.0)):
                    for t in (250, 450, 650):
                        for n in noises:
                            seen.clear()
                            self.unet(n.to(DTYPE), torch.tensor([t], device=DEVICE), encoder_hidden_states=p_emb)
                            diffs.append(sign * seen[0])
                            scale.append(seen[0].std())
                d = torch.stack(diffs).sum(0) / (len(diffs) / 2)
                dirs.append(d[0] / (d.std() + 1e-6))
        finally:
            hook.remove()
        unit = torch.stack(scale).mean()
        directions = torch.stack(dirs) * unit
        self.bender.directions = directions.to(DTYPE)
        torch.save({"axes": list(HSPACE_AXES), "directions": directions.cpu()}, cache)

    @torch.inference_mode()
    def _capture(self) -> None:
        h, w = HEIGHT // 8, WIDTH // 8
        emb = self.embed("").clone()
        z = torch.zeros((1, 4, h, w), device=DEVICE, dtype=DTYPE)
        img = torch.zeros((1, 3, HEIGHT, WIDTH), device=DEVICE, dtype=DTYPE)
        t1 = torch.tensor([500], device=DEVICE)
        t2 = torch.tensor([500, 500], device=DEVICE)
        unet = lambda x, t, e: self.unet(x, t, encoder_hidden_states=e).sample
        pool = torch.cuda.graph_pool_handle()
        self.graphs = {
            "unet1": Graphed(unet, z, t1, emb, pool=pool),
            "unet2": Graphed(unet, torch.cat([z, z]), t2, torch.cat([emb, emb]), pool=pool),
            "decode": Graphed(lambda x: self.taesd.decode(x).sample, z, pool=pool),
            "encode": Graphed(lambda x: self.taesd.encode(x).latents, img, pool=pool),
        }

    def _randn(self, gen: torch.Generator | None = None) -> torch.Tensor:
        return torch.randn((1, 4, self.h, self.w), generator=gen or self.gen, device=DEVICE, dtype=torch.float32)

    @torch.inference_mode()
    def embed(self, prompt: str) -> torch.Tensor:
        if prompt in self._emb_cache:
            self.embed_cache_hits += 1
            return self._emb_cache[prompt]
        self.embed_calls += 1
        ids = self.tokenizer(prompt, padding="max_length", max_length=self.tokenizer.model_max_length, truncation=True, return_tensors="pt").input_ids
        emb = self.text_encoder(ids.to(DEVICE))[0].to(DTYPE)
        if len(self._emb_cache) > 32:
            self._emb_cache.pop(next(iter(self._emb_cache)))
        self._emb_cache[prompt] = emb
        return emb

    def _key_timesteps(self, continuity: float) -> list[int]:
        # Trailing spacing, as SD-Turbo was distilled with: 999, 749, 499, 249.
        full = [self.train_steps - 1 - i * (self.train_steps // KEY_STEPS) for i in range(KEY_STEPS)]
        # continuity > 0 starts part-way down the trajectory from the live latent,
        # so the new scene grows out of the current one instead of cutting.
        skip = int(round(_clamp(continuity, 0.0, 0.9) * (KEY_STEPS - 1)))
        return full[skip:]

    @staticmethod
    def _stats(z: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return z.mean(dim=(2, 3), keepdim=True), z.std(dim=(2, 3), keepdim=True) + 1e-4

    def _smooth_field(self, channels: int, cells: int, gen: torch.Generator | None = None) -> torch.Tensor:
        """A smooth random field at display resolution, unit-ish amplitude."""
        coarse = torch.randn((1, channels, cells, max(2, round(cells * WIDTH / HEIGHT))), generator=gen or self.gen, device=DEVICE)
        return F.interpolate(coarse, size=(HEIGHT, WIDTH), mode="bicubic", align_corners=False)

    @staticmethod
    def _warp(img: torch.Tensor, zoom: float, angle: float, x: float, y: float, disp: torch.Tensor | None = None) -> torch.Tensor:
        if zoom == 0 and angle == 0 and x == 0 and y == 0 and disp is None:
            return img
        k = math.exp(-zoom)  # sample a smaller window = zoom in
        aspect = img.shape[3] / img.shape[2]
        cos, sin = math.cos(angle) * k, math.sin(angle) * k
        theta = torch.tensor([[cos, -sin / aspect, x * 2], [sin * aspect, cos, y * 2]], device=img.device, dtype=img.dtype).unsqueeze(0)
        grid = F.affine_grid(theta, list(img.shape), align_corners=False)
        if disp is not None:
            grid = grid + disp.permute(0, 2, 3, 1).to(grid.dtype)
        return F.grid_sample(img, grid, mode="bilinear", padding_mode="reflection", align_corners=False)

    def _flow(self, c: Control, dt: float) -> torch.Tensor:
        """Smooth displacement that evolves over time: content drifts and swirls
        like animation instead of being re-imagined in place."""
        self.phi += c.flowSpeed * dt
        f0, f1 = self.fields
        return (f0 * math.cos(self.phi) + f1 * math.sin(self.phi)) * (c.flow * 2)

    def _camera(self, c: Control, dt: float) -> tuple[list[float], list[float]]:
        """Integrate the audio-driven camera rates; a spring pulls every axis home."""
        before = list(self.cam)
        spring = math.exp(-0.6 * dt)
        # Lateral drift is only used when no fresh procedural source is
        # available. Let it provide gentle camera travel, but keep it from
        # translating the entire fallback image like a page swipe during a
        # capture gap or sidecar startup.
        rates = (c.zoom, c.rotate, c.driftX * 0.25, c.driftY * 0.25)
        limits = ((-0.2, 0.55), (-0.5, 0.5), (-0.08, 0.08), (-0.08, 0.08))
        self.cam = [_clamp((v + r * dt) * spring, lo, hi) for v, r, (lo, hi) in zip(self.cam, rates, limits)]
        return before, self.cam

    # ---------- procedural source ----------

    def set_source(self, jpeg: bytes) -> None:
        """Called from the socket side: decode now, upload on the engine thread."""
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return
        if img.shape[1] != WIDTH or img.shape[0] != HEIGHT:
            img = cv2.resize(img, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
        self.source_np = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        self.source_at = time.perf_counter()

    def _source(self) -> torch.Tensor | None:
        """The procedural frame, if a fresh one exists (< 1 s old)."""
        if time.perf_counter() - self.source_at > 1.0:
            return None
        arr, self.source_np = self.source_np, None
        if arr is not None:
            t = torch.from_numpy(arr).to(DEVICE).permute(2, 0, 1).unsqueeze(0).float()
            self.source = t / 127.5 - 1
        return self.source

    # ---------- prompt blend ----------

    def set_blend(self, msg: dict) -> None:
        """Latest wins. Embeddings are computed on the engine thread."""
        prompts = [str(p) for p in msg.get("prompts", [])][:4]
        weights = [max(0.0, float(w)) for w in msg.get("weights", [])][: len(prompts)]
        if not prompts or sum(weights) <= 0:
            self.blend_target = None
            return
        self.blend_target = dict(zip(prompts, weights))
        self.blend_tau = _clamp(float(msg.get("tau", 2.0)), 0.05, 30.0)

    def _blend(self, dt: float) -> torch.Tensor | None:
        """Glide the weights toward the target and return the blended embedding.

        A plain weighted mean of CLIP embeddings shrinks their per-token norm,
        which SD reads as a weaker prompt, so each token is rescaled to the
        weighted mean of the anchors' norms.
        """
        target = self.blend_target
        if target is None:
            return None
        if not self.blend_weights:
            # Start from whatever is on screen, so the first blend never jumps.
            self.blend_base = self.emb.clone() if self.emb is not None else None
            self.blend_weights = {"__base__": 1.0} if self.blend_base is not None else {}
        k = 1 - math.exp(-dt / self.blend_tau)
        for p in set(self.blend_weights) | set(target):
            w = self.blend_weights.get(p, 0.0)
            self.blend_weights[p] = w + (target.get(p, 0.0) - w) * k
        self.blend_weights = {p: w for p, w in self.blend_weights.items() if w > 1e-3 or p in target}
        total = sum(self.blend_weights.values())
        if total <= 0:
            return None
        embs = [(self.blend_base if p == "__base__" else self.embed(p)).float() for p in self.blend_weights]
        ws = [w / total for w in self.blend_weights.values()]
        mix = sum(w * e for w, e in zip(ws, embs))
        norm = sum(w * e.norm(dim=-1, keepdim=True) for w, e in zip(ws, embs))
        mix = mix / (mix.norm(dim=-1, keepdim=True) + 1e-6) * norm
        return mix.to(DTYPE)

    # ---------- System 2 ----------

    def request_checkpoint(self, msg: dict) -> None:
        # The browser owns semantic state; the sidecar only consumes the small
        # realization decision needed by this backend. An identity break must
        # not accidentally reuse the current latent through the procedural
        # source path. Action/camera-only changes preserve the live substrate.
        realization = normalize_realization_request(msg)
        if realization is not None:
            # Structured state is authoritative for this backend's transition
            # metadata. Prompt/look remain compiled compatibility artifacts.
            legacy = realization["legacy"]
            structured_prompt = compile_structured_prompt(realization)
            conditioning_summary = structured_conditioning_summary(realization, structured_prompt)
            self.semantic_hspace = structured_hspace(realization)
            msg = {
                **msg,
                "prompt": structured_prompt or legacy.get("prompt", msg.get("prompt", "")),
                "look": legacy.get("look", msg.get("look")),
                "seed": legacy.get("seed", msg.get("seed", 0)),
                "continuity": legacy.get("continuity", msg.get("continuity", 0.0)),
                "spliceFrames": legacy.get("spliceFrames", msg.get("spliceFrames", 24)),
                "worldDiff": realization["diff"],
            }
            self.last_realization = {
                "structured": True,
                "worldRevision": realization["shot"].get("worldRevision"),
                "shotId": realization["shot"].get("id"),
                "grammar": realization["shot"].get("grammar"),
                "continuousForces": realization["continuousForces"],
                "resonance": realization.get("resonance"),
                "conditioning": "structured-world-v2",
                "conditioningFields": conditioning_summary["fields"],
                "conditioningHash": conditioning_summary["promptSha256"],
                "conditioningEntities": conditioning_summary["entityCount"],
                "conditioningEmergentHypotheses": conditioning_summary["emergentHypothesisCount"],
                "conditioningHspace": self.semantic_hspace,
            }
        else:
            self.last_realization = {"structured": False}
        diff = msg.get("worldDiff")
        if isinstance(diff, dict):
            self.last_world_diff = {
                "identityBreak": bool(diff.get("identityBreak", False)),
                "requiresKeyframe": bool(diff.get("requiresKeyframe", False)),
                "keep": len(diff.get("keep", [])) if isinstance(diff.get("keep"), list) else 0,
                "add": len(diff.get("add", [])) if isinstance(diff.get("add"), list) else 0,
                "remove": len(diff.get("remove", [])) if isinstance(diff.get("remove"), list) else 0,
            }
            if self.last_world_diff["identityBreak"]:
                msg = {**msg, "continuity": 0.0}
        self.pending = msg  # latest wins; picked up at the next frame boundary

    def _start_job(self, msg: dict) -> None:
        emb = self.embed(str(msg.get("prompt", "")))
        seed = int(msg.get("seed", 0)) & 0x7FFFFFFF
        gen = torch.Generator(DEVICE).manual_seed(seed)
        continuity = float(msg.get("continuity", 0.0)) if self.z is not None else 0.0
        world_diff = msg.get("worldDiff") if isinstance(msg.get("worldDiff"), dict) else {}
        identity_break = bool(world_diff.get("identityBreak", False))
        source = None if identity_break else self._source()
        if source is not None:
            # Paint the director's scene over the procedural structure, so the
            # keyframe and the live loop agree on where things are.
            continuity = max(continuity, 0.5)
            base = self._encode(source)
        else:
            base = self.z if (self.z is not None and continuity > 0.05) else torch.zeros_like(self._randn())
        steps = self._key_timesteps(continuity)
        a = self.alphas[steps[0]]
        z = a.sqrt() * base + (1 - a).sqrt() * self._randn(gen)
        self.job = KeyJob(
            id=str(msg.get("id", seed)), emb=emb, z=z, timesteps=steps,
            splice_frames=max(1, int(msg.get("spliceFrames", 24))),
        )
        # Re-seed the coherent noise field too, so texture statistics follow the scene.
        self.n0, self.n1 = self._randn(gen), self._randn(gen)
        self.fields = (self._smooth_field(2, 5, gen), self._smooth_field(2, 5, gen))
        self.flow_prev = None

    # ---------- the frame ----------

    @torch.inference_mode()
    def step(self, c: Control, dt: float) -> tuple[np.ndarray | None, dict]:
        t0 = time.perf_counter()
        c = apply_resonance(c)
        self.control = c
        if self.pending is not None and (self.job is None or self.job.phase == "splicing"):
            if self.job is not None:  # a newer request pre-empts an unfinished splice: land it now
                self._finish_splice()
            self._start_job(self.pending)
            self.pending = None

        job = self.job
        # Cold start: nothing to feed back yet, so run the whole keyframe now.
        if self.z is None:
            if job is None:
                return None, {"phase": "waiting"}
            while job.step < len(job.timesteps):
                self._key_step(job, None)
            self.z, self.emb, self.home = job.x0, job.emb, self._decode(job.x0)
            self.img = None
            self.anchor = self._stats(self.z)
            self.last_key = {"id": job.id, "ms": round((time.perf_counter() - job.started) * 1000)}
            self.job = None
            job = None

        assert self.z is not None and self.emb is not None and self.home is not None
        prev = self.z
        if self.img is None:
            self.img = self._decode(self.z)
        # The loop needs a fresh external frame every step: that is what makes
        # StreamDiffusion stable, while a loop fed only its own output wanders
        # to an attractor within ~100 frames (ADR-004). The external frame is
        # the procedural scene when the browser is sending it, else the
        # keyframe moved by the camera and flow field. `feedback` blends a
        # little of the previous frame over it: the loop's memory.
        source = self._source()
        if source is not None:
            # The procedural scene already carries camera and flow motion, and
            # moves at display rate: paint it as it is, with a little memory.
            self.input_kind = "procedural"
            self.flow_prev = None  # a later keyframe fallback starts its flow delta fresh
            view = torch.lerp(source, self.img, c.feedback)
        else:
            self.input_kind = "keyframe"
            before, cam = self._camera(c, dt)
            flow = self._flow(c, dt)
            key_view = self._warp(self.home, *cam, disp=flow)
            delta = [b - a for a, b in zip(before, cam)]
            step = flow - self.flow_prev if self.flow_prev is not None else None
            self.flow_prev = flow
            memory = self._warp(self.img, *delta, disp=step)
            view = torch.lerp(key_view, memory, c.feedback)
        z = self._encode(view)
        if self.anchor is not None:
            m, s = self._stats(z)
            am, as_ = self.anchor
            z = (z - m) / s * (s + (as_ - s) * 0.05) + (m + (am - m) * 0.05)

        self.theta += c.noiseWalk * dt
        coherent = self.n0 * math.cos(self.theta) + self.n1 * math.sin(self.theta)
        g = c.noise
        fresh = self._randn()
        eps = coherent * math.sqrt(1 - g * g) + fresh * g
        if c.detail > 0:
            # Detail lives in the noise, so each step denoises it rather than
            # letting it accumulate in the feedback state.
            eps = eps + (fresh - F.avg_pool2d(fresh, 3, 1, 1)) * c.detail

        t_fast = int(round(c.strength * (self.train_steps - 1)))
        a = self.alphas[t_fast]
        x_t = a.sqrt() * z + (1 - a).sqrt() * eps

        blended = self._blend(dt)
        if blended is not None:
            # A live blend owns the prompt: keyframes still ground the image,
            # but the meaning glides with the director's weights.
            self.emb = blended
        emb = self.emb
        if job is not None and job.phase == "denoising":
            # Batch the keyframe step with the live frame: one UNet call, batch 2.
            z_new = self._key_step(job, (x_t, t_fast, emb))
        else:
            eps_pred = self._unet(x_t, [t_fast], emb, live=[1.0])
            z_new = (x_t - (1 - a).sqrt() * eps_pred) / a.sqrt()

        if job is not None and job.phase == "splicing" and job.x0 is not None:
            # Paint-in: the new keyframe is drawn into the input region by
            # region, in the order of a smooth random field, and the loop
            # re-renders across the seam. The live frame is never swapped
            # wholesale, so a scene change reads as the picture being redrawn.
            job.splice_pos += 1
            w = job.splice_pos / job.splice_frames
            edge = 0.15
            mask = ((w * (1 + edge) - job.reveal) / edge).clamp(0, 1)
            mask = mask * mask * (3 - 2 * mask)
            emb = torch.lerp(self.emb, job.emb, w * w * (3 - 2 * w))
            home = torch.lerp(self.home, job.home, mask)
            if job.splice_pos >= job.splice_frames:
                self._finish_splice()
                emb, home = self.emb, self.home
            self.home = home

        self.emb = emb
        delta_z = z_new - prev
        change = delta_z.abs().mean().item()
        # Jitter: second difference of the latent. Smooth motion (even fast)
        # changes by a similar amount each frame and scores low; boiling and
        # flicker reverse direction frame to frame and score high.
        jitter = (delta_z - self.last_delta).abs().mean().item() if self.last_delta is not None else 0.0
        self.last_delta = delta_z
        drift = ((z_new.mean(dim=(2, 3), keepdim=True) - self.anchor[0]).abs().mean().item()) if self.anchor else 0.0
        self.z = z_new

        self.img = self._decode(z_new)
        img = ((self.img[0] + 1) * 127.5).round().to(torch.uint8).permute(1, 2, 0).cpu().numpy()

        job = self.job
        meta = {
            "phase": job.phase if job else "idle",
            "checkpoint": job.id if job else self.last_key["id"],
            "progress": (job.step / len(job.timesteps) * 0.5 + (job.splice_pos / job.splice_frames) * 0.5) if job else 1.0,
            "keyMs": self.last_key["ms"],
            "worldDiff": self.last_world_diff,
            "realization": self.last_realization,
            "strength": round(c.strength, 3),
            "change": round(change, 4),
            "jitter": round(jitter, 4),
            "input": self.input_kind,
            "blend": {p[:40]: round(w, 3) for p, w in self.blend_weights.items()} if self.blend_target else None,
            "drift": round(drift, 4),
            "genMs": round((time.perf_counter() - t0) * 1000, 1),
            "controlSeq": c.seq,
            "resonance": c.resonance,
        }
        return img, meta

    def _decode(self, z: torch.Tensor) -> torch.Tensor:
        g = self.graphs.get("decode")
        out = g(z.to(DTYPE)) if g else self.taesd.decode(z.to(DTYPE)).sample
        return out.float().clamp(-1, 1)  # .float() copies out of the static buffer

    def _encode(self, img: torch.Tensor) -> torch.Tensor:
        g = self.graphs.get("encode")
        return (g(img.to(DTYPE)) if g else self.taesd.encode(img.to(DTYPE)).latents).float()

    def _unet(self, x: torch.Tensor, ts: list[int], emb: torch.Tensor, live: list[float] | None = None) -> torch.Tensor:
        """`live` flags which batch samples are the live frame (bent); default: none."""
        # Add the persistent structured direction to the audio/knob control.
        # The bounded 0.35 gain keeps semantic intent legible without letting
        # a checkpoint overpower the continuous audio physics.
        semantic = self.semantic_hspace
        bent = replace(
            self.control,
            hsEnergy=_clamp(self.control.hsEnergy + 0.35 * semantic["energy"], -1.5, 1.5),
            hsLight=_clamp(self.control.hsLight + 0.35 * semantic["light"], -1.5, 1.5),
            hsOrganic=_clamp(self.control.hsOrganic + 0.35 * semantic["organic"], -1.5, 1.5),
        )
        self.bender.set(bent, live or [0.0] * len(ts))
        t = torch.tensor(ts, device=DEVICE)
        g = self.graphs.get("unet1" if len(ts) == 1 else "unet2")
        if g is not None and x.shape[-2:] == g.inputs[0].shape[-2:]:
            return g(x.to(DTYPE), t, emb).float()
        return self.unet(x.to(DTYPE), t, encoder_hidden_states=emb).sample.float()

    def _key_step(self, job: KeyJob, live: tuple[torch.Tensor, int, torch.Tensor] | None) -> torch.Tensor | None:
        t = job.timesteps[job.step]
        a = self.alphas[t]
        if live is None:
            eps_key = self._unet(job.z, [t], job.emb)
            live_x0 = None
        else:
            x_live, t_live, emb_live = live
            eps = self._unet(torch.cat([x_live, job.z]), [t_live, t], torch.cat([emb_live, job.emb]), live=[1.0, 0.0])
            a_live = self.alphas[t_live]
            live_x0 = (x_live - (1 - a_live).sqrt() * eps[:1]) / a_live.sqrt()
            eps_key = eps[1:]
        x0 = (job.z - (1 - a).sqrt() * eps_key) / a.sqrt()
        job.step += 1
        if job.step < len(job.timesteps):
            # Distilled multi-step sampling re-noises the x0 estimate with fresh noise.
            a_next = self.alphas[job.timesteps[job.step]]
            job.z = a_next.sqrt() * x0 + (1 - a_next).sqrt() * torch.randn_like(x0)
        else:
            job.x0 = x0
            job.home = self._decode(x0)
            r = self._smooth_field(1, 3)
            job.reveal = (r - r.min()) / (r.max() - r.min() + 1e-6)
            self.last_key = {"id": job.id, "ms": round((time.perf_counter() - job.started) * 1000)}
        return live_x0

    def _finish_splice(self) -> None:
        job = self.job
        if job is None:
            return
        if job.x0 is not None:
            self.emb = job.emb
            self.home = job.home
            self.anchor = self._stats(job.x0)
        self.job = None


class Stream:
    """Runs the engine on its own thread; the asyncio side only moves bytes."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.control = Control()
        self.lock = threading.Lock()
        self.clients = 0
        self.owner = None  # the one websocket allowed to steer the engine
        self.latest: bytes | None = None
        self.frame = 0
        self.fps = 0.0
        self.loop: asyncio.AbstractEventLoop | None = None
        self.new_frame: asyncio.Event | None = None
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        last = time.perf_counter()
        ema = 0.0
        while True:
            if self.clients == 0:
                time.sleep(0.05)
                last = time.perf_counter()
                continue
            now = time.perf_counter()
            dt = min(now - last, 0.2)
            last = now
            with self.lock:
                c = self.control
            try:
                img, meta = self.engine.step(c, dt)
            except Exception as exc:  # keep serving; the browser shows the error
                import traceback
                traceback.print_exc()
                img, meta = None, {"phase": "error", "error": str(exc)}
            if img is None:
                time.sleep(0.02)
                self._publish(meta, b"")
                continue
            ema = dt if ema == 0 else ema * 0.9 + dt * 0.1
            self.fps = 1.0 / max(ema, 1e-3)
            ok, jpg = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            self.frame += 1
            meta.update({"frame": self.frame, "fps": round(self.fps, 1), "width": img.shape[1], "height": img.shape[0]})
            encoded = jpg.tobytes() if ok else b""
            if EVAL_DIR and self.frame % EVAL_EVERY == 0:
                name = f"frame-{self.frame:08d}.jpg"
                (EVAL_DIR / name).write_bytes(encoded)
                with (EVAL_DIR / "frames.jsonl").open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps({"file": name, "meta": meta}) + "\n")
            self._publish(meta, encoded)
            spare = 1.0 / MAX_FPS - (time.perf_counter() - now)
            if spare > 0:
                time.sleep(spare)

    def _publish(self, meta: dict, jpg: bytes) -> None:
        head = json.dumps(meta).encode()
        self.latest = struct.pack("<I", len(head)) + head + jpg
        loop = self.loop
        event = self.new_frame
        if loop and event and not loop.is_closed():
            try:
                loop.call_soon_threadsafe(event.set)
            except RuntimeError:
                # The engine thread can finish one frame after Ctrl+C closes
                # the websocket loop. This is normal shutdown, not a render
                # failure, and must not create a traceback.
                pass


async def serve(stream: Stream) -> None:
    from websockets.asyncio.server import serve as ws_serve
    from websockets.exceptions import ConnectionClosed

    stream.loop = asyncio.get_running_loop()
    stream.new_frame = asyncio.Event()

    async def handler(ws) -> None:
        # One engine, one driver, and the first one keeps it: a second window
        # (a test tab, a duplicate app) is turned away and retries, so it can
        # never strand the session that was already running. When the owner
        # disconnects, the next retry takes over.
        if stream.owner is not None:
            await ws.close(1013, "busy: another client owns the stream")
            return
        stream.owner = ws
        stream.clients += 1
        await ws.send(json.dumps({
            "type": "ready", "width": WIDTH, "height": HEIGHT, "model": MODEL_DIR.name,
            "device": torch.cuda.get_device_name(0) if DEVICE == "cuda" else "cpu",
            "vramMB": round(torch.cuda.memory_allocated() / 2**20) if DEVICE == "cuda" else 0,
            "buildHash": BUILD_HASH,
        }))

        async def sender() -> None:
            sent = None
            while True:
                await stream.new_frame.wait()
                stream.new_frame.clear()
                data = stream.latest
                if data is not None and data is not sent:
                    sent = data
                    await ws.send(data)  # awaiting here is the backpressure: slow clients just skip frames

        task = asyncio.create_task(sender())
        try:
            async for raw in ws:
                if ws is not stream.owner:
                    continue
                if isinstance(raw, bytes):
                    stream.engine.set_source(raw)  # procedural camera frame
                    continue
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "control":
                    c = Control.parse(msg)
                    with stream.lock:
                        stream.control = c
                elif kind == "checkpoint":
                    with stream.lock:
                        stream.engine.request_checkpoint(msg)
                elif kind == "blend":
                    with stream.lock:
                        stream.engine.set_blend(msg)
                elif kind == "track":
                    # Song concepts for the scene compiler. The artist is
                    # never used: a name invites the model to draw a person.
                    words = title_concepts(str(msg.get("title", "")), stream.engine.tokenizer)
                    await ws.send(json.dumps({"type": "concepts", "trackId": msg.get("trackId"), "words": words}))
                    meaning = load_local_meaning(
                        str(msg.get("trackId", "")),
                        str(msg.get("title", "")),
                        str(msg.get("artist", "")),
                    )
                    await ws.send(json.dumps({
                        "type": "meaning",
                        "trackId": msg.get("trackId"),
                        "meaning": meaning,
                    }))
        except (ConnectionClosed, ConnectionResetError, OSError):
            # Browser/Electron shutdown closes the socket while the sidecar
            # may still be producing its last frame. Treat that as a normal
            # owner handoff so restart logs retain only actionable failures.
            pass
        finally:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, ConnectionClosed, ConnectionResetError, OSError):
                pass
            stream.clients -= 1
            if stream.owner is ws:
                stream.owner = None

    async with ws_serve(handler, "127.0.0.1", PORT, max_size=2**22, compression=None):
        print(f"stream sidecar on ws://127.0.0.1:{PORT}  {WIDTH}x{HEIGHT}  {MODEL_DIR.name}", flush=True)
        await asyncio.Future()


def bench(frames: int, report_path: str | None = None) -> None:
    engine = Engine()
    print(f"loaded in {engine.load_s:.1f}s on {DEVICE}; vram {torch.cuda.memory_allocated() / 2**20:.0f} MB" if DEVICE == "cuda" else "loaded (cpu)")
    out = ROOT / "output" / "stream-bench"
    out.mkdir(parents=True, exist_ok=True)
    engine.request_checkpoint({"id": "a", "prompt": "bioluminescent coral cathedral, deep ocean, volumetric light", "seed": 1, "spliceFrames": 16})
    times: list[float] = []
    stage_ms: dict[str, list[float]] = {"encode": [], "unet": [], "decode": []}
    stage_events: list[tuple[str, torch.cuda.Event, torch.cuda.Event]] = []
    if DEVICE == "cuda":
        # Diagnose-only timers around each accelerated stage, so the next
        # optimization targets the measured bottleneck. Engine numerics are
        # untouched: each wrapper records cuda events and forwards the call.
        # All UNet work (live and keyframe) flows through _unet, so the
        # split below covers steady-state, denoising, and splice phases.
        _orig = (engine._encode, engine._unet, engine._decode)

        def _timed(name: str, fn):  # type: ignore[no-untyped-def]
            def wrapper(*args, **kwargs):  # type: ignore[no-untyped-def]
                start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
                start.record()
                out = fn(*args, **kwargs)
                end.record()
                stage_events.append((name, start, end))
                return out

            return wrapper

        engine._encode = _timed("encode", _orig[0])
        engine._unet = _timed("unet", _orig[1])
        engine._decode = _timed("decode", _orig[2])
    for i in range(frames):
        beat = i % 15 == 0
        c = Control(strength=0.3 + (0.2 if beat else 0.0), noise=0.1, detail=0.15, zoom=0.1 + (1.5 if beat else 0.0), rotate=0.08, noiseWalk=0.8, feedback=0.15, flow=0.04, flowSpeed=0.6)
        if i == frames // 3:
            engine.request_checkpoint({"id": "b", "prompt": "molten ember desert canyon at dusk, cinematic", "seed": 7, "continuity": 0.4, "spliceFrames": 16})
        if DEVICE == "cuda":
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        img, meta = engine.step(c, 1 / 20)
        if DEVICE == "cuda":
            torch.cuda.synchronize()
        times.append(time.perf_counter() - t0)
        if DEVICE == "cuda":
            for name, start, end in stage_events:
                if len(times) > 5:
                    stage_ms[name].append(start.elapsed_time(end))
            stage_events.clear()
        if img is not None and i % max(1, frames // 10) == 0:
            cv2.imwrite(str(out / f"frame-{i:04d}.jpg"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
        if i < 3 or meta.get("phase") != "idle" and i % 5 == 0:
            print(i, meta)
    warm = sorted(times[5:])
    median_ms = warm[len(warm) // 2] * 1000
    p90_ms = warm[min(len(warm) - 1, int(len(warm) * 0.9))] * 1000
    p95_ms = warm[min(len(warm) - 1, int(len(warm) * 0.95))] * 1000
    report = {
        "frames": len(times),
        "warmupFrames": min(5, len(times)),
        "width": WIDTH,
        "height": HEIGHT,
        "device": DEVICE,
        "dtype": str(DTYPE),
        "medianMs": round(median_ms, 3),
        "p90Ms": round(p90_ms, 3),
        "p95Ms": round(p95_ms, 3),
        "fps": round(1000 / median_ms, 3) if median_ms else 0,
        "includesJpeg": False,
        "stageMedianMs": {},
        "stageCalls": {},
        "textEncoderCalls": engine.embed_calls,
        "textEncoderCacheHits": engine.embed_cache_hits,
    }
    print(f"frames {len(times)}  median {median_ms:.1f} ms  p90 {p90_ms:.1f} ms  p95 {p95_ms:.1f} ms"
          f"  -> {report['fps']:.1f} fps (engine only, excl. JPEG)")
    for name, samples in stage_ms.items():
        if not samples:
            continue
        ordered = sorted(samples)
        med = ordered[len(ordered) // 2]
        report["stageMedianMs"][name] = round(med, 3)
        report["stageCalls"][name] = len(ordered)
        print(f"stage {name}: median {med:.1f} ms over {len(ordered)} calls")
    if DEVICE == "cuda":
        report["peakVramMb"] = round(torch.cuda.max_memory_allocated() / 2**20, 1)
        report["totalVramMb"] = round(torch.cuda.get_device_properties(0).total_memory / 2**20, 1)
        print(f"peak vram {report['peakVramMb']:.0f} MB of {report['totalVramMb']:.0f} MB")
    if report_path:
        path = Path(report_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"benchmark report in {path}")
    print(f"sample frames in {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", type=int, default=0, help="run N frames headless and report throughput")
    ap.add_argument("--bench-json", default=None, help="also write the benchmark report as JSON")
    args = ap.parse_args()
    if args.bench:
        bench(args.bench, args.bench_json)
    else:
        asyncio.run(serve(Stream(Engine())))
