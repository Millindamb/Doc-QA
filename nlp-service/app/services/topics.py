"""Topic clustering: KMeans over chunk embeddings, k chosen by silhouette score.

Each resulting cluster is treated as one "topic" and labeled with its top
TF-IDF terms (computed per-cluster over the member chunks' text).
"""
from __future__ import annotations

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from app.config import settings
from app.services.keywords_tfidf import fit_tfidf_vectorizer


def _choose_k(embeddings: np.ndarray, k_min: int, k_max: int) -> int:
    n = embeddings.shape[0]
    max_feasible_k = min(k_max, n - 1)
    if max_feasible_k < k_min:
        return 1

    best_k = k_min
    best_score = -1.0
    for k in range(k_min, max_feasible_k + 1):
        try:
            labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(embeddings)
            if len(set(labels)) < 2:
                continue
            score = silhouette_score(embeddings, labels)
        except Exception:
            continue
        if score > best_score:
            best_score = score
            best_k = k
    return best_k


def cluster_topics(
    chunk_ids: list[str],
    chunk_texts: list[str],
    embeddings: np.ndarray,
    k_min: int | None = None,
    k_max: int | None = None,
    top_terms_per_topic: int | None = None,
) -> list[dict]:
    k_min = k_min if k_min is not None else settings.kmeans_k_min
    k_max = k_max if k_max is not None else settings.kmeans_k_max
    top_terms_per_topic = top_terms_per_topic or settings.topic_top_terms

    n = len(chunk_ids)
    if n == 0:
        return []

    if n < max(3, k_min + 1):
        # too few chunks to meaningfully cluster: one topic for everything
        labels = np.zeros(n, dtype=int)
        k = 1
    else:
        k = _choose_k(embeddings, k_min, k_max)
        if k == 1:
            labels = np.zeros(n, dtype=int)
        else:
            labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(embeddings)

    vectorizer, matrix = fit_tfidf_vectorizer(chunk_texts)
    feature_names = vectorizer.get_feature_names_out() if vectorizer is not None else []

    topics: list[dict] = []
    for cluster_id in sorted(set(labels.tolist())):
        member_idx = [i for i, lbl in enumerate(labels) if lbl == cluster_id]
        member_chunk_ids = [chunk_ids[i] for i in member_idx]

        top_terms: list[str] = []
        if matrix is not None and len(feature_names):
            cluster_scores = np.asarray(matrix[member_idx].sum(axis=0)).ravel()
            order = np.argsort(-cluster_scores)[:top_terms_per_topic]
            top_terms = [feature_names[i] for i in order if cluster_scores[i] > 0]

        label = ", ".join(top_terms[:3]) if top_terms else f"Topic {cluster_id + 1}"

        topics.append(
            {
                "id": f"t{cluster_id}",
                "label": label,
                "top_terms": top_terms,
                "chunk_ids": member_chunk_ids,
                "size": len(member_chunk_ids),
            }
        )

    return topics
