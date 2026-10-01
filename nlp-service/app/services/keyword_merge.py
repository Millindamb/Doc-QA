"""Merge TF-IDF, RAKE and YAKE keyword lists into one combined ranking.

Each source returns (term, score) with score already normalized to 0..1
(highest = best) by its own module. We dedupe on a normalized key (lowercase,
whitespace-collapsed, trailing 's' stripped as a crude singularizer) and
combine with configurable weights.
"""
from __future__ import annotations

import re

from app.config import settings


def _normalize_key(term: str) -> str:
    key = re.sub(r"\s+", " ", term.strip().lower())
    if key.endswith("s") and len(key) > 3 and not key.endswith("ss"):
        key = key[:-1]
    return key


def merge_keywords(
    tfidf: list[tuple[str, float]],
    rake: list[tuple[str, float]],
    yake: list[tuple[str, float]],
    top_n: int = 15,
) -> list[dict]:
    by_key: dict[str, dict] = {}

    def ingest(items: list[tuple[str, float]], source: str):
        for term, score in items:
            key = _normalize_key(term)
            if not key:
                continue
            entry = by_key.setdefault(
                key, {"term": term, "sources": set(), "raw": {}}
            )
            entry["raw"][source] = max(entry["raw"].get(source, 0.0), float(score))
            entry["sources"].add(source)
            # prefer the shortest surface form as the display term (usually cleanest)
            if len(term) < len(entry["term"]):
                entry["term"] = term

    ingest(tfidf, "tfidf")
    ingest(rake, "rake")
    ingest(yake, "yake")

    weights = {
        "tfidf": settings.keyword_weight_tfidf,
        "rake": settings.keyword_weight_rake,
        "yake": settings.keyword_weight_yake,
    }

    results = []
    for entry in by_key.values():
        combined = sum(entry["raw"].get(src, 0.0) * w for src, w in weights.items())
        results.append(
            {
                "term": entry["term"],
                "score": round(combined, 4),
                "sources": sorted(entry["sources"]),
            }
        )

    results.sort(key=lambda r: -r["score"])
    return results[:top_n]
