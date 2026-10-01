"""Chunk embeddings.

Primary path: sentence-transformers ``all-MiniLM-L6-v2`` (local model, 384-dim).

Fallback: if ``sentence-transformers``/``torch`` aren't installed, or the model
can't be loaded (e.g. no network on first run to fetch weights), we fall back
to an L2-normalized TF-IDF vector per chunk. This keeps clustering (KMeans),
similarity, etc. fully functional in constrained environments; the response
always reports which ``embedding_model`` actually produced the vectors.
"""
from __future__ import annotations

import logging
from functools import lru_cache

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

from app.config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _load_sentence_transformer():
    try:
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415
    except ImportError:
        return None
    try:
        return SentenceTransformer(settings.embedding_model_name)
    except Exception:
        logger.exception("Failed to load sentence-transformers model %s", settings.embedding_model_name)
        return None


def _tfidf_fallback_embed(texts: list[str]) -> np.ndarray:
    vectorizer = TfidfVectorizer(stop_words="english", max_features=512)
    matrix = vectorizer.fit_transform(texts if texts else [""])
    vectors = matrix.toarray().astype(np.float32)
    return normalize(vectors)


def embed_chunks(texts: list[str]) -> tuple[np.ndarray, str]:
    """Return (embeddings [n_chunks, dim], model_name_used)."""
    if not texts:
        return np.zeros((0, 0), dtype=np.float32), "none"

    model = _load_sentence_transformer()
    if model is not None:
        try:
            vectors = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
            return vectors.astype(np.float32), settings.embedding_model_name
        except Exception:
            logger.exception("sentence-transformers encode() failed, falling back to TF-IDF embeddings")

    return _tfidf_fallback_embed(texts), "tfidf-fallback"


def embed_query(text: str) -> tuple[np.ndarray, str] | None:
    """Embed one query with the same sentence-transformers model used for chunks.

    Returns ``(vector, model_name)`` or ``None`` when the real model isn't
    available. Callers must then fall back to a lexical dense substitute:
    the chunk vectors were produced by a fitted TF-IDF (``tfidf-fallback``)
    or a model we can't load, so a query can't be projected into that space.
    """
    model = _load_sentence_transformer()
    if model is None:
        return None
    try:
        vector = model.encode([text], convert_to_numpy=True, normalize_embeddings=True)[0]
        return vector.astype(np.float32), settings.embedding_model_name
    except Exception:
        logger.exception("sentence-transformers query encode() failed")
        return None
