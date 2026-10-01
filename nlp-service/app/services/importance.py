"""Exam-mode importance scoring.

Per sentence, computes six normalized (0..1) features and combines them with
configurable weights (see config.py) into one importance score. Per-chunk
scores are the mean of their member sentences' scores/features.
"""
from __future__ import annotations

import re
from collections import defaultdict

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from app.config import settings
from app.models.document import SentenceInfo

_DEFINITION_PATTERNS = [
    re.compile(r"\bis defined as\b", re.IGNORECASE),
    re.compile(r"\brefers to\b", re.IGNORECASE),
    re.compile(r"\bis called\b", re.IGNORECASE),
    re.compile(r"\bare called\b", re.IGNORECASE),
    re.compile(r"\bmeans\b", re.IGNORECASE),
    re.compile(r"\bis known as\b", re.IGNORECASE),
    re.compile(r"\bcan be defined as\b", re.IGNORECASE),
]

_NUMERIC_RE = re.compile(
    r"""(
        \d+([.,]\d+)?%?          # plain numbers, decimals, percentages
        | \b\d{4}\b               # years / dates
        | [=+\-*/^]               # simple formula/equation operators
        | \b\d+\s*(kg|km|cm|mm|ms|mg|ml|g|m|s|hz|kb|mb|gb)\b
    )""",
    re.IGNORECASE | re.VERBOSE,
)


def _tfidf_sentence_scores(sentences: list[SentenceInfo]) -> dict[int, float]:
    texts = [s.text for s in sentences]
    if not texts:
        return {}
    try:
        vectorizer = TfidfVectorizer(stop_words="english")
        matrix = vectorizer.fit_transform(texts)
    except ValueError:
        return {s.position: 0.0 for s in sentences}

    dense = matrix.toarray()
    row_means = np.array([row[row > 0].mean() if (row > 0).any() else 0.0 for row in dense])
    max_val = row_means.max() if row_means.size else 0.0
    if max_val <= 0:
        max_val = 1.0
    return {s.position: float(row_means[i] / max_val) for i, s in enumerate(sentences)}


def _position_score(position: int, n: int) -> float:
    if n <= 1:
        return 1.0
    relative = position / (n - 1)
    near_start = max(0.0, 1 - relative / 0.15)
    near_end = max(0.0, 1 - (1 - relative) / 0.15)
    return min(1.0, max(near_start, near_end))


def _definition_score(text: str) -> float:
    return 1.0 if any(p.search(text) for p in _DEFINITION_PATTERNS) else 0.0


def _numeric_score(text: str) -> float:
    matches = _NUMERIC_RE.findall(text)
    if not matches:
        return 0.0
    # scale gently: 1 hit is already meaningful, more hits saturate toward 1
    return min(1.0, 0.4 + 0.2 * len(matches))


def compute_importance(
    sentences: list[SentenceInfo], textrank_scores: dict[int, float]
) -> tuple[list[dict], list[dict]]:
    """Return (sentence_importance[], chunk_importance[])."""
    n = len(sentences)
    if n == 0:
        return [], []

    tfidf_scores = _tfidf_sentence_scores(sentences)

    w = settings
    sentence_results: list[dict] = []
    by_chunk: dict[str, list[dict]] = defaultdict(list)

    for s in sentences:
        features = {
            "tfidf": round(tfidf_scores.get(s.position, 0.0), 4),
            "heading": 1.0 if s.heading.strip() else 0.0,
            "definition": _definition_score(s.text),
            "numeric": _numeric_score(s.text),
            "position": round(_position_score(s.position, n), 4),
            "textrank": round(textrank_scores.get(s.position, 0.0), 4),
        }
        score = (
            features["tfidf"] * w.importance_weight_tfidf
            + features["heading"] * w.importance_weight_heading
            + features["definition"] * w.importance_weight_definition
            + features["numeric"] * w.importance_weight_numeric
            + features["position"] * w.importance_weight_position
            + features["textrank"] * w.importance_weight_textrank
        )
        entry = {
            "text": s.text,
            "chunk_id": s.chunk_id,
            "position": s.position,
            "score": round(score, 4),
            "features": features,
        }
        sentence_results.append(entry)
        by_chunk[s.chunk_id].append(entry)

    sentence_results.sort(key=lambda e: -e["score"])

    chunk_results: list[dict] = []
    for chunk_id, entries in by_chunk.items():
        avg_score = sum(e["score"] for e in entries) / len(entries)
        avg_features = {
            key: round(sum(e["features"][key] for e in entries) / len(entries), 4)
            for key in ("tfidf", "heading", "definition", "numeric", "position", "textrank")
        }
        chunk_results.append({"chunk_id": chunk_id, "score": round(avg_score, 4), "features": avg_features})

    chunk_results.sort(key=lambda e: -e["score"])
    return sentence_results, chunk_results
