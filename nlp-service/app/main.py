from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.models.schemas import HealthResponse
from app.routers.analyze import router as analyze_router
from app.routers.ingest import router as ingest_router
from app.routers.retrieve import router as retrieve_router
from app.routers.route import router as route_router

app = FastAPI(title="DocQA NLP Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


_GUARDED_PREFIXES = ("/ingest", "/analyze", "/retrieve", "/route")


@app.middleware("http")
async def internal_key_guard(request: Request, call_next):
    if settings.internal_key and request.url.path.startswith(_GUARDED_PREFIXES):
        provided = request.headers.get("x-internal-key")
        if provided != settings.internal_key:
            # NB: raising HTTPException inside middleware surfaces as a 500, so respond directly
            return JSONResponse({"detail": "invalid or missing X-Internal-Key"}, status_code=401)
    return await call_next(request)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse()


app.include_router(ingest_router)
app.include_router(analyze_router)
app.include_router(retrieve_router)
app.include_router(route_router)
