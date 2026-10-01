from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.models.schemas import RetrieveRequest, RetrieveResponse
from app.services.retrieval import retrieve

router = APIRouter(tags=["retrieve"])


@router.post("/retrieve", response_model=RetrieveResponse)
async def retrieve_chunks(payload: RetrieveRequest) -> RetrieveResponse:
    if not payload.chunks:
        raise HTTPException(400, "chunks must not be empty")
    if not payload.query.strip():
        raise HTTPException(400, "query must not be blank")

    result = await run_in_threadpool(
        retrieve,
        payload.query,
        payload.chunks,
        mode=payload.mode,
        top_k=payload.top_k,
        alpha=payload.alpha,
        importance=payload.importance,
        embedding_model=payload.embedding_model,
    )
    meta = result["meta"]
    return RetrieveResponse(query=payload.query, mode=payload.mode, chunks=result["chunks"], **meta)
