"""Pydantic schemas for the public API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SourceType = Literal["pdf", "image", "text"]


class ChunkOut(BaseModel):
    id: str
    text: str
    heading: str = ""
    position: int
    token_count: int


class HeadingOut(BaseModel):
    text: str
    level: int = Field(ge=1, le=6)
    block_index: int
    char_offset: int
    page: int | None = None


class IngestResponse(BaseModel):
    raw_text: str
    cleaned_text: str
    chunks: list[ChunkOut]
    headings: list[HeadingOut]
    source_type: SourceType
    ocr_confidence: float | None = None
    needs_llm_ocr: bool = False
    page_count: int = 1
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


# ---------------------------------------------------------------------------
# Part 2: analysis
# ---------------------------------------------------------------------------


class ChunkIn(BaseModel):
    id: str
    text: str
    heading: str = ""
    position: int
    token_count: int = 0


class AnalyzeRequest(BaseModel):
    chunks: list[ChunkIn]
    top_n_summary: int | None = None
    top_n_keywords: int | None = None


class KeywordOut(BaseModel):
    term: str
    score: float
    sources: list[str]


class TopicOut(BaseModel):
    id: str
    label: str
    top_terms: list[str]
    chunk_ids: list[str]
    size: int


class SummarySentenceOut(BaseModel):
    text: str
    score: float
    position: int
    chunk_id: str


class ImportanceFeaturesOut(BaseModel):
    tfidf: float
    heading: float
    definition: float
    numeric: float
    position: float
    textrank: float


class SentenceImportanceOut(BaseModel):
    text: str
    chunk_id: str
    position: int
    score: float
    features: ImportanceFeaturesOut


class ChunkImportanceOut(BaseModel):
    chunk_id: str
    score: float
    features: ImportanceFeaturesOut


class ChunkEmbeddingOut(BaseModel):
    chunk_id: str
    vector: list[float]


class AnalyzeResponse(BaseModel):
    keywords: list[KeywordOut]
    topics: list[TopicOut]
    summary_sentences: list[SummarySentenceOut]
    importance_sentences: list[SentenceImportanceOut]
    importance_chunks: list[ChunkImportanceOut]
    embeddings: list[ChunkEmbeddingOut]
    embedding_dim: int
    embedding_model: str
    warnings: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Part 3: retrieval + intent routing
# ---------------------------------------------------------------------------

Mode = Literal["knowledge", "exam"]
Intent = Literal["question", "doubt", "quiz", "practice", "research", "resources"]


class RetrieveChunkIn(ChunkIn):
    """A stored chunk, optionally with the vector computed by /analyze."""

    embedding: list[float] | None = None


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    chunks: list[RetrieveChunkIn]
    mode: Mode = "knowledge"
    top_k: int | None = Field(default=None, ge=1, le=50)
    alpha: float | None = Field(default=None, ge=0.0, le=1.0)
    # chunk_id -> importance score from /analyze (needed for exam-mode re-ranking)
    importance: dict[str, float] | None = None
    # `embedding_model` reported by /analyze for the stored vectors
    embedding_model: str | None = None


class RetrievedChunkOut(BaseModel):
    id: str
    text: str
    heading: str = ""
    position: int
    token_count: int = 0
    rank: int
    bm25_score: float  # raw BM25 (>= 0)
    bm25_norm: float  # min-max normalized over the whole document, 0..1
    cosine: float  # 0..1 (negative cosine clipped to 0)
    relevance: float  # alpha * bm25_norm + (1 - alpha) * cosine
    importance: float | None = None  # raw importance score from /analyze
    importance_norm: float | None = None  # min-max normalized over the document
    final_score: float  # knowledge: relevance; exam: relevance*0.6 + importance_norm*0.4


class RetrieveResponse(BaseModel):
    query: str
    mode: Mode
    top_k: int
    alpha: float
    retrieval_method: str
    embedding_model: str | None = None
    reranked_by_importance: bool
    sufficient: bool
    max_cosine: float
    query_term_coverage: float
    chunks: list[RetrievedChunkOut]
    warnings: list[str] = Field(default_factory=list)


class RouteRequest(BaseModel):
    query: str = Field(min_length=1)


class RouteResponse(BaseModel):
    intent: Intent
    confidence: float
    method: Literal["rules", "classifier", "fallback"]
    matched_rules: list[str] = Field(default_factory=list)
    scores: dict[str, float] = Field(default_factory=dict)
