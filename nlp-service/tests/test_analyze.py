"""Tests for Part 2 (document analysis).

Uses a small in-package ``ChunkIn``-compatible stand-in so these tests don't
require the FastAPI/pydantic layer to exercise the underlying algorithms
directly; ``test_analyze_response_matches_pydantic_schema`` additionally
round-trips through the real pydantic schema.
"""
from dataclasses import dataclass

import pytest

from app.services.analyze import analyze_chunks
from app.services.chunking import split_sentences
from app.services.importance import compute_importance
from app.services.keyword_merge import merge_keywords
from app.services.keywords_rake import extract_rake_keywords
from app.services.keywords_tfidf import extract_tfidf_keywords
from app.services.keywords_yake import extract_yake_keywords
from app.services.sentence_index import build_sentences
from app.services.textrank import compute_textrank_scores, top_sentences_in_order
from app.services.topics import cluster_topics


@dataclass
class FakeChunk:
    id: str
    text: str
    heading: str
    position: int
    token_count: int


SAMPLE = [
    (
        "INTRODUCTION",
        "Photosynthesis is defined as the process by which green plants convert "
        "sunlight into chemical energy. This process occurs mainly in the "
        "chloroplasts of plant cells. In 1930, scientists began to understand "
        "the biochemical pathway in detail.",
    ),
    (
        "INTRODUCTION",
        "The rate of photosynthesis depends on light intensity, temperature, and "
        "carbon dioxide concentration. Higher light intensity generally increases "
        "the rate up to a saturation point.",
    ),
    (
        "CELLULAR RESPIRATION",
        "Cellular respiration refers to the metabolic process that converts "
        "glucose and oxygen into energy, water, and carbon dioxide. This process "
        "is also known as aerobic respiration when oxygen is present. The "
        "equation for respiration is C6H12O6 + 6O2 -> 6CO2 + 6H2O + energy.",
    ),
    (
        "CELLULAR RESPIRATION",
        "Mitochondria are called the powerhouse of the cell because they produce "
        "most of the ATP. ATP production happens through a series of reactions "
        "in the electron transport chain.",
    ),
    (
        "CONCLUSION",
        "In summary, photosynthesis and respiration are complementary processes "
        "essential to life on Earth. Understanding these processes helps explain "
        "energy flow in ecosystems.",
    ),
]


def make_chunks() -> list[FakeChunk]:
    return [
        FakeChunk(id=f"c{i}", text=text, heading=heading, position=i, token_count=len(text.split()))
        for i, (heading, text) in enumerate(SAMPLE)
    ]


# ---------------------------------------------------------------------------
# keywords
# ---------------------------------------------------------------------------


def test_tfidf_keywords_finds_domain_terms():
    texts = [text for _, text in SAMPLE]
    keywords = extract_tfidf_keywords(texts, top_n=15)
    terms = {t for t, _ in keywords}
    assert terms & {"photosynthesis", "respiration", "energy", "process"}
    assert all(0.0 <= score <= 1.0 for _, score in keywords)


def test_rake_keywords_no_degenerate_repeated_word_phrases():
    text = "ATP production happens through a series of reactions. Mitochondria produce the ATP."
    keywords = extract_rake_keywords(text, top_n=10)
    for term, _ in keywords:
        words = term.split()
        assert not (len(words) > 1 and len(set(words)) == 1), f"degenerate phrase: {term}"


def test_yake_fallback_extracts_something_reasonable():
    text = " ".join(text for _, text in SAMPLE)
    keywords = extract_yake_keywords(text, top_n=10)
    assert len(keywords) > 0
    assert all(0.0 <= score <= 1.0 for _, score in keywords)


def test_merge_keywords_dedupes_across_sources():
    tfidf = [("energy", 0.9), ("photosynthesis", 0.8)]
    rake = [("energy", 0.7)]
    yake = [("Energy", 0.6), ("respiration", 0.5)]
    merged = merge_keywords(tfidf, rake, yake, top_n=10)

    terms_lower = [m["term"].lower() for m in merged]
    assert terms_lower.count("energy") == 1  # deduped across tfidf+rake+yake

    energy_entry = next(m for m in merged if m["term"].lower() == "energy")
    assert set(energy_entry["sources"]) == {"tfidf", "rake", "yake"}
    assert all(0.0 <= m["score"] for m in merged)


def test_merge_keywords_respects_top_n():
    tfidf = [(f"term{i}", 1.0 - i * 0.01) for i in range(30)]
    merged = merge_keywords(tfidf, [], [], top_n=5)
    assert len(merged) == 5


# ---------------------------------------------------------------------------
# sentence index / textrank
# ---------------------------------------------------------------------------


def test_build_sentences_preserves_document_order():
    chunks = make_chunks()
    sentences = build_sentences(chunks)
    positions = [s.position for s in sentences]
    assert positions == list(range(len(sentences)))
    assert sentences[0].chunk_id == "c0"
    assert sentences[-1].chunk_id == "c4"


def test_textrank_scores_are_normalized_0_to_1():
    chunks = make_chunks()
    sentences = build_sentences(chunks)
    scores = compute_textrank_scores(sentences)
    assert set(scores.keys()) == {s.position for s in sentences}
    assert max(scores.values()) == pytest.approx(1.0)
    assert all(0.0 <= v <= 1.0 for v in scores.values())


def test_textrank_single_sentence_gets_full_score():
    sentences = build_sentences([FakeChunk(id="c0", text="Only one sentence here.", heading="", position=0, token_count=4)])
    scores = compute_textrank_scores(sentences)
    assert scores[0] == 1.0


def test_top_sentences_in_order_returns_requested_count_in_document_order():
    chunks = make_chunks()
    sentences = build_sentences(chunks)
    scores = compute_textrank_scores(sentences)
    top = top_sentences_in_order(sentences, scores, top_n=3)
    assert len(top) == 3
    positions = [s["position"] for s in top]
    assert positions == sorted(positions)  # original document order preserved


# ---------------------------------------------------------------------------
# importance
# ---------------------------------------------------------------------------


def test_importance_detects_definition_sentences():
    chunks = make_chunks()
    sentences = build_sentences(chunks)
    scores = compute_textrank_scores(sentences)
    sentence_importance, _ = compute_importance(sentences, scores)

    definition_sentences = [s for s in sentence_importance if s["features"]["definition"] == 1.0]
    texts = " ".join(s["text"] for s in definition_sentences)
    assert "is defined as" in texts or "refers to" in texts or "known as" in texts


def test_importance_detects_numeric_content():
    chunks = make_chunks()
    sentences = build_sentences(chunks)
    scores = compute_textrank_scores(sentences)
    sentence_importance, _ = compute_importance(sentences, scores)

    equation_sentence = next(s for s in sentence_importance if "C6H12O6" in s["text"])
    assert equation_sentence["features"]["numeric"] > 0


def test_importance_heading_sentences_score_heading_feature_1():
    chunks = make_chunks()
    sentences = build_sentences(chunks)
    scores = compute_textrank_scores(sentences)
    sentence_importance, _ = compute_importance(sentences, scores)
    assert all(s["features"]["heading"] == 1.0 for s in sentence_importance)  # every chunk has a heading


def test_chunk_importance_covers_every_chunk():
    chunks = make_chunks()
    sentences = build_sentences(chunks)
    scores = compute_textrank_scores(sentences)
    _, chunk_importance = compute_importance(sentences, scores)
    chunk_ids = {c["chunk_id"] for c in chunk_importance}
    assert chunk_ids == {c.id for c in chunks}
    assert all(0.0 <= c["score"] <= 1.0 for c in chunk_importance)


# ---------------------------------------------------------------------------
# topics
# ---------------------------------------------------------------------------


def test_cluster_topics_handles_few_chunks_as_one_topic():
    ids = ["a", "b"]
    texts = ["short text one", "short text two"]
    import numpy as np

    embeddings = np.array([[1.0, 0.0], [0.0, 1.0]])
    topics = cluster_topics(ids, texts, embeddings)
    assert len(topics) == 1
    assert set(topics[0]["chunk_ids"]) == {"a", "b"}


def test_cluster_topics_every_chunk_assigned_exactly_once():
    chunks = make_chunks()
    texts = [c.text for c in chunks]
    ids = [c.id for c in chunks]

    from app.services.embeddings import embed_chunks

    embeddings, _ = embed_chunks(texts)
    topics = cluster_topics(ids, texts, embeddings, k_min=2, k_max=3)

    all_assigned = [cid for t in topics for cid in t["chunk_ids"]]
    assert sorted(all_assigned) == sorted(ids)
    assert len(all_assigned) == len(set(all_assigned))  # no chunk in two topics


# ---------------------------------------------------------------------------
# full pipeline shape
# ---------------------------------------------------------------------------


def test_analyze_chunks_returns_expected_shape():
    chunks = make_chunks()
    result = analyze_chunks(chunks)

    assert set(result.keys()) == {
        "keywords",
        "topics",
        "summary_sentences",
        "importance_sentences",
        "importance_chunks",
        "embeddings",
        "embedding_dim",
        "embedding_model",
        "warnings",
    }

    assert len(result["keywords"]) > 0
    for kw in result["keywords"]:
        assert {"term", "score", "sources"} <= kw.keys()

    assert len(result["topics"]) >= 1
    for t in result["topics"]:
        assert {"id", "label", "top_terms", "chunk_ids", "size"} <= t.keys()

    assert 1 <= len(result["summary_sentences"]) <= 5
    for s in result["summary_sentences"]:
        assert {"text", "score", "position", "chunk_id"} <= s.keys()

    assert len(result["importance_sentences"]) > 0
    for s in result["importance_sentences"]:
        assert set(s["features"].keys()) == {
            "tfidf", "heading", "definition", "numeric", "position", "textrank",
        }

    assert len(result["importance_chunks"]) == len(chunks)
    assert len(result["embeddings"]) == len(chunks)
    for e in result["embeddings"]:
        assert len(e["vector"]) == result["embedding_dim"]


def test_analyze_chunks_empty_input_returns_empty_shape():
    result = analyze_chunks([])
    assert result["keywords"] == []
    assert result["topics"] == []
    assert result["summary_sentences"] == []
    assert result["embeddings"] == []
    assert result["warnings"] == ["no chunks provided"]


def test_analyze_chunks_is_deterministic():
    chunks = make_chunks()
    result_a = analyze_chunks(chunks)
    result_b = analyze_chunks(chunks)
    assert [k["term"] for k in result_a["keywords"]] == [k["term"] for k in result_b["keywords"]]
    assert [s["position"] for s in result_a["summary_sentences"]] == [
        s["position"] for s in result_b["summary_sentences"]
    ]


def test_analyze_response_matches_pydantic_schema():
    pytest.importorskip("pydantic")
    from app.models.schemas import AnalyzeResponse, ChunkIn

    chunk_ins = [
        ChunkIn(id=f"c{i}", text=text, heading=heading, position=i, token_count=len(text.split()))
        for i, (heading, text) in enumerate(SAMPLE)
    ]
    result = analyze_chunks(chunk_ins)
    validated = AnalyzeResponse(**result)
    assert len(validated.keywords) > 0
