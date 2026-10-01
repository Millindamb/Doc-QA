"""Image preprocessing (OpenCV, our own pipeline) + OCR (EasyOCR primary, Tesseract fallback)."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

import cv2
import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)

try:
    import pytesseract
except ImportError:  # pragma: no cover
    pytesseract = None

try:
    import easyocr
except ImportError:  # pragma: no cover
    easyocr = None


@dataclass
class OcrResult:
    text: str
    confidence: float  # 0..1
    engine: str


def _deskew_angle(gray: np.ndarray) -> float:
    """Estimate skew angle via minAreaRect over dark pixels; fall back to 0.0."""
    inverted = cv2.bitwise_not(gray)
    coords = cv2.findNonZero((inverted > 30).astype(np.uint8))
    if coords is None or len(coords) < 20:
        return 0.0
    rect = cv2.minAreaRect(coords)
    angle = rect[-1]
    if angle < -45:
        angle = -(90 + angle)
    else:
        angle = -angle
    # Guard against nonsense angles on near-blank / weird images
    if abs(angle) > 30:
        return 0.0
    return float(angle)


def _rotate(image: np.ndarray, angle: float) -> np.ndarray:
    if abs(angle) < 0.1:
        return image
    (h, w) = image.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        image, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )


def preprocess_image(image_bgr: np.ndarray) -> np.ndarray:
    """grayscale -> denoise -> deskew -> adaptive threshold. Returns a binary image."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, h=10, templateWindowSize=7, searchWindowSize=21)

    angle = _deskew_angle(denoised)
    deskewed = _rotate(denoised, angle)

    binary = cv2.adaptiveThreshold(
        deskewed,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=15,
    )
    return binary


@lru_cache(maxsize=1)
def _easyocr_reader():
    if easyocr is None:
        return None
    return easyocr.Reader(list(settings.ocr_langs), gpu=settings.ocr_gpu, verbose=False)


def _run_easyocr(binary_img: np.ndarray) -> OcrResult | None:
    reader = _easyocr_reader()
    if reader is None:
        return None
    try:
        rgb = cv2.cvtColor(binary_img, cv2.COLOR_GRAY2RGB)
        results = reader.readtext(rgb, detail=1, paragraph=True)
    except Exception:
        logger.exception("EasyOCR failed")
        return None

    if not results:
        return OcrResult(text="", confidence=0.0, engine="easyocr")

    # paragraph=True mode returns (box, text) pairs without confidence; fall back
    # to a second detail=1, paragraph=False pass only if needed for confidence.
    texts = []
    confidences = []
    for item in results:
        if len(item) == 3:
            _, text, conf = item
            confidences.append(float(conf))
        else:
            _, text = item
        texts.append(text)

    avg_conf = sum(confidences) / len(confidences) if confidences else 0.7
    return OcrResult(text="\n".join(texts), confidence=avg_conf, engine="easyocr")


def _run_tesseract(binary_img: np.ndarray) -> OcrResult | None:
    if pytesseract is None:
        return None
    try:
        data = pytesseract.image_to_data(
            binary_img,
            lang=settings.tesseract_lang,
            output_type=pytesseract.Output.DICT,
        )
    except Exception:
        logger.exception("Tesseract failed")
        return None

    words = []
    confs = []
    for text, conf in zip(data.get("text", []), data.get("conf", [])):
        text = text.strip()
        if not text:
            continue
        words.append(text)
        try:
            c = float(conf)
        except (TypeError, ValueError):
            continue
        if c >= 0:
            confs.append(c)

    avg_conf = (sum(confs) / len(confs) / 100.0) if confs else 0.0
    return OcrResult(text=" ".join(words), confidence=avg_conf, engine="tesseract")


def ocr_image(image_bgr: np.ndarray) -> OcrResult:
    """Run the configured OCR engines in order, keep the best (highest-confidence)
    result, and short-circuit once a result clears OCR_GOOD_CONFIDENCE."""
    binary = preprocess_image(image_bgr)

    best: OcrResult | None = None
    for engine in settings.ocr_engines:
        result = _run_easyocr(binary) if engine == "easyocr" else _run_tesseract(binary)
        if result is None:
            continue
        if best is None or result.confidence > best.confidence:
            best = result
        if best.confidence >= settings.ocr_good_confidence:
            break

    if best is None:
        return OcrResult(text="", confidence=0.0, engine="none")
    return best
