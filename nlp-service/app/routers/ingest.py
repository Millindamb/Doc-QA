from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import settings
from app.models.schemas import IngestResponse
from app.services.ingest import ingest_image, ingest_pdf, ingest_text

router = APIRouter(tags=["ingest"])

_ALLOWED_CONTENT_TYPES = {
    "pdf": {"application/pdf"},
    "image": {"image/png", "image/jpeg", "image/jpg"},
    "text": {"text/plain"},
}


@router.post("/ingest", response_model=IngestResponse)
async def ingest(
    file: UploadFile | None = File(default=None),
    source_type: str | None = Form(default=None),
    text: str | None = Form(default=None),
):
    """Ingest a document.

    - PDF/image: send multipart/form-data with `file`.
    - Raw text: send multipart/form-data (or JSON via the `/ingest/text` alias)
      with `text` and no file.
    """
    if text is not None and file is None:
        if not text.strip():
            raise HTTPException(400, "text must not be empty")
        return ingest_text(text)

    if file is None:
        raise HTTPException(400, "provide either `file` or `text`")

    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(413, f"file exceeds {settings.max_upload_mb}MB limit")
    if not content:
        raise HTTPException(400, "uploaded file is empty")

    resolved_type = source_type or _infer_source_type(file.content_type, file.filename)

    if resolved_type == "pdf":
        return ingest_pdf(content)
    if resolved_type == "image":
        return ingest_image(content)
    if resolved_type == "text":
        return ingest_text(content.decode("utf-8", errors="replace"))

    raise HTTPException(400, f"unsupported source_type: {resolved_type}")


def _infer_source_type(content_type: str | None, filename: str | None) -> str:
    ct = (content_type or "").lower()
    name = (filename or "").lower()
    if ct == "application/pdf" or name.endswith(".pdf"):
        return "pdf"
    if ct.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg")):
        return "image"
    if ct.startswith("text/") or name.endswith(".txt"):
        return "text"
    return "unknown"
