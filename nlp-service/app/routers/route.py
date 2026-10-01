from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.models.schemas import RouteRequest, RouteResponse
from app.services.intent_router import route_query

router = APIRouter(tags=["route"])


@router.post("/route", response_model=RouteResponse)
async def route(payload: RouteRequest) -> RouteResponse:
    if not payload.query.strip():
        raise HTTPException(400, "query must not be blank")
    return RouteResponse(**(await run_in_threadpool(route_query, payload.query)))
