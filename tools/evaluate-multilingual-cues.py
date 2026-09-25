"""Offline multilingual cue-ranking experiment.

This is deliberately not imported by the renderer or meaning server. It tests
whether a small multilingual encoder can propose bounded perceptual cues for
the held-out fixture. Similarity is proposal evidence only; no result here is
allowed to create a world entity or action in the application.

Example:
    python tools/evaluate-multilingual-cues.py \
      scripts/grounding-heldout.json --model intfloat/multilingual-e5-small
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import torch
from transformers import AutoModel, AutoTokenizer


MOTIFS = {
    "person": "a person, human figure, woman, man, child, or character",
    "place": "a place or environment such as a station, city, room, forest, river, or night",
    "object": "a concrete object such as a train, door, coat, bird, flower, phone, or dream",
    "force": "a natural or emotional force such as rain, wind, light, moonlight, fire, love, or darkness",
    "texture": "a material or surface quality such as fog, smoke, water, ice, glass, stone, or shadow",
}
ACTIONS = {
    "walks through the environment": "walking or traveling through an environment",
    "runs through the environment": "running through an environment",
    "waits in place": "standing, waiting, or remaining in place",
    "moves with a flowing motion": "flowing, drifting, swaying, or floating movement",
    "converges with another form": "gathering, meeting, crossing, or converging",
    "reveals or conceals space": "opening, closing, unfolding, or revealing space",
}


def mean_pool(outputs: Any, mask: torch.Tensor) -> torch.Tensor:
    hidden = outputs.last_hidden_state
    weights = mask.unsqueeze(-1).expand(hidden.size()).float()
    return (hidden * weights).sum(dim=1) / weights.sum(dim=1).clamp(min=1e-9)


def encode(texts: list[str], tokenizer: Any, model: Any, device: str) -> torch.Tensor:
    # E5 models use explicit query/passage prefixes. They are harmless for
    # other encoder checkpoints and keep this experiment reproducible.
    values = [text if text.startswith(("query: ", "passage: ")) else f"query: {text}" for text in texts]
    batch = tokenizer(values, padding=True, truncation=True, return_tensors="pt").to(device)
    with torch.inference_mode():
        vectors = mean_pool(model(**batch), batch["attention_mask"])
        return torch.nn.functional.normalize(vectors, p=2, dim=1).cpu()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--model", default="intfloat/multilingual-e5-small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threshold", type=float, default=0.60)
    parser.add_argument("--margin", type=float, default=0.04)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model).to(args.device).eval()
    labels = [("motif", key, value) for key, value in MOTIFS.items()]
    labels.extend(("action", key, value) for key, value in ACTIONS.items())
    label_vectors = encode([value for _, _, value in labels], tokenizer, model, args.device)

    rows: list[dict[str, Any]] = []
    for case in fixture["cases"]:
        vector = encode([case["text"]], tokenizer, model, args.device)[0]
        scores = torch.mv(label_vectors, vector).tolist()
        ranked = sorted(zip(scores, labels), key=lambda item: item[0], reverse=True)
        accepted: list[dict[str, Any]] = []
        # A cue's margin must compare it with its nearest competitor of the
        # same type. Comparing against the next global label makes every
        # widely separated label look confident and was caught by the first
        # held-out run.
        for kind in ("motif", "action"):
            typed = [(score, label) for score, (label_kind, label, _) in ranked if label_kind == kind]
            if not typed:
                continue
            score, label = typed[0]
            next_score = typed[1][0] if len(typed) > 1 else score
            if score >= args.threshold and score - next_score >= args.margin:
                accepted.append({"type": kind, "label": label, "score": round(score, 4), "margin": round(score - next_score, 4)})
        rows.append({
            "id": case["id"],
            "language": case["language"],
            "accepted": accepted,
            "top": {"type": ranked[0][1][0], "label": ranked[0][1][1], "score": round(ranked[0][0], 4)},
            "expectedKinds": case["expectedKinds"],
            "expectedAction": case["expectedAction"],
        })

    result = {
        "model": args.model,
        "device": args.device,
        "threshold": args.threshold,
        "margin": args.margin,
        "fixture": str(args.fixture),
        "warning": "Proposal-only experiment. Similarity does not authorize literal entity/action promotion.",
        "rows": rows,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
