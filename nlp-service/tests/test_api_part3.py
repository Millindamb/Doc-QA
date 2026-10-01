"""HTTP-level tests for POST /retrieve and POST /route (FastAPI TestClient)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

CHUNKS = [
    {"id": "c0", "text": "Photosynthesis is defined as the process by which green plants convert sunlight into chemical energy.", "heading": "INTRODUCTION", "position": 0, "token_count": 20},
    {"id": "c1", "text": "The rate of photosynthesis depends on light intensity, temperature and carbon dioxide concentration.", "heading": "INTRODUCTION", "position": 1, "token_count": 15},
    {"id": "c2", "text": "Cellular respiration refers to the process that converts glucose and oxygen into ATP energy.", "heading": "RESPIRATION", "position": 2, "token_count": 15},
    {"id": "c3", "text": "Mitochondria are called the powerhouse of the cell because they produce most of the ATP.", "heading": "RESPIRATION", "position": 3, "token_count": 15},
]
IMPORTANCE = {"c0": 0.9, "c1": 0.2, "c2": 0.7, "c3": 0.1}


def test_retrieve_knowledge_shape():
    r = client.post("/retrieve", json={"query": "What is photosynthesis?", "chunks": CHUNKS, "mode": "knowledge"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "knowledge"
    assert body["alpha"] == 0.4
    assert body["chunks"][0]["id"] in {"c0", "c1"}
    for key in ("bm25_score", "bm25_norm", "cosine", "relevance", "final_score", "rank"):
        assert key in body["chunks"][0]
    assert isinstance(body["sufficient"], bool)


def test_retrieve_exam_mode_reports_rerank():
    r = client.post(
        "/retrieve",
        json={"query": "photosynthesis and respiration", "chunks": CHUNKS, "mode": "exam", "importance": IMPORTANCE},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reranked_by_importance"] is True
    assert body["top_k"] == 4  # default 5 capped to corpus size
    assert all(c["importance_norm"] is not None for c in body["chunks"])


def test_retrieve_validation():
    assert client.post("/retrieve", json={"query": "x", "chunks": []}).status_code == 400
    assert client.post("/retrieve", json={"chunks": CHUNKS}).status_code == 422
    assert client.post("/retrieve", json={"query": "x", "chunks": CHUNKS, "alpha": 1.5}).status_code == 422
    assert client.post("/retrieve", json={"query": "x", "chunks": CHUNKS, "mode": "weird"}).status_code == 422


def test_route_endpoint():
    r = client.post("/route", json={"query": "Quiz me on this document"})
    assert r.status_code == 200
    assert r.json()["intent"] == "quiz" and r.json()["method"] == "rules"
    assert client.post("/route", json={"query": "   "}).status_code == 400
    assert client.post("/route", json={}).status_code == 422


def test_internal_key_guard_returns_401_not_500(monkeypatch):
    import dataclasses

    import app.main as main_module

    monkeypatch.setattr(main_module, "settings", dataclasses.replace(main_module.settings, internal_key="s3cret"))
    guarded = TestClient(app, raise_server_exceptions=False)
    body = {"query": "quiz me"}
    assert guarded.post("/route", json=body).status_code == 401
    assert guarded.post("/route", json=body, headers={"x-internal-key": "wrong"}).status_code == 401
    assert guarded.post("/route", json=body, headers={"x-internal-key": "s3cret"}).status_code == 200
    assert guarded.post("/retrieve", json={"query": "x", "chunks": CHUNKS}).status_code == 401
    assert guarded.get("/health").status_code == 200  # health stays open
