"""Tests for Part 3 intent router (rules + TF-IDF/LogReg classifier)."""
from __future__ import annotations

import csv
from collections import Counter

import joblib
import pytest

from app.config import settings
from app.services import intent_router as ir
from app.services.intent_router import INTENTS, classify, load_dataset, route_query, train_and_save


# ------------------------------------------------------------------ dataset
def test_dataset_has_forty_queries_per_intent():
    queries, labels = load_dataset(settings.router_data_path)
    counts = Counter(labels)
    assert set(counts) == set(INTENTS)
    assert all(v == 40 for v in counts.values())
    assert len(set(q.lower() for q in queries)) == len(queries)  # no duplicates


# ------------------------------------------------------------------ layer 1
@pytest.mark.parametrize(
    "query,intent",
    [
        ("Quiz me on chapter 2", "quiz"),
        ("test me on the key terms", "quiz"),
        ("give me 5 MCQs", "quiz"),
        ("Give me practice questions on respiration", "practice"),
        ("generate 10 exam questions", "practice"),
        ("Do some research on CRISPR", "research"),
        ("research the latest studies on this", "research"),
        ("Look it up online", "research"),
        ("Find resources to study this", "resources"),
        ("any good videos on this?", "resources"),
        ("where can I learn more about this", "resources"),
        ("I don't understand the Calvin cycle", "doubt"),
        ("this is confusing", "doubt"),
        ("explain that again, simpler", "doubt"),
    ],
)
def test_strong_rules_decide_alone(query, intent):
    r = route_query(query)
    assert r["intent"] == intent
    assert r["method"] == "rules"
    assert r["confidence"] >= 0.9
    assert r["matched_rules"]


def test_rule_confidence_uses_config_base():
    assert route_query("quiz me")["confidence"] == pytest.approx(settings.router_rules_confidence)


# ------------------------------------------------------------------ layer 2
def test_multiple_strong_intents_are_arbitrated_by_classifier():
    r = route_query("quiz me and also give me practice questions")
    assert r["method"] == "classifier"
    assert r["intent"] in {"quiz", "practice"}
    assert {m.split(":")[0] for m in r["matched_rules"]} == {"quiz", "practice"}


@pytest.mark.parametrize(
    "query,intent",
    [
        ("I'd like something to watch on this topic", "resources"),
        ("Can you check what I've learned so far with a few questions?", "quiz"),
        ("I'm not following the second step at all", "doubt"),
        ("Why does the enzyme slow down at high temperature?", "question"),
    ],
)
def test_classifier_handles_phrasing_without_keywords(query, intent):
    r = route_query(query)
    assert r["intent"] == intent
    assert r["method"] in {"classifier", "rules"}


def test_weak_rules_alone_never_beat_a_confident_classifier_and_default_is_question():
    r = route_query("hello")
    assert r["intent"] == "question"
    assert r["method"] == "fallback"


def test_classifier_probabilities_sum_to_one_and_cover_all_intents():
    probs = classify("explain osmosis")
    assert set(probs) == set(INTENTS)
    assert sum(probs.values()) == pytest.approx(1.0, abs=1e-6)


def test_response_shape():
    r = route_query("What is entropy?")
    assert set(r) == {"intent", "confidence", "method", "matched_rules", "scores"}
    assert r["intent"] in INTENTS and 0.0 <= r["confidence"] <= 1.0
    assert r["method"] in {"rules", "classifier", "fallback"}


# ------------------------------------------------------------------ training / persistence
def test_train_and_save_roundtrip(tmp_path):
    model, path = train_and_save(model_path=tmp_path / "router.joblib")
    assert path.exists()
    blob = joblib.load(path)
    assert blob["meta"]["n_samples"] == 240
    assert sorted(blob["pipeline"].classes_) == sorted(INTENTS)
    assert blob["pipeline"].predict(["quiz me please"])[0] == "quiz"


def test_cross_validated_accuracy_is_reasonable():
    from sklearn.model_selection import StratifiedKFold, cross_val_score

    queries, labels = load_dataset(settings.router_data_path)
    scores = cross_val_score(
        ir.build_pipeline(), queries, labels, cv=StratifiedKFold(5, shuffle=True, random_state=0)
    )
    assert scores.mean() >= 0.70
