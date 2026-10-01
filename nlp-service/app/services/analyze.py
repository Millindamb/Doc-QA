from __future__ import annotations

from app.config import settings
from app.models.schemas import ChunkIn
from app.services.embeddings import embed_chunks
from app.services.importance import compute_importance
from app.services.keyword_merge import merge_keywords
from app.services.keywords_rake import extract_rake_keywords
from app.services.keywords_tfidf import extract_tfidf_keywords
from app.services.keywords_yake import extract_yake_keywords
from app.services.sentence_index import build_sentences
from app.services.textrank import compute_textrank_scores, top_sentences_in_order
from app.services.topics import cluster_topics


def analyze_chunks(
    chunks: list[ChunkIn], top_n_summary: int | None = None, top_n_keywords: int | None = None
) -> dict:
    warnings: list[str] = []

    ordered = sorted(chunks, key=lambda c: c.position)
    chunk_ids = [c.id for c in ordered]
    chunk_texts = [c.text for c in ordered]

    if not ordered:
        return {
            "keywords": [],
            "topics": [],
            "summary_sentences": [],
            "importance_sentences": [],
            "importance_chunks": [],
            "embeddings": [],
            "embedding_dim": 0,
            "embedding_model": "none",
            "warnings": ["no chunks provided"],
        }

    top_n_summary = top_n_summary or settings.summary_top_n
    top_n_keywords = top_n_keywords or settings.keywords_top_n

    # --- embeddings ---
    embeddings, embedding_model = embed_chunks(chunk_texts)
    if embedding_model != settings.embedding_model_name:
        warnings.append(
            f"embeddings used fallback model '{embedding_model}' "
            f"(configured model '{settings.embedding_model_name}' unavailable)"
        )

    # --- keywords ---
    tfidf_keywords = extract_tfidf_keywords(chunk_texts, top_n=top_n_keywords)
    full_text = "\n\n".join(chunk_texts)
    rake_keywords = extract_rake_keywords(full_text, top_n=top_n_keywords)
    yake_keywords = extract_yake_keywords(full_text, top_n=top_n_keywords)
    keywords = merge_keywords(tfidf_keywords, rake_keywords, yake_keywords, top_n=top_n_keywords)

    # --- topics ---
    topics = cluster_topics(chunk_ids, chunk_texts, embeddings)

    # --- sentence index + TextRank ---
    sentences = build_sentences(ordered)
    textrank_scores = compute_textrank_scores(sentences)
    summary_sentences = top_sentences_in_order(sentences, textrank_scores, top_n_summary)

    # --- exam-mode importance ---
    sentence_importance, chunk_importance = compute_importance(sentences, textrank_scores)

    embeddings_out = [
        {"chunk_id": cid, "vector": vec.tolist()} for cid, vec in zip(chunk_ids, embeddings)
    ]
    embedding_dim = int(embeddings.shape[1]) if embeddings.size else 0

    return {
        "keywords": keywords,
        "topics": topics,
        "summary_sentences": summary_sentences,
        "importance_sentences": sentence_importance,
        "importance_chunks": chunk_importance,
        "embeddings": embeddings_out,
        "embedding_dim": embedding_dim,
        "embedding_model": embedding_model,
        "warnings": warnings,
    }
