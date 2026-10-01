"""TF-IDF keyword/phrase extraction across a document's chunks (scikit-learn)."""
from __future__ import annotations

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer


def extract_tfidf_keywords(
    chunk_texts: list[str], top_n: int = 15, ngram_range: tuple[int, int] = (1, 2)
) -> list[tuple[str, float]]:
    """Fit TF-IDF over the chunks (each chunk = one 'document') and return the
    top_n terms by summed TF-IDF weight across the whole document, normalized
    to 0..1.
    """
    texts = [t for t in chunk_texts if t and t.strip()]
    if not texts:
        return []

    vectorizer = TfidfVectorizer(
        stop_words="english",
        ngram_range=ngram_range,
        max_features=2000,
        min_df=1,
    )
    try:
        matrix = vectorizer.fit_transform(texts)
    except ValueError:
        return []

    terms = vectorizer.get_feature_names_out()
    scores = np.asarray(matrix.sum(axis=0)).ravel()

    if scores.max() > 0:
        scores = scores / scores.max()

    order = np.argsort(-scores)[:top_n]
    return [(terms[i], float(scores[i])) for i in order if scores[i] > 0]


def fit_tfidf_vectorizer(chunk_texts: list[str]) -> tuple[TfidfVectorizer | None, np.ndarray | None]:
    """Shared helper for callers (topics.py) that need the fitted vectorizer +
    per-chunk TF-IDF matrix (e.g. to label clusters with their top terms)."""
    texts = [t if t and t.strip() else " " for t in chunk_texts]
    if not texts:
        return None, None
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=2000, min_df=1)
    try:
        matrix = vectorizer.fit_transform(texts)
    except ValueError:
        return None, None
    return vectorizer, matrix
