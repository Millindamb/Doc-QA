from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.analyze import analyze_chunks

router = APIRouter(tags=["analyze"])


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(payload: AnalyzeRequest):
    if not payload.chunks:
        raise HTTPException(400, "chunks must not be empty")

    result = analyze_chunks(
        payload.chunks,
        top_n_summary=payload.top_n_summary,
        top_n_keywords=payload.top_n_keywords,
    )
    return result
