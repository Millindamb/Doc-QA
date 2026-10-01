"""Tests for the evaluation helpers and a smoke run of eval/run_eval.py (offline, --llm off)."""
from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

from eval.metrics import abstained, fact_recall, markdown_table, mean, recall_at_k, reciprocal_rank, relevant_flags

ROOT = Path(__file__).resolve().parents[1]


def test_relevant_flags_any_phrase_case_and_whitespace_insensitive():
    texts = ["The  Calvin\ncycle happens in the stroma.", "Glycolysis is in the cytoplasm.", "unrelated"]
    assert relevant_flags(texts, ["calvin cycle", "nothing"]) == [True, False, False]
    assert relevant_flags(texts, []) == [False, False, False]


def test_recall_at_k_and_mrr():
    ranked = [False, False, True, False]
    assert recall_at_k(ranked, 1) == 0.0
    assert recall_at_k(ranked, 3) == 1.0
    assert reciprocal_rank(ranked) == pytest.approx(1 / 3)
    assert reciprocal_rank([False, False]) == 0.0
    assert recall_at_k([], 5) == 0.0
    assert mean([]) == 0.0 and mean([1, 0]) == 0.5


def test_fact_recall_is_stem_aware_and_partial():
    assert fact_recall("Plants absorb photons using chlorophyll.", ["chlorophyll", "stroma"]) == 0.5
    assert fact_recall("RuBisCO fixes carbon dioxide", ["rubisco", "carbon dioxide"]) == 1.0
    assert fact_recall("hydrolysing ATP releases 30.5 kJ", ["30.5"]) == 1.0
    assert fact_recall("anything", []) == 0.0


def test_abstained_detects_refusals():
    assert abstained("[[INSUFFICIENT_CONTEXT]] The excerpts only cover biology.")
    assert abstained("The document does not contain that information.")
    assert not abstained("Canberra is the capital of Australia.")


def test_markdown_table_formats_floats():
    md = markdown_table(["a", "b"], [["x", 0.12345], ["y", 2]])
    assert md.splitlines() == ["| a | b |", "|---|---|", "| x | 0.123 |", "| y | 2 |"]


def test_qa_set_is_well_formed():
    qa = json.loads((ROOT / "eval" / "data" / "qa_set.json").read_text())
    ids = [q["id"] for q in qa["questions"]]
    assert len(ids) == len(set(ids))
    answerable = [q for q in qa["questions"] if q.get("answerable", True)]
    assert len(answerable) >= 20 and len(answerable) < len(qa["questions"])
    assert all(q["relevant_phrases"] and q["facts"] and q["reference_answer"] for q in answerable)
    assert all(not q["relevant_phrases"] for q in qa["questions"] if q.get("answerable") is False)


def test_run_eval_smoke_offline(tmp_path):
    out = tmp_path / "res"
    proc = subprocess.run(
        [sys.executable, "-m", "eval.run_eval", "--llm", "off", "--out", str(out)],
        cwd=ROOT, capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    for name in ("results.md", "retrieval.csv", "retrieval_alpha_sweep.csv", "summaries.csv"):
        assert (out / name).exists(), name
    rows = list(csv.DictReader((out / "retrieval.csv").open()))
    assert [r["method"].split(" (")[0] for r in rows] == ["BM25 only", "Embeddings only", "Hybrid"]
    for r in rows:
        assert 0.0 <= float(r["recall@1"]) <= float(r["recall@3"]) <= float(r["recall@5"]) <= 1.0
    summ = {r["method"]: float(r["ROUGE-1 F1"]) for r in csv.DictReader((out / "summaries.csv").open())}
    assert summ["TextRank (ours)"] > summ["Random sentences (mean of 20)"]  # extractive summary beats chance
    md = (out / "results.md").read_text()
    assert "## 1. Retrieval" in md and "## 3. Summaries" in md and "Skipped" in md  # LLM part honestly skipped
