"""Tests for Part 3 retrieval (BM25 + cosine hybrid, knowledge/exam modes)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pytest

from app.config import settings
from app.services.retrieval import minmax, retrieve, stem, tokenize


@dataclass
class FakeChunk:
    id: str
    text: str
    position: int
    heading: str = ""
    token_count: int = 0
    embedding: list[float] | None = None


# 5-d toy embedding space: axis0=photosynthesis, axis1=respiration, axis2=membranes, axis3=history,
# axis4="none of the above" (only queries land there, so off-topic queries get ~0 cosine like a real model)
def _unit(*v: float) -> list[float]:
    a = np.array(list(v) + [0.0] * (5 - len(v)), dtype=float)
    return (a / np.linalg.norm(a)).tolist()


CORPUS = [
    FakeChunk("c0", "Photosynthesis is defined as the process by which green plants convert sunlight into chemical energy.", 0, "INTRO", embedding=_unit(1, 0, 0, 0)),
    FakeChunk("c1", "The rate of photosynthesis depends on light intensity, temperature and carbon dioxide.", 1, "INTRO", embedding=_unit(0.9, 0.1, 0, 0)),
    FakeChunk("c2", "Cellular respiration refers to the process that converts glucose and oxygen into ATP.", 2, "RESPIRATION", embedding=_unit(0, 1, 0, 0)),
    FakeChunk("c3", "Mitochondria are called the powerhouse of the cell because they produce most of the ATP.", 3, "RESPIRATION", embedding=_unit(0.1, 0.9, 0, 0)),
    FakeChunk("c4", "The plasma membrane is a phospholipid bilayer that controls what enters the cell.", 4, "MEMBRANES", embedding=_unit(0, 0, 1, 0)),
    FakeChunk("c5", "The Roman Empire expanded rapidly during the first century.", 5, "HISTORY", embedding=_unit(0, 0, 0, 1)),
]

IMPORTANCE = {"c0": 0.9, "c1": 0.3, "c2": 0.8, "c3": 0.2, "c4": 0.1, "c5": 0.05}


def fake_embedder(query: str):
    """Deterministic 'embedding model': maps keywords to the toy axes."""
    q = query.lower()
    v = np.array([
        1.0 if any(w in q for w in ("photosynth", "light", "plant", "sunlight")) else 0.0,
        1.0 if any(w in q for w in ("respiration", "atp", "mitochondria", "energy currency")) else 0.0,
        1.0 if "membrane" in q else 0.0,
        1.0 if any(w in q for w in ("roman", "empire")) else 0.0,
    ])
    v = np.append(v, 0.0 if v.any() else 1.0)  # off-topic -> the "none of the above" axis
    return (v / np.linalg.norm(v)).astype(np.float32), "toy-model"


def run(query, **kw):
    kw.setdefault("embedding_model", "toy-model")
    kw.setdefault("embedder", fake_embedder)
    return retrieve(query, CORPUS, **kw)


# ---------------------------------------------------------------- tokenizer
def test_stemmer_and_stopwords():
    assert stem("plants") == "plant"
    assert stem("processes") == "process"
    assert stem("energies") == "energy"
    assert stem("converting") == "convert"
    assert stem("photosynthesis") == "photosynthesis"  # trailing "is" must survive
    assert tokenize("What is the role of the Plants?") == ["role", "plant"]


def test_minmax_degenerate_cases():
    assert minmax(np.array([0.0, 0.0])).tolist() == [0.0, 0.0]
    assert minmax(np.array([2.0, 2.0])).tolist() == [1.0, 1.0]
    assert minmax(np.array([1.0, 3.0, 2.0])).tolist() == [0.0, 1.0, 0.5]


# ---------------------------------------------------------------- hybrid scoring
def test_hybrid_formula_matches_components():
    out = run("How does light affect photosynthesis?", alpha=0.4)
    assert out["meta"]["retrieval_method"] == "hybrid(bm25+embedding)"
    for c in out["chunks"]:
        expected = 0.4 * c["bm25_norm"] + 0.6 * c["cosine"]
        assert c["relevance"] == pytest.approx(expected, abs=2e-4)
    assert out["chunks"][0]["id"] in {"c0", "c1"}


def test_default_alpha_comes_from_config():
    out = run("photosynthesis")
    assert out["meta"]["alpha"] == settings.retrieval_alpha == 0.4


def test_alpha_one_is_pure_bm25_and_alpha_zero_is_pure_cosine():
    # "energy currency" has no lexical overlap with c2/c3 but the toy model maps it to axis1
    lexical = run("energy currency", alpha=1.0)
    dense = run("energy currency", alpha=0.0)
    assert all(c["relevance"] == pytest.approx(c["bm25_norm"], abs=1e-3) for c in lexical["chunks"])
    assert dense["chunks"][0]["id"] in {"c2", "c3"}
    assert all(c["relevance"] == pytest.approx(c["cosine"], abs=1e-3) for c in dense["chunks"])


def test_results_sorted_and_zero_signal_chunks_dropped():
    out = run("photosynthesis")
    scores = [c["relevance"] for c in out["chunks"]]
    assert scores == sorted(scores, reverse=True)
    assert all(s > 0 for s in scores)
    assert [c["rank"] for c in out["chunks"]] == list(range(1, len(out["chunks"]) + 1))


# ---------------------------------------------------------------- modes
def _long_corpus(n=12):
    """n chunks that all mention 'photosynthesis' with graded strength; identical embeddings."""
    vec = _unit(1, 0, 0, 0)
    return [
        FakeChunk(f"c{i}", ("photosynthesis " * (i + 1)) + f"filler{i} " * 8, i, embedding=vec)
        for i in range(n)
    ]


def test_default_top_k_per_mode():
    chunks = _long_corpus(12)
    imp = {c.id: float(c.position) for c in chunks}
    kn = retrieve("photosynthesis", chunks, mode="knowledge", embedding_model="toy-model", embedder=fake_embedder, importance=imp)
    ex = retrieve("photosynthesis", chunks, mode="exam", embedding_model="toy-model", embedder=fake_embedder, importance=imp)
    assert len(kn["chunks"]) == 8 and kn["meta"]["top_k"] == 8
    assert len(ex["chunks"]) == 5 and ex["meta"]["top_k"] == 5


def test_knowledge_mode_orders_by_relevance_only():
    out = run("photosynthesis light", mode="knowledge", importance=IMPORTANCE)
    assert out["meta"]["reranked_by_importance"] is False
    rel = [c["relevance"] for c in out["chunks"]]
    assert rel == sorted(rel, reverse=True)
    assert all(c["final_score"] == pytest.approx(c["relevance"], abs=1e-3) for c in out["chunks"])


def test_exam_mode_reranks_with_importance_60_40():
    chunks = _long_corpus(10)
    # make a mid-relevance chunk overwhelmingly "important"
    imp = {c.id: 0.0 for c in chunks}
    imp["c4"] = 1.0
    kn = retrieve("photosynthesis", chunks, mode="knowledge", embedding_model="toy-model", embedder=fake_embedder, importance=imp)
    ex = retrieve("photosynthesis", chunks, mode="exam", embedding_model="toy-model", embedder=fake_embedder, importance=imp)

    assert ex["meta"]["reranked_by_importance"] is True
    assert ex["chunks"][0]["id"] == "c4"  # promoted to the top by importance
    assert kn["chunks"][0]["id"] != "c4"  # ...but not by relevance alone
    for c in ex["chunks"]:
        expected = 0.6 * c["relevance"] + 0.4 * c["importance_norm"]
        assert c["final_score"] == pytest.approx(expected, abs=2e-4)


def test_exam_mode_without_importance_warns_and_falls_back_to_relevance():
    out = run("photosynthesis", mode="exam")
    assert out["meta"]["reranked_by_importance"] is False
    assert any("importance" in w for w in out["meta"]["warnings"])


def test_explicit_top_k_is_respected_and_capped_by_corpus_size():
    assert len(run("photosynthesis", top_k=1)["chunks"]) == 1
    assert len(run("photosynthesis", top_k=50)["chunks"]) <= len(CORPUS)


# ---------------------------------------------------------------- fallbacks
def test_no_embeddings_falls_back_to_tfidf_cosine_with_warning():
    bare = [FakeChunk(c.id, c.text, c.position, c.heading) for c in CORPUS]
    out = retrieve("how does light affect photosynthesis", bare)
    assert out["meta"]["retrieval_method"] == "hybrid(bm25+tfidf-cosine)"
    assert any("embeddings" in w for w in out["meta"]["warnings"])
    assert out["chunks"][0]["id"] in {"c0", "c1"}


def test_tfidf_fallback_vectors_are_not_used_for_queries():
    out = run("photosynthesis", embedding_model="tfidf-fallback")
    assert out["meta"]["retrieval_method"] == "hybrid(bm25+tfidf-cosine)"


def test_missing_query_model_falls_back():
    out = run("photosynthesis", embedder=lambda q: None)
    assert out["meta"]["retrieval_method"] == "hybrid(bm25+tfidf-cosine)"
    assert any("unavailable" in w for w in out["meta"]["warnings"])


def test_dimension_mismatch_falls_back():
    out = run("photosynthesis", embedder=lambda q: (np.ones(7, dtype=np.float32), "toy-model"))
    assert out["meta"]["retrieval_method"] == "hybrid(bm25+tfidf-cosine)"


# ---------------------------------------------------------------- sufficiency
def test_sufficient_true_for_on_topic_false_for_off_topic():
    assert run("What is photosynthesis?")["meta"]["sufficient"] is True
    off = run("Who won the football world cup in 2018?")
    assert off["meta"]["sufficient"] is False


def test_empty_chunks_raises():
    with pytest.raises(ValueError):
        retrieve("x", [])


def test_empty_query_tokens_do_not_crash():
    out = run("the of and")  # all stopwords
    assert "chunks" in out


# ---------------------------------------------------------------- relevance floor
def test_relevance_floor_drops_noise_and_stops_importance_promoting_irrelevant_chunks():
    vec = _unit(1, 0, 0, 0)
    strong = [FakeChunk(f"s{i}", ("photosynthesis " * 4) + f"detail{i} extra{i}", i, embedding=vec) for i in range(3)]
    # barely related: shares no words with the query and points at a different axis, but is hugely "important"
    noise = FakeChunk("n0", "Roman aqueducts carried water across valleys.", 3, embedding=_unit(0.05, 0, 0, 1))
    chunks = strong + [noise]
    imp = {"s0": 0.1, "s1": 0.1, "s2": 0.1, "n0": 1.0}

    exam = retrieve("photosynthesis", chunks, mode="exam", embedding_model="toy-model", embedder=fake_embedder, importance=imp)
    kn = retrieve("photosynthesis", chunks, mode="knowledge", embedding_model="toy-model", embedder=fake_embedder, importance=imp)
    assert "n0" not in [c["id"] for c in exam["chunks"]]
    assert "n0" not in [c["id"] for c in kn["chunks"]]
    best = max(c["relevance"] for c in exam["chunks"])
    assert all(c["relevance"] >= settings.retrieval_min_relevance_ratio * best - 1e-6 for c in exam["chunks"])
