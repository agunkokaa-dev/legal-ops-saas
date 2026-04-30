"""
Pariana Backend — Admin Endpoints for Indonesian National Law Corpus

GET  /api/v1/admin/national-laws/stats   → Collection health & per-law breakdown
POST /api/v1/admin/national-laws/search  → Semantic search for testing retrieval quality

Both endpoints require Clerk authentication but do NOT apply tenant_id filtering
since id_national_laws is a global corpus shared across all tenants.
"""
import asyncio
import time
import traceback
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from qdrant_client.http.models import Filter, FieldCondition, MatchValue

from app.ai_usage import log_openai_response_sync
from app.config import admin_supabase, openai_client, qdrant, NATIONAL_LAWS_COLLECTION
from app.dependencies import verify_clerk_token
from app.rate_limiter import limiter

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------
class LawSearchRequest(BaseModel):
    query: str = Field(..., description="Search query text")
    category: Optional[str] = Field(None, description="Filter by category (e.g., 'data_protection')")
    law: Optional[str] = Field(None, description="Filter by source_law_short (e.g., 'UU 27/2022')")
    limit: int = Field(10, ge=1, le=50, description="Max results to return")


class LawSearchHit(BaseModel):
    score: float
    source_law: str
    source_law_short: str
    category: str
    pasal: str
    text_preview: str
    effective_date: Optional[str] = None
    is_active: bool = True


class LawSearchResponse(BaseModel):
    query: str
    total_hits: int
    hits: list[LawSearchHit]


class LawStatsResponse(BaseModel):
    collection_exists: bool
    total_vectors: int
    per_law: dict  # source_law_short → count
    status: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def async_embed(text: str, *, tenant_id: str | None = None) -> list[float]:
    started_at = time.perf_counter()
    response = await asyncio.to_thread(
        openai_client.embeddings.create,
        input=text[:8000],
        model="text-embedding-3-small",
    )
    log_openai_response_sync(
        admin_supabase,
        tenant_id,
        "national_law_search_embedding",
        "text-embedding-3-small",
        response,
        int((time.perf_counter() - started_at) * 1000),
    )
    return response.data[0].embedding


# ---------------------------------------------------------------------------
# GET /stats
# ---------------------------------------------------------------------------
@router.get("/national-laws/stats", response_model=LawStatsResponse)
@limiter.limit("60/minute")
async def get_national_laws_stats(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
):
    """Returns collection health and per-law vector breakdown."""
    try:
        collections = await asyncio.to_thread(qdrant.get_collections)
        exists = any(c.name == NATIONAL_LAWS_COLLECTION for c in collections.collections)

        if not exists:
            return LawStatsResponse(
                collection_exists=False,
                total_vectors=0,
                per_law={},
                status="Collection does not exist. Run ingest_national_laws.py first.",
            )

        info = await asyncio.to_thread(qdrant.get_collection, NATIONAL_LAWS_COLLECTION)
        total = info.points_count or 0

        # Scroll all points to compute per-law breakdown
        per_law: dict = {}
        offset = None
        while True:
            scroll_kwargs = {
                "collection_name": NATIONAL_LAWS_COLLECTION,
                "limit": 100,
                "with_payload": ["source_law_short"],
                "with_vectors": False,
            }
            if offset is not None:
                scroll_kwargs["offset"] = offset

            points, next_offset = await asyncio.to_thread(qdrant.scroll, **scroll_kwargs)
            for p in points:
                law_short = p.payload.get("source_law_short", "Unknown")
                per_law[law_short] = per_law.get(law_short, 0) + 1

            if next_offset is None:
                break
            offset = next_offset

        return LawStatsResponse(
            collection_exists=True,
            total_vectors=total,
            per_law=per_law,
            status="healthy",
        )

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


# ---------------------------------------------------------------------------
# POST /search
# ---------------------------------------------------------------------------
@router.post("/national-laws/search", response_model=LawSearchResponse)
@limiter.limit("60/minute")
async def search_national_laws(
    request: Request,
    body: LawSearchRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """Semantic search over the national law corpus for testing retrieval quality."""
    try:
        # Build optional filters — NO tenant filter (global corpus)
        must_conditions = [
            FieldCondition(key="is_active", match=MatchValue(value=True))
        ]
        if body.category:
            must_conditions.append(
                FieldCondition(key="category", match=MatchValue(value=body.category))
            )
        if body.law:
            must_conditions.append(
                FieldCondition(key="source_law_short", match=MatchValue(value=body.law))
            )

        query_filter = Filter(must=must_conditions) if must_conditions else None

        # Embed query
        vector = await async_embed(body.query, tenant_id=claims.get("verified_tenant_id"))

        # Search Qdrant
        results = await asyncio.to_thread(
            qdrant.query_points,
            collection_name=NATIONAL_LAWS_COLLECTION,
            query=vector,
            query_filter=query_filter,
            limit=body.limit,
            with_payload=True,
        )

        hits = []
        for point in results.points:
            p = point.payload
            hits.append(LawSearchHit(
                score=round(point.score, 4),
                source_law=p.get("source_law", ""),
                source_law_short=p.get("source_law_short", ""),
                category=p.get("category", ""),
                pasal=p.get("pasal", ""),
                text_preview=p.get("text", "")[:500],
                effective_date=p.get("effective_date"),
                is_active=p.get("is_active", True),
            ))

        return LawSearchResponse(
            query=body.query,
            total_hits=len(hits),
            hits=hits,
        )

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
