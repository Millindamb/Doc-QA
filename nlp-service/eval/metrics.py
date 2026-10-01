"""Pure metric helpers for the evaluation (no I/O, unit-tested in tests/test_eval_metrics.py)."""
from __future__ import annotations

import re
from typing import Iterable, Sequence

from app.services.retrieval import stem


def relevant_flags(chunk_texts: Sequence[str], phrases: Sequence[str]) -> list[bool]:
    """A chunk is relevant if it contains ANY gold phrase (case-insensitive, whitespace-normalised)."""
    norm = lambda s: re.sub(r"\s+", " ", s.lower())  # noqa: E731
    ps = [norm(p) for p in phrases if p.strip()]
    return [any(p in norm(t) for p in ps) for t in chunk_texts]


def recall_at_k(ranked_relevance: Sequence[bool], k: int) -> float:
    """1.0 if any relevant chunk is in the top k, else 0.0 (per question; average over questions for the score)."""
    return 1.0 if any(ranked_relevance[:k]) else 0.0


def reciprocal_rank(ranked_relevance: Sequence[bool]) -> float:
    for i, rel in enumerate(ranked_relevance, start=1):
        if rel:
            return 1.0 / i
    return 0.0


def mean(values: Iterable[float]) -> float:
    vals = list(values)
    return sum(vals) / len(vals) if vals else 0.0


def _stems(text: str) -> set[str]:
    return {stem(w) for w in re.findall(r"[a-z0-9+.]+", text.lower()) if w}


def fact_recall(answer: str, facts: Sequence[str]) -> float:
    """Share of gold facts present in the answer (stem-aware substring/token match)."""
    if not facts:
        return 0.0
    low = answer.lower()
    ans_stems = _stems(answer)
    hit = 0
    for f in facts:
        if f.lower() in low or (_stems(f) and _stems(f) <= ans_stems):
            hit += 1
    return hit / len(facts)


_ABSTAIN = re.compile(
    r"(not (?:in|found in|covered|mentioned|contained)|does not (?:contain|mention|cover|include)|"
    r"insufficient|cannot find|can't find|couldn't find|could not find|no information|not enough (?:information|context)|"
    r"outside (?:the|this) document|\[\[insufficient_context\]\])",
    re.I,
)


def abstained(answer: str) -> bool:
    """Did the answer say the document cannot support it (used for unanswerable questions)?"""
    return bool(_ABSTAIN.search(answer))


def markdown_table(headers: Sequence[str], rows: Sequence[Sequence[object]]) -> str:
    def cell(v: object) -> str:
        return f"{v:.3f}" if isinstance(v, float) else str(v)

    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(cell(v) for v in r) + " |" for r in rows]
    return "\n".join(lines)
