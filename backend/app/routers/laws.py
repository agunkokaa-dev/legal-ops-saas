from __future__ import annotations

import logging
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.cache.law_cache import cache_get_json, cache_set_json, get_cache_key, get_redis_client
from app.dependencies import verify_clerk_token
from app.laws.authz import require_laws_admin
from app.laws.schemas import (
    CitationLookupResponse,
    LawsCatalogResponse,
    LawDetailResponse,
    LawSearchRequest,
    LawSearchResponse,
)
from app.laws.service import LAW_PAYLOAD_SCHEMA_VERSION, LawRetrievalService, build_law_retrieval_service
from app.laws.utils import sanitize_query_text, utcnow
from app.middleware.log_redaction import redact_pii, sha256_text
from app.rate_limiter import limiter

logger = logging.getLogger("pariana.laws.router")

router = APIRouter()


def get_law_service() -> LawRetrievalService:
    return build_law_retrieval_service()


def _hash_claim(value: str | None) -> str:
    return sha256_text(value or "")


def _enforce_daily_quota(*, claims: dict, endpoint_key: str, user_limit: int, tenant_limit: int) -> None:
    client = get_redis_client()
    if not client:
        return
    user_id = str(claims.get("sub") or "")
    tenant_id = str(claims.get("verified_tenant_id") or "")
    today_key = date.today().isoformat()
    user_key = f"laws:quota:user:{endpoint_key}:{today_key}:{user_id}"
    tenant_key = f"laws:quota:tenant:{endpoint_key}:{today_key}:{tenant_id}"
    for key, limit in [(user_key, user_limit), (tenant_key, tenant_limit)]:
        count = client.incr(key)
        if count == 1:
            client.expire(key, 60 * 60 * 24 * 2)
        if count > limit:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit_exceeded",
                    "message": "Daily quota exceeded for the laws module.",
                    "retry_after": 86400,
                },
            )


def _log_query_event(
    *,
    endpoint: str,
    query: str | None,
    claims: dict,
    intent: str,
    result_count: int,
) -> None:
    redacted_query = redact_pii(query or "")
    logger.info(
        "LAWS_QUERY %s",
        {
            "service": "laws",
            "endpoint": endpoint,
            "user_id_hash": _hash_claim(str(claims.get("sub"))),
            "tenant_id_hash": _hash_claim(str(claims.get("verified_tenant_id"))),
            "query_hash": sha256_text(redacted_query),
            "intent": intent,
            "result_count": result_count,
        },
    )


class CitationTextRequest(BaseModel):
    text: str = Field(..., min_length=3, max_length=500)
    effective_as_of: date | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        return sanitize_query_text(value)


@router.post("/laws/search", response_model=LawSearchResponse)
@limiter.limit("60/minute")
async def search_laws(
    request: Request,
    body: LawSearchRequest,
    claims: dict = Depends(verify_clerk_token),
    service: LawRetrievalService = Depends(get_law_service),
):
    _enforce_daily_quota(claims=claims, endpoint_key="search", user_limit=500, tenant_limit=5000)
    try:
        response = await service.search(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    _log_query_event(
        endpoint="/api/v1/laws/search",
        query=body.query,
        claims=claims,
        intent=response.intent,
        result_count=len(response.results),
    )
    return response


@router.get("/laws/citation", response_model=CitationLookupResponse)
@limiter.limit("120/minute")
async def citation_lookup(
    request: Request,
    text: Annotated[str, Query(min_length=3, max_length=500)],
    effective_as_of: date | None = None,
    claims: dict = Depends(verify_clerk_token),
    service: LawRetrievalService = Depends(get_law_service),
):
    response = await service.citation_lookup(text, effective_as_of=effective_as_of)
    _log_query_event(
        endpoint="/api/v1/laws/citation",
        query=text,
        claims=claims,
        intent="citation",
        result_count=len(response["results"]),
    )
    return response


@router.post("/laws/citation", response_model=CitationLookupResponse)
@limiter.limit("120/minute")
async def citation_lookup_post(
    request: Request,
    body: CitationTextRequest,
    claims: dict = Depends(verify_clerk_token),
    service: LawRetrievalService = Depends(get_law_service),
):
    response = await service.citation_lookup(body.text, effective_as_of=body.effective_as_of)
    _log_query_event(
        endpoint="/api/v1/laws/citation",
        query=body.text,
        claims=claims,
        intent="citation",
        result_count=len(response["results"]),
    )
    return response


@router.get("/laws/pasal/{node_id}", response_model=LawDetailResponse)
@limiter.limit("120/minute")
async def get_pasal_detail(
    request: Request,
    node_id: UUID,
    effective_as_of: date | None = None,
    claims: dict = Depends(verify_clerk_token),
    service: LawRetrievalService = Depends(get_law_service),
):
    cache_key = get_cache_key("pasal", str(node_id), effective_as_of.isoformat() if effective_as_of else "today")
    cached = cache_get_json(cache_key)
    if cached:
        return cached

    try:
        response = await service.get_pasal_detail(str(node_id), effective_as_of=effective_as_of)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    cache_set_json(cache_key, response.model_dump(), ttl_seconds=300)
    return response


@router.get("/laws/catalogs", response_model=LawsCatalogResponse)
@limiter.limit("30/minute")
async def get_laws_catalogs(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    service: LawRetrievalService = Depends(get_law_service),
):
    cache_key = get_cache_key("catalogs")
    cached = cache_get_json(cache_key)
    if cached:
        return cached
    response = await service.get_catalogs()
    cache_set_json(cache_key, response.model_dump(), ttl_seconds=300)
    return response


@router.get("/laws/coverage")
@limiter.limit("30/minute")
async def get_laws_coverage(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    service: LawRetrievalService = Depends(get_law_service),
):
    cache_key = get_cache_key("coverage")
    cached = cache_get_json(cache_key)
    if cached:
        return cached
    response = await service.get_coverage()
    cache_set_json(cache_key, response, ttl_seconds=300)
    return response


@router.get("/laws/admin/sync-status")
@limiter.limit("10/minute")
async def get_sync_status(
    request: Request,
    claims: dict = Depends(require_laws_admin),
    service: LawRetrievalService = Depends(get_law_service),
):
    status = service.repository.get_sync_status(
        alias_name=service.repository.active_collection,
        target_collection=service.repository.v2_collection,
        payload_schema_version=LAW_PAYLOAD_SCHEMA_VERSION,
    )
    return {**status, "last_sync_at": utcnow().isoformat()}
