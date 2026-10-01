"""TextRank, implemented from scratch: build a sentence similarity graph
(TF-IDF cosine similarity as edge weight) and run PageRank over it (networkx)
to score each sentence's importance.
"""
from __future__ import annotations

import networkx as nx
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.models.document import SentenceInfo


def compute_textrank_scores(
    sentences: list[SentenceInfo], damping: float = 0.85, min_similarity: float = 0.05
) -> dict[int, float]:
    """Return {sentence.position: normalized_score (0..1)}."""
    n = len(sentences)
    if n == 0:
        return {}
    if n == 1:
        return {sentences[0].position: 1.0}

    texts = [s.text for s in sentences]
    try:
        vectorizer = TfidfVectorizer(stop_words="english")
        matrix = vectorizer.fit_transform(texts)
    except ValueError:
        # e.g. all sentences were pure stopwords/empty after vectorization
        uniform = 1.0 / n
        return {s.position: uniform for s in sentences}

    similarity = cosine_similarity(matrix)
    np.fill_diagonal(similarity, 0.0)
    similarity[similarity < min_similarity] = 0.0

    graph = nx.from_numpy_array(similarity)
    try:
        scores = nx.pagerank(graph, alpha=damping, weight="weight")
    except nx.PowerIterationFailedConvergence:
        scores = {i: 1.0 / n for i in range(n)}

    max_score = max(scores.values()) if scores else 1.0
    if max_score <= 0:
        max_score = 1.0

    return {sentences[i].position: scores.get(i, 0.0) / max_score for i in range(n)}


def top_sentences_in_order(
    sentences: list[SentenceInfo], scores: dict[int, float], top_n: int
) -> list[dict]:
    """Pick the top_n highest-scoring sentences, then re-sort them back into
    original document order (standard extractive-summary presentation)."""
    ranked = sorted(sentences, key=lambda s: -scores.get(s.position, 0.0))[:top_n]
    ranked_positions = {s.position for s in ranked}
    ordered = [s for s in sentences if s.position in ranked_positions]

    return [
        {
            "text": s.text,
            "score": round(scores.get(s.position, 0.0), 4),
            "position": s.position,
            "chunk_id": s.chunk_id,
        }
        for s in ordered
    ]
