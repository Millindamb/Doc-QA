"""Top-level orchestration: source bytes -> cleaned_text, chunks, headings, flags."""
from __future__ import annotations

import cv2
import numpy as np

from app.config import settings
from app.models.schemas import ChunkOut, HeadingOut, IngestResponse
from app.services.chunking import chunk_document
from app.services.cleaning import clean_pages
from app.services.headings import detect_headings
from app.services.ocr import ocr_image
from app.services.pdf_extract import extract_pdf


def _build_response(
    raw_text: str,
    pages: list[str],
    source_type: str,
    ocr_confidence: float | None,
    page_count: int,
    warnings: list[str],
) -> IngestResponse:
    cleaned_text = clean_pages(pages)

    # Merge font hints across pages isn't wired here (per-page in pdf path);
    # headings for pdf source use font hints inside ingest_pdf instead.
    headings = detect_headings(cleaned_text)
    chunks = chunk_document(
        cleaned_text,
        headings,
        target_tokens=settings.chunk_target_tokens,
        overlap_tokens=settings.chunk_overlap_tokens,
    )

    total_chars = len(cleaned_text.strip())
    needs_llm_ocr = total_chars < settings.min_total_chars or (
        ocr_confidence is not None and ocr_confidence < settings.ocr_min_confidence
    )

    return IngestResponse(
        raw_text=raw_text,
        cleaned_text=cleaned_text,
        chunks=[ChunkOut(**c.__dict__) for c in chunks],
        headings=[
            HeadingOut(
                text=h.text, level=h.level, block_index=h.line_index,
                char_offset=cleaned_text.find(h.text),
            )
            for h in headings
        ],
        source_type=source_type,  # type: ignore[arg-type]
        ocr_confidence=ocr_confidence,
        needs_llm_ocr=needs_llm_ocr,
        page_count=page_count,
        warnings=warnings,
    )


def ingest_text(raw_text: str) -> IngestResponse:
    return _build_response(
        raw_text=raw_text,
        pages=[raw_text],
        source_type="text",
        ocr_confidence=None,
        page_count=1,
        warnings=[],
    )


def ingest_image(file_bytes: bytes) -> IngestResponse:
    arr = np.frombuffer(file_bytes, dtype=np.uint8)
    image_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    warnings: list[str] = []
    if image_bgr is None:
        return _build_response(
            raw_text="", pages=[""], source_type="image", ocr_confidence=0.0,
            page_count=1, warnings=["could not decode image file"],
        )

    result = ocr_image(image_bgr)
    if result.confidence < settings.ocr_min_confidence:
        warnings.append(f"low OCR confidence ({result.confidence:.2f})")

    return _build_response(
        raw_text=result.text,
        pages=[result.text],
        source_type="image",
        ocr_confidence=result.confidence,
        page_count=1,
        warnings=warnings,
    )


def ingest_pdf(file_bytes: bytes) -> IngestResponse:
    extracted = extract_pdf(file_bytes)
    pages = [p.text for p in extracted.pages]
    raw_text = "\n\n".join(pages)
    warnings: list[str] = []

    if extracted.any_ocr_used and extracted.min_ocr_confidence is not None:
        if extracted.min_ocr_confidence < settings.ocr_min_confidence:
            warnings.append(f"low OCR confidence on some pages ({extracted.min_ocr_confidence:.2f})")

    # Merge per-page font hints (keyed by line text) so heading detection can use them.
    cleaned_text = clean_pages(pages)
    font_hints: dict[str, float] = {}
    for p in extracted.pages:
        font_hints.update(p.font_hints)

    headings = detect_headings(cleaned_text, font_hints=font_hints)
    chunks = chunk_document(
        cleaned_text,
        headings,
        target_tokens=settings.chunk_target_tokens,
        overlap_tokens=settings.chunk_overlap_tokens,
    )

    total_chars = len(cleaned_text.strip())
    needs_llm_ocr = total_chars < settings.min_total_chars or (
        extracted.min_ocr_confidence is not None
        and extracted.min_ocr_confidence < settings.ocr_min_confidence
    )

    return IngestResponse(
        raw_text=raw_text,
        cleaned_text=cleaned_text,
        chunks=[ChunkOut(**c.__dict__) for c in chunks],
        headings=[
            HeadingOut(
                text=h.text, level=h.level, block_index=h.line_index,
                char_offset=cleaned_text.find(h.text),
            )
            for h in headings
        ],
        source_type="pdf",
        ocr_confidence=extracted.min_ocr_confidence,
        needs_llm_ocr=needs_llm_ocr,
        page_count=extracted.page_count,
        warnings=warnings,
    )
