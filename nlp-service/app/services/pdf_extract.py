"""PDF text extraction (PyMuPDF) with per-page scanned-page detection.

A page whose extracted text is (near) empty is treated as scanned: it's
rasterized to an image and run through the OCR pipeline instead.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import fitz  # PyMuPDF
import numpy as np

from app.config import settings
from app.services.ocr import OcrResult, ocr_image


@dataclass
class PageResult:
    page_number: int  # 1-based
    text: str
    used_ocr: bool
    ocr_confidence: float | None = None
    font_hints: dict[str, float] = field(default_factory=dict)  # line text -> dominant font size


@dataclass
class PdfExtractResult:
    pages: list[PageResult]
    page_count: int
    any_ocr_used: bool
    min_ocr_confidence: float | None  # lowest confidence among OCR'd pages, if any


def _page_to_image(page: "fitz.Page", dpi: int) -> np.ndarray:
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        arr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
    else:
        arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    return arr


def _extract_font_hints(page: "fitz.Page") -> dict[str, float]:
    """Map each line's text -> its dominant span font size, for heading detection."""
    hints: dict[str, float] = {}
    try:
        raw = page.get_text("dict")
    except Exception:
        return hints
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = "".join(s.get("text", "") for s in spans).strip()
            if not text:
                continue
            sizes = [s.get("size", 0) for s in spans if s.get("text", "").strip()]
            if sizes:
                hints[text] = max(sizes)
    return hints


def extract_pdf(file_bytes: bytes) -> PdfExtractResult:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages: list[PageResult] = []
    any_ocr = False
    ocr_confidences: list[float] = []
    ocr_page_budget = settings.max_ocr_pages

    try:
        for i, page in enumerate(doc, start=1):
            text = page.get_text("text") or ""
            font_hints = _extract_font_hints(page)

            if len(text.strip()) >= settings.min_page_chars or ocr_page_budget <= 0:
                pages.append(PageResult(page_number=i, text=text, used_ocr=False, font_hints=font_hints))
                continue

            # Scanned / near-empty page -> rasterize + OCR
            img = _page_to_image(page, settings.ocr_dpi)
            result: OcrResult = ocr_image(img)
            any_ocr = True
            ocr_page_budget -= 1
            ocr_confidences.append(result.confidence)
            pages.append(
                PageResult(
                    page_number=i,
                    text=result.text,
                    used_ocr=True,
                    ocr_confidence=result.confidence,
                    font_hints=font_hints,
                )
            )
    finally:
        doc.close()

    min_conf = min(ocr_confidences) if ocr_confidences else None
    return PdfExtractResult(
        pages=pages, page_count=len(pages), any_ocr_used=any_ocr, min_ocr_confidence=min_conf
    )
