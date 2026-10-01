"""Runtime configuration, read once from environment / .env."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SERVICE_ROOT = Path(__file__).resolve().parents[1]  # .../nlp-service


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    raw = os.getenv(name)
    try:
        return float(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw in (None, ""):
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _list(name: str, default: str) -> list[str]:
    raw = os.getenv(name) or default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    chunk_target_tokens: int = field(default_factory=lambda: _int("CHUNK_TARGET_TOKENS", 300))
    chunk_overlap_tokens: int = field(default_factory=lambda: _int("CHUNK_OVERLAP_TOKENS", 50))
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 20))
    min_page_chars: int = field(default_factory=lambda: _int("MIN_PAGE_CHARS", 25))
    min_total_chars: int = field(default_factory=lambda: _int("MIN_TOTAL_CHARS", 20))
    ocr_engines: list[str] = field(default_factory=lambda: _list("OCR_ENGINES", "easyocr,tesseract"))
    ocr_langs: list[str] = field(default_factory=lambda: _list("OCR_LANGS", "en"))
    tesseract_lang: str = field(default_factory=lambda: os.getenv("TESSERACT_LANG", "eng"))
    ocr_gpu: bool = field(default_factory=lambda: _bool("OCR_GPU", False))
    ocr_dpi: int = field(default_factory=lambda: _int("OCR_DPI", 200))
    max_ocr_pages: int = field(default_factory=lambda: _int("MAX_OCR_PAGES", 40))
    ocr_min_confidence: float = field(default_factory=lambda: _float("OCR_MIN_CONFIDENCE", 0.5))
    ocr_good_confidence: float = field(default_factory=lambda: _float("OCR_GOOD_CONFIDENCE", 0.75))
    internal_key: str | None = field(default_factory=lambda: os.getenv("NLP_INTERNAL_KEY") or None)

    # ---- Part 2: analysis ----
    embedding_model_name: str = field(
        default_factory=lambda: os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
    )
    summary_top_n: int = field(default_factory=lambda: _int("SUMMARY_TOP_N", 5))
    keywords_top_n: int = field(default_factory=lambda: _int("KEYWORDS_TOP_N", 15))
    kmeans_k_min: int = field(default_factory=lambda: _int("KMEANS_K_MIN", 2))
    kmeans_k_max: int = field(default_factory=lambda: _int("KMEANS_K_MAX", 8))
    topic_top_terms: int = field(default_factory=lambda: _int("TOPIC_TOP_TERMS", 6))

    # merge weights for combined keyword score (tfidf/rake/yake are each normalized 0..1
    # before this weighting is applied)
    keyword_weight_tfidf: float = field(default_factory=lambda: _float("KEYWORD_WEIGHT_TFIDF", 0.4))
    keyword_weight_rake: float = field(default_factory=lambda: _float("KEYWORD_WEIGHT_RAKE", 0.3))
    keyword_weight_yake: float = field(default_factory=lambda: _float("KEYWORD_WEIGHT_YAKE", 0.3))

    # exam-mode importance score weights (normalized 0..1 features, weighted sum)
    importance_weight_tfidf: float = field(default_factory=lambda: _float("IMPORTANCE_WEIGHT_TFIDF", 0.25))
    importance_weight_heading: float = field(default_factory=lambda: _float("IMPORTANCE_WEIGHT_HEADING", 0.15))
    importance_weight_definition: float = field(
        default_factory=lambda: _float("IMPORTANCE_WEIGHT_DEFINITION", 0.2)
    )
    importance_weight_numeric: float = field(default_factory=lambda: _float("IMPORTANCE_WEIGHT_NUMERIC", 0.1))
    importance_weight_position: float = field(default_factory=lambda: _float("IMPORTANCE_WEIGHT_POSITION", 0.1))
    importance_weight_textrank: float = field(
        default_factory=lambda: _float("IMPORTANCE_WEIGHT_TEXTRANK", 0.2)
    )

    # ---- Part 3: retrieval ----
    # hybrid = alpha * normalized_BM25 + (1 - alpha) * cosine
    retrieval_alpha: float = field(default_factory=lambda: _float("RETRIEVAL_ALPHA", 0.4))
    retrieval_top_k_knowledge: int = field(default_factory=lambda: _int("RETRIEVAL_TOP_K_KNOWLEDGE", 8))
    retrieval_top_k_exam: int = field(default_factory=lambda: _int("RETRIEVAL_TOP_K_EXAM", 5))
    # exam mode re-rank: final = relevance * w_rel + importance * w_imp
    exam_rerank_weight_relevance: float = field(default_factory=lambda: _float("EXAM_RERANK_WEIGHT_RELEVANCE", 0.6))
    exam_rerank_weight_importance: float = field(default_factory=lambda: _float("EXAM_RERANK_WEIGHT_IMPORTANCE", 0.4))
    # exam mode first shortlists top_k * multiplier chunks by relevance, then re-ranks that pool
    exam_candidate_multiplier: int = field(default_factory=lambda: _int("EXAM_CANDIDATE_MULTIPLIER", 3))
    # candidates scoring below ratio * (best relevance) are noise and never returned; this also stops
    # exam-mode importance from promoting a chunk that is barely related to the question
    retrieval_min_relevance_ratio: float = field(
        default_factory=lambda: _float("RETRIEVAL_MIN_RELEVANCE_RATIO", 0.10)
    )
    # "is the retrieved context enough to answer?" heuristics
    min_cosine_sufficient: float = field(default_factory=lambda: _float("MIN_COSINE_SUFFICIENT", 0.25))
    min_term_coverage: float = field(default_factory=lambda: _float("MIN_TERM_COVERAGE", 0.5))
    bm25_cache_size: int = field(default_factory=lambda: _int("BM25_CACHE_SIZE", 32))

    # ---- Part 3: intent router ----
    router_data_path: str = field(
        default_factory=lambda: os.getenv("ROUTER_DATA_PATH", str(SERVICE_ROOT / "data" / "intents.csv"))
    )
    router_model_path: str = field(
        default_factory=lambda: os.getenv("ROUTER_MODEL_PATH", str(SERVICE_ROOT / "artifacts" / "router.joblib"))
    )
    router_rules_confidence: float = field(default_factory=lambda: _float("ROUTER_RULES_CONFIDENCE", 0.95))
    # below this classifier probability we distrust layer 2 and fall back to weak rules / default
    router_min_confidence: float = field(default_factory=lambda: _float("ROUTER_MIN_CONFIDENCE", 0.45))


settings = Settings()
