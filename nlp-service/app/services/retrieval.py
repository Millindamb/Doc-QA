"""Hybrid retrieval: BM25 + embedding cosine, with an exam-mode re-rank.

    relevance = alpha * normalized_BM25 + (1 - alpha) * cosine          (alpha default 0.4)

* BM25: ``rank_bm25.BM25Okapi`` over OUR tokenizer (stopwords + light stemmer),
  raw scores clipped to >= 0 and min-max normalized over the whole document.
* Cosine: query embedding vs stored chunk vectors (all-MiniLM-L6-v2). If the
  real model can't embed the query (not installed, or the chunk vectors came
  from the TF-IDF fallback, or dims mismatch) we substitute a TF-IDF cosine
  fitted on the document's chunks + the query, and say so in ``warnings``.
* Knowledge mode: top_k (8) ordered by relevance.
* Candidates scoring below 10% of the best match (RETRIEVAL_MIN_RELEVANCE_RATIO) are dropped in
  both modes, so a barely-related chunk can never be promoted by its importance score.
* Exam mode: shortlist top_k * multiplier by relevance, then re-rank by
  ``relevance * 0.6 + importance_norm * 0.4`` and keep top_k (5). ``importance_norm``
  is the Part-2 chunk importance score min-max normalized over the document
  so it lives on the same 0..1 scale as relevance.
"""
from __future__ import annotations

import hashlib
import logging
import re
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable, Protocol, Sequence

import numpy as np
from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

from app.config import settings
from app.services.embeddings import embed_query

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tokenization (own): stopwords + light suffix stemmer
# ---------------------------------------------------------------------------

_STOPWORDS = frozenset(
    """
    a about above after again against all also am an and any are aren't as at be because been before being below
    between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each
    few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how
    i if in into is isn't it its itself just let's me more most mustn't my myself no nor not of off on once only
    or other ought our ours ourselves out over own same shan't she should shouldn't so some such than that the
    their theirs them themselves then there these they this those through to too under until up very was wasn't
    we were weren't what when where which while who whom why will with won't would wouldn't you your yours
    yourself yourselves please tell say said explain describe give show mean means meant whats
    """.split()
)

_WORD_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


def stem(word: str) -> str:
    """Very light English stemmer; applied identically to queries and chunks."""
    if len(word) <= 3 or word.isdigit():
        return word
    if word.endswith("sses"):
        return word[:-2]
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    for suffix in ("ingly", "edly", "ing", "ed", "ly", "es"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    if word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for raw in _WORD_RE.findall(text.lower()):
        word = raw.split("'")[0]
        if not word or word in _STOPWORDS or raw in _STOPWORDS:
            continue
        if len(word) == 1 and not word.isdigit():
            continue
        tokens.append(stem(word))
    return tokens


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class ChunkLike(Protocol):
    id: str
    text: str
    heading: str
    position: int
    token_count: int
    embedding: list[float] | None


Embedder = Callable[[str], "tuple[np.ndarray, str] | None"]


@dataclass
class _Bm25Index:
    tokens: list[list[str]]
    bm25: BM25Okapi | None


# small LRU so repeated questions on the same document don't rebuild BM25
_INDEX_CACHE: "OrderedDict[str, _Bm25Index]" = OrderedDict()
_CACHE_LOCK = Lock()


def _cache_key(chunks: Sequence[ChunkLike]) -> str:
    h = hashlib.sha1()
    for c in chunks:
        h.update(c.id.encode())
        h.update(b"\x1e")
        h.update(c.text.encode())
        h.update(b"\x1f")
    return h.hexdigest()


def _get_index(chunks: Sequence[ChunkLike]) -> _Bm25Index:
    key = _cache_key(chunks)
    with _CACHE_LOCK:
        cached = _INDEX_CACHE.get(key)
        if cached is not None:
            _INDEX_CACHE.move_to_end(key)
            return cached

    tokens = [tokenize(c.text) for c in chunks]
    bm25 = BM25Okapi(tokens) if any(tokens) else None  # avgdl == 0 would divide by zero
    index = _Bm25Index(tokens=tokens, bm25=bm25)

    with _CACHE_LOCK:
        _INDEX_CACHE[key] = index
        while len(_INDEX_CACHE) > max(1, settings.bm25_cache_size):
            _INDEX_CACHE.popitem(last=False)
    return index


# ---------------------------------------------------------------------------
# Scoring components
# ---------------------------------------------------------------------------


def minmax(values: np.ndarray) -> np.ndarray:
    """Min-max normalize to 0..1. Degenerate (all equal): 1.0 if positive else 0.0."""
    if values.size == 0:
        return values
    lo, hi = float(values.min()), float(values.max())
    if hi - lo > 1e-12:
        return (values - lo) / (hi - lo)
    return np.full_like(values, 1.0 if hi > 0 else 0.0, dtype=float)


def _bm25_scores(index: _Bm25Index, query_tokens: list[str], n: int) -> np.ndarray:
    if index.bm25 is None or not query_tokens:
        return np.zeros(n, dtype=float)
    # BM25Okapi can return negative idf-driven scores on tiny corpora; clip them
    return np.clip(np.asarray(index.bm25.get_scores(query_tokens), dtype=float), 0.0, None)


def _tfidf_cosine(query: str, chunks: Sequence[ChunkLike]) -> np.ndarray:
    texts = [c.text for c in chunks] + [query]
    try:
        vectorizer = TfidfVectorizer(tokenizer=tokenize, lowercase=False, token_pattern=None, sublinear_tf=True)
        matrix = vectorizer.fit_transform(texts)
    except ValueError:  # empty vocabulary
        return np.zeros(len(chunks), dtype=float)
    return np.clip(linear_kernel(matrix[-1], matrix[:-1]).ravel(), 0.0, 1.0)


def _dense_scores(
    query: str,
    chunks: Sequence[ChunkLike],
    embedding_model: str | None,
    embedder: Embedder,
    warnings: list[str],
) -> tuple[np.ndarray, str, str | None, bool]:
    """Return (cosines, method_label, model_used, real_embeddings)."""
    vectors = [c.embedding for c in chunks]
    have_vectors = all(v for v in vectors) and len({len(v) for v in vectors if v}) == 1

    if not have_vectors:
        warnings.append(
            "chunks have no (or inconsistent) embeddings - run POST /api/documents/:id/analyze; "
            "using TF-IDF cosine instead of embedding cosine"
        )
    elif embedding_model == "tfidf-fallback":
        warnings.append("stored vectors are TF-IDF fallback vectors and can't embed a query; using TF-IDF cosine")
    else:
        embedded = embedder(query)
        matrix = np.asarray(vectors, dtype=np.float32)
        if embedded is None:
            warnings.append("query embedding model unavailable; using TF-IDF cosine")
        else:
            q_vec, model_name = embedded
            if q_vec.shape[0] != matrix.shape[1] or (embedding_model and embedding_model != model_name):
                warnings.append(
                    f"query model '{model_name}' does not match stored vectors "
                    f"('{embedding_model}', dim {matrix.shape[1]}); using TF-IDF cosine"
                )
            else:
                m_norm = np.linalg.norm(matrix, axis=1, keepdims=True)
                m_norm[m_norm == 0] = 1.0
                q_norm = float(np.linalg.norm(q_vec)) or 1.0
                cos = (matrix / m_norm) @ (q_vec / q_norm)
                return np.clip(cos, 0.0, 1.0).astype(float), "hybrid(bm25+embedding)", model_name, True

    return _tfidf_cosine(query, chunks), "hybrid(bm25+tfidf-cosine)", None, False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def retrieve(
    query: str,
    chunks: Sequence[ChunkLike],
    *,
    mode: str = "knowledge",
    top_k: int | None = None,
    alpha: float | None = None,
    importance: dict[str, float] | None = None,
    embedding_model: str | None = None,
    embedder: Embedder = embed_query,
) -> dict[str, Any]:
    """Return ``{"chunks": [...], "meta": {...}}``; see RetrieveResponse for the shape."""
    if not chunks:
        raise ValueError("chunks must not be empty")

    exam = mode == "exam"
    k = top_k or (settings.retrieval_top_k_exam if exam else settings.retrieval_top_k_knowledge)
    k = max(1, min(k, len(chunks)))
    a = settings.retrieval_alpha if alpha is None else float(alpha)
    a = min(1.0, max(0.0, a))
    warnings: list[str] = []
    n = len(chunks)

    # --- lexical
    index = _get_index(chunks)
    query_tokens = tokenize(query)
    bm25_raw = _bm25_scores(index, query_tokens, n)
    bm25_norm = minmax(bm25_raw)

    # --- dense
    cosine, method, model_used, real_embeddings = _dense_scores(query, chunks, embedding_model, embedder, warnings)

    relevance = a * bm25_norm + (1.0 - a) * cosine

    # --- importance (exam re-rank)
    has_importance = bool(importance) and any(c.id in importance for c in chunks)
    if has_importance:
        imp_raw = np.array([float(importance.get(c.id, 0.0)) for c in chunks], dtype=float)
        imp_norm = minmax(imp_raw)
    else:
        imp_raw = imp_norm = None
        if exam:
            warnings.append("no importance scores supplied; exam re-rank skipped (ordered by relevance)")

    # candidates must have some signal at all
    order = sorted(range(n), key=lambda i: (-relevance[i], chunks[i].position))
    order = [i for i in order if relevance[i] > 0.0]
    if order:  # relevance floor relative to the best match (see RETRIEVAL_MIN_RELEVANCE_RATIO)
        floor = settings.retrieval_min_relevance_ratio * relevance[order[0]]
        order = [i for i in order if relevance[i] >= floor]

    reranked = False
    if exam and has_importance:
        pool = order[: max(k, k * max(1, settings.exam_candidate_multiplier))]
        final = {
            i: settings.exam_rerank_weight_relevance * relevance[i] + settings.exam_rerank_weight_importance * imp_norm[i]
            for i in pool
        }
        selected = sorted(pool, key=lambda i: (-final[i], -relevance[i], chunks[i].position))[:k]
        reranked = True
    else:
        final = {i: float(relevance[i]) for i in order}
        selected = order[:k]

    # --- sufficiency signal (used by the answering layer to decide "say so + offer research")
    query_set = set(query_tokens)
    max_cos = float(max((cosine[i] for i in selected), default=0.0))
    coverage = 0.0
    if query_set:
        coverage = max(
            (len(query_set & set(index.tokens[i])) / len(query_set) for i in selected),
            default=0.0,
        )
    sufficient = bool(selected) and (
        (real_embeddings and max_cos >= settings.min_cosine_sufficient) or coverage >= settings.min_term_coverage
    )

    out_chunks: list[dict[str, Any]] = []
    for rank, i in enumerate(selected, start=1):
        c = chunks[i]
        out_chunks.append(
            {
                "id": c.id,
                "text": c.text,
                "heading": c.heading,
                "position": c.position,
                "token_count": c.token_count,
                "rank": rank,
                "bm25_score": round(float(bm25_raw[i]), 4),
                "bm25_norm": round(float(bm25_norm[i]), 4),
                "cosine": round(float(cosine[i]), 4),
                "relevance": round(float(relevance[i]), 4),
                "importance": None if imp_raw is None else round(float(imp_raw[i]), 4),
                "importance_norm": None if imp_norm is None else round(float(imp_norm[i]), 4),
                "final_score": round(float(final[i]), 4),
            }
        )

    return {
        "chunks": out_chunks,
        "meta": {
            "top_k": k,
            "alpha": a,
            "retrieval_method": method,
            "embedding_model": model_used,
            "reranked_by_importance": reranked,
            "sufficient": sufficient,
            "max_cosine": round(max_cos, 4),
            "query_term_coverage": round(coverage, 4),
            "warnings": warnings,
        },
    }
