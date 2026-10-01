"""Query intent router (own): rules first, small classifier when rules are ambiguous.

Intents: question, doubt, quiz, practice, research, resources.

Layer 1 - regex rules
    * STRONG rules are unambiguous phrases ("quiz me", "practice questions", "I don't understand").
      Exactly one intent with a strong hit -> answer immediately (method="rules").
      Several intents hit -> ambiguous -> layer 2, restricted to the intents that hit.
    * WEAK rules ("why", "explain", wh-words) only ever suggest ``question``; they never
      decide on their own unless the classifier is unsure.
Layer 2 - TF-IDF (1-2 grams) + LogisticRegression trained on data/intents.csv
    (method="classifier"). If its top probability is below ROUTER_MIN_CONFIDENCE we fall
    back to the weak rule, else to ``question`` (method="fallback").
"""
from __future__ import annotations

import csv
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

import joblib
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from app.config import settings

logger = logging.getLogger(__name__)

INTENTS = ("question", "doubt", "quiz", "practice", "research", "resources")
# tie-break order if the classifier isn't available and several strong rules hit
_PRIORITY = ("quiz", "practice", "research", "resources", "doubt", "question")

_I = re.IGNORECASE


def _r(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, _I)


STRONG_RULES: dict[str, list[tuple[str, re.Pattern[str]]]] = {
    "quiz": [
        ("quiz", _r(r"\bquiz(zes|zed)?\b")),
        ("test_me", _r(r"\b(test|examine|assess|evaluate|grade) (me|my (knowledge|understanding|learning))\b")),
        ("mcq", _r(r"\b(mcqs?|multiple[- ]choice)\b")),
        ("question_me", _r(r"\b(question|drill|challenge|ask) me\b")),
        ("flashcards", _r(r"\bflash ?cards?\b")),
        ("self_test", _r(r"\bself[- ]?test\b")),
    ],
    "practice": [
        ("practice_questions", _r(r"\bpractice (questions?|problems?|exercises?|sets?|papers?|tests?|worksheets?)\b")),
        ("sample_questions", _r(r"\b(sample|mock|model|past[- ]paper|exam[- ]style) (questions?|papers?|tests?)\b")),
        ("exercises", _r(r"\b(exercises?|worksheets?|question bank|problem set)\b")),
        ("generate_questions", _r(r"\b(give|generate|create|make|write|prepare|draft|list|produce|frame) (me )?(some |\d+ |a few |more |extra |important )*(short[- ]answer |long[- ]answer |essay |viva |numerical |revision |exam )?(questions?|problems?)\b")),
        ("likely_questions", _r(r"\b(likely|expected|important|possible|probable) (exam )?questions\b")),
        ("what_asked", _r(r"\bwhat (could|can|might|may) (be )?(asked|come)\b")),
    ],
    "research": [
        ("do_research", _r(r"\b(do|run|conduct|perform|start|need|want|more|further|deeper|online|some|quick|background)\s+(more\s+)?research\b")),
        ("research_on", _r(r"\bresearch(ing)?\s+(on|about|into|this|the topic|more|further)\b")),
        ("research_verb", _r(r"^\s*(please\s+)?research\b")),
        ("look_up_online", _r(r"\b(look|search)( it| this| that)? up (online|on the (web|internet))\b")),
        ("search_web", _r(r"\bsearch (the )?(web|internet|online|google|wikipedia)\b")),
        ("latest", _r(r"\b(latest|recent|current|newest) (research|studies|study|developments|news|papers|findings|advances|breakthroughs)\b")),
        ("beyond_doc", _r(r"\b(beyond|outside) (the|this) (document|text|file|notes)\b")),
        ("literature", _r(r"\b(academic|scientific|research) (papers?|literature|articles?)\b")),
    ],
    "resources": [
        ("resources_word", _r(r"\b(study |learning |reading |educational )?(resources?|materials?)\b(?! (in|from|of|on) (the|this) (document|text|file))")),
        ("videos", _r(r"\b(youtube|videos?|playlists?|lectures?|podcasts?|moocs?)\b")),
        ("tutorials_courses", _r(r"\b(tutorials?|courses?|textbooks?|study guides?|cheat ?sheets?|reading list)\b")),
        ("where_study", _r(r"\bwhere (can|do|should|to) (i|we|you)?\s*(study|learn|read|find (more|study|notes|material))\b")),
        ("recommend_books", _r(r"\b(recommend|suggest)\w* (me )?(some |good |the best )?(books?|websites?|channels?|links?|articles?)\b")),
    ],
    "doubt": [
        ("dont_understand", _r(r"\b(i )?(don'?t|do not|dont|didn'?t|did not|can'?t|cannot|couldn'?t|could not|still (don'?t|do not|not))\s+(really\s+)?(understand|get|follow|grasp|see)\b")),
        ("confused", _r(r"\b(confus(ed|ing)|puzzled|baffled)\b")),
        ("make_sense", _r(r"\b(doesn'?t|does not|don'?t|makes? no) (make )?sense\b")),
        ("again_simpler", _r(r"\b(explain|say|put|phrase|rephrase|tell)( it| that| this)?( to me)?\s*(again|simpler|more simply|differently|in simple|in plain|like i'?m)\b")),
        ("simplify", _r(r"\b(simpl(er|ify|ified|e terms|e words)|plain english|layman|eli5|like i'?m (five|5))\b")),
        ("what_mean", _r(r"\bwhat do you mean\b")),
        ("stuck", _r(r"\b(i'?m|i am) (stuck|lost|struggling|having (a )?(hard|difficult|trouble))\b")),
        ("not_clear", _r(r"\b(not|isn'?t|still not) (very )?clear\b")),
        ("go_slower", _r(r"\b(go|walk me through it) slower|over my head|lost me\b")),
    ],
}

WEAK_QUESTION_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("wh_start", _r(r"^\s*(why|how|what|when|where|who|which|whose|is|are|does|do|can|could|did)\b")),
    ("explain", _r(r"\bexplain\b")),
    ("why", _r(r"\bwhy\b")),
    ("define", _r(r"\b(define|definition of|difference between|meaning of)\b")),
    ("question_mark", _r(r"\?\s*$")),
]


@dataclass
class _Model:
    pipeline: Pipeline
    classes: list[str]
    meta: dict[str, Any] = field(default_factory=dict)


_MODEL: _Model | None = None
_LOCK = Lock()


# ---------------------------------------------------------------------------
# Layer 2: classifier
# ---------------------------------------------------------------------------


def load_dataset(path: str | Path | None = None) -> tuple[list[str], list[str]]:
    csv_path = Path(path or settings.router_data_path)
    if not csv_path.exists():
        raise FileNotFoundError(f"intent dataset not found: {csv_path} (run data/generate_intents.py)")
    queries: list[str] = []
    labels: list[str] = []
    with csv_path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            q, intent = (row.get("query") or "").strip(), (row.get("intent") or "").strip()
            if q and intent in INTENTS:
                queries.append(q)
                labels.append(intent)
    if len(set(labels)) < 2:
        raise ValueError("intent dataset must contain at least two intents")
    return queries, labels


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    ngram_range=(1, 2),
                    sublinear_tf=True,
                    lowercase=True,
                    token_pattern=r"(?u)\b\w[\w']*\b",  # keep apostrophes: "don't"
                    # no stopword removal: "why", "how", "i", "don't", "me" are the signal here
                ),
            ),
            ("clf", LogisticRegression(C=12.0, max_iter=3000, class_weight="balanced")),
        ]
    )


def train_and_save(
    data_path: str | Path | None = None, model_path: str | Path | None = None
) -> tuple[_Model, Path]:
    queries, labels = load_dataset(data_path)
    pipeline = build_pipeline().fit(queries, labels)
    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "sklearn_version": sklearn.__version__,
        "n_samples": len(queries),
        "classes": list(pipeline.classes_),
    }
    out = Path(model_path or settings.router_model_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": pipeline, "meta": meta}, out)
    return _Model(pipeline=pipeline, classes=list(pipeline.classes_), meta=meta), out


def _load_model(force_retrain: bool = False) -> _Model | None:
    """Load the joblib model; (re)train from the CSV if missing or built by another sklearn."""
    global _MODEL
    with _LOCK:
        if _MODEL is not None and not force_retrain:
            return _MODEL
        path = Path(settings.router_model_path)
        if path.exists() and not force_retrain:
            try:
                blob = joblib.load(path)
                if blob["meta"].get("sklearn_version") == sklearn.__version__:
                    _MODEL = _Model(blob["pipeline"], list(blob["pipeline"].classes_), blob["meta"])
                    return _MODEL
                logger.info("router model built with sklearn %s, retraining", blob["meta"].get("sklearn_version"))
            except Exception:
                logger.exception("could not load router model, retraining")
        try:
            _MODEL, saved = train_and_save()
            logger.info("trained intent router -> %s", saved)
        except Exception:
            logger.exception("could not train intent router; rules-only mode")
            _MODEL = None
        return _MODEL


def warmup() -> None:
    _load_model()


def classify(query: str) -> dict[str, float]:
    """Class probabilities from layer 2 ({} if the model is unavailable)."""
    model = _load_model()
    if model is None:
        return {}
    probs = model.pipeline.predict_proba([query])[0]
    return {c: float(p) for c, p in zip(model.classes, probs)}


# ---------------------------------------------------------------------------
# Layer 1: rules + orchestration
# ---------------------------------------------------------------------------


def _strong_hits(query: str) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {}
    for intent, rules in STRONG_RULES.items():
        matched = [name for name, rx in rules if rx.search(query)]
        if matched:
            hits[intent] = matched
    return hits


def _weak_hits(query: str) -> list[str]:
    return [name for name, rx in WEAK_QUESTION_RULES if rx.search(query)]


def _round(d: dict[str, float]) -> dict[str, float]:
    return {k: round(v, 4) for k, v in sorted(d.items(), key=lambda kv: -kv[1])}


def route_query(query: str) -> dict[str, Any]:
    """Return ``{intent, confidence, method, matched_rules, scores}``."""
    text = query.strip()
    strong = _strong_hits(text)

    # --- layer 1: exactly one intent with a strong hit
    if len(strong) == 1:
        intent, matched = next(iter(strong.items()))
        conf = min(0.99, settings.router_rules_confidence + 0.02 * (len(matched) - 1))
        return {
            "intent": intent,
            "confidence": round(conf, 4),
            "method": "rules",
            "matched_rules": [f"{intent}:{m}" for m in matched],
            "scores": {},
        }

    probs = classify(text)
    matched_rules = [f"{i}:{m}" for i, ms in strong.items() for m in ms]

    # --- layer 2a: several strong intents -> let the classifier arbitrate among them
    if len(strong) > 1:
        candidates = list(strong)
        if probs:
            best = max(candidates, key=lambda i: probs.get(i, 0.0))
            total = sum(probs.get(i, 0.0) for i in candidates) or 1.0
            return {
                "intent": best,
                "confidence": round(probs.get(best, 0.0) / total, 4),
                "method": "classifier",
                "matched_rules": matched_rules,
                "scores": _round(probs),
            }
        best = min(candidates, key=_PRIORITY.index)
        return {"intent": best, "confidence": 0.5, "method": "rules", "matched_rules": matched_rules, "scores": {}}

    # --- layer 2b: no strong rule -> classifier, guarded by a confidence floor
    weak = _weak_hits(text)
    weak_names = [f"question:{w}" for w in weak]
    if probs:
        best = max(probs, key=probs.get)
        if probs[best] >= settings.router_min_confidence:
            return {
                "intent": best,
                "confidence": round(probs[best], 4),
                "method": "classifier",
                "matched_rules": weak_names,
                "scores": _round(probs),
            }

    # --- classifier unsure or unavailable: weak rule, then default
    return {
        "intent": "question",
        "confidence": 0.5 if weak else round(max(probs.values(), default=0.3), 4),
        "method": "rules" if weak else "fallback",
        "matched_rules": weak_names,
        "scores": _round(probs) if probs else {},
    }
