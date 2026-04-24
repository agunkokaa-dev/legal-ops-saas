import asyncio
import json
import logging

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import CLERK_PEM_KEY
from app.dependencies import (
    _create_rls_supabase_client,
    _extract_tenant_id,
    get_tenant_admin_supabase,
    verify_clerk_token,
)
from app.event_bus import SSEEvent, event_bus
from app.rate_limiter import limiter
from app.sse_session import (
    SSE_TOKEN_TTL,
    create_sse_session,
    invalidate_sse_session,
    validate_sse_session,
)

router = APIRouter()
admin_router = APIRouter()
logger = logging.getLogger(__name__)


def verify_sse_token(token: str) -> dict:
    if not CLERK_PEM_KEY:
        raise HTTPException(status_code=500, detail="Server authentication configuration error.")

    try:
        claims = jwt.decode(token, CLERK_PEM_KEY, algorithms=["RS256"])
        tenant_id = _extract_tenant_id(claims)
        if not tenant_id:
            raise HTTPException(status_code=401, detail="No valid tenant identity found in token")
        claims["verified_tenant_id"] = tenant_id
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")


def _streaming_headers() -> dict[str, str]:
    return {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


class SSESessionResponse(BaseModel):
    sse_token: str
    expires_in: int = SSE_TOKEN_TTL


async def _get_sse_session_redis():
    return await event_bus.get_redis()


def _sse_auth_error_response(message: str, status_code: int = 401) -> StreamingResponse:
    async def error_stream():
        yield "event: auth_error\n"
        yield f"data: {json.dumps({'message': message})}\n\n"

    return StreamingResponse(
        error_stream(),
        media_type="text/event-stream",
        status_code=status_code,
        headers=_streaming_headers(),
    )


async def _resolve_stream_auth(
    *,
    request: Request,
    sse_token: str | None,
    token: str | None,
) -> tuple[str | None, bool]:
    if sse_token:
        redis_client = await _get_sse_session_redis()
        session = await validate_sse_session(redis_client, sse_token)
        if not session:
            return None, False
        return session["tenant_id"], False

    if token:
        logger.warning(
            "SSE: legacy Clerk JWT used in query param",
            extra={"endpoint": str(request.url.path)},
        )
        claims = verify_sse_token(token)
        return claims["verified_tenant_id"], True

    return None, False


def _load_contract_for_stream(*, supabase, contract_id: str, tenant_id: str, apply_tenant_filter: bool):
    query = supabase.table("contracts").select("id, tenant_id, title, status").eq("id", contract_id)
    if apply_tenant_filter:
        query = query.eq("tenant_id", tenant_id)
    return query.limit(1).execute()


@router.post("/session", response_model=SSESessionResponse)
@limiter.limit("30/minute")
async def create_sse_session_endpoint(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]
    redis_client = await _get_sse_session_redis()
    token = await create_sse_session(redis_client, tenant_id)
    return SSESessionResponse(sse_token=token, expires_in=SSE_TOKEN_TTL)


@router.get("/contracts/{contract_id}/stream")
@limiter.limit("60/minute")
async def stream_contract_events(
    request: Request,
    contract_id: str,
    sse_token: str | None = Query(default=None, description="Opaque SSE session token"),
    token: str | None = Query(default=None, description="Legacy Clerk JWT used for SSE authentication"),
):
    try:
        tenant_id, using_legacy = await _resolve_stream_auth(
            request=request,
            sse_token=sse_token,
            token=token,
        )
    except HTTPException as exc:
        return _sse_auth_error_response(str(exc.detail), status_code=exc.status_code)

    if not tenant_id:
        return _sse_auth_error_response("SSE session expired or invalid")

    if using_legacy:
        supabase = _create_rls_supabase_client(token or "")
        contract_res = _load_contract_for_stream(
            supabase=supabase,
            contract_id=contract_id,
            tenant_id=tenant_id,
            apply_tenant_filter=True,
        )
    else:
        supabase = get_tenant_admin_supabase(tenant_id)
        contract_res = _load_contract_for_stream(
            supabase=supabase,
            contract_id=contract_id,
            tenant_id=tenant_id,
            apply_tenant_filter=False,
        )

    if not contract_res.data:
        if sse_token and not using_legacy:
            redis_client = await _get_sse_session_redis()
            await invalidate_sse_session(redis_client, sse_token)
        raise HTTPException(status_code=404, detail="Contract not found or access denied")

    queue = event_bus.subscribe_contract(contract_id, tenant_id)

    async def event_generator():
        try:
            initial_event = SSEEvent(
                event_type="connected",
                contract_id=contract_id,
                tenant_id=tenant_id,
                data={
                    "message": "SSE connection established",
                    "contract_id": contract_id,
                },
            )
            yield initial_event.format_sse()

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=event_bus.keepalive_interval)
                    yield event.format_sse()
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            event_bus.unsubscribe_contract(contract_id, queue)
            if sse_token and not using_legacy:
                redis_client = await _get_sse_session_redis()
                await invalidate_sse_session(redis_client, sse_token)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=_streaming_headers(),
    )


@router.get("/tenant/stream")
@limiter.limit("60/minute")
async def stream_tenant_events(
    request: Request,
    sse_token: str | None = Query(default=None, description="Opaque SSE session token"),
    token: str | None = Query(default=None, description="Legacy Clerk JWT used for SSE authentication"),
):
    try:
        tenant_id, using_legacy = await _resolve_stream_auth(
            request=request,
            sse_token=sse_token,
            token=token,
        )
    except HTTPException as exc:
        return _sse_auth_error_response(str(exc.detail), status_code=exc.status_code)

    if not tenant_id:
        return _sse_auth_error_response("SSE session expired or invalid")

    queue = event_bus.subscribe_tenant(tenant_id)

    async def event_generator():
        try:
            initial_event = SSEEvent(
                event_type="connected",
                tenant_id=tenant_id,
                data={"message": "Tenant SSE connection established"},
            )
            yield initial_event.format_sse()

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=event_bus.keepalive_interval)
                    yield event.format_sse()
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            event_bus.unsubscribe_tenant(tenant_id, queue)
            if sse_token and not using_legacy:
                redis_client = await _get_sse_session_redis()
                await invalidate_sse_session(redis_client, sse_token)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=_streaming_headers(),
    )


@router.get("/stats")
@limiter.limit("60/minute")
async def get_sse_stats(request: Request):
    return event_bus.get_stats()


@admin_router.get("/worker-health")
@limiter.limit("60/minute")
async def get_worker_health(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
):
    # CROSS-TENANT: worker health aggregates system-level queue metrics from task execution logs.
    from app.config import admin_supabase
    from app.job_queue import get_pool, get_worker_heartbeat

    try:
        pool = await get_pool()
        redis_info = await pool.info()
        heartbeat_raw = await get_worker_heartbeat()
        heartbeat = json.loads(heartbeat_raw) if heartbeat_raw else None

        # CROSS-TENANT: worker health reads system-level queue metrics.
        queued = admin_supabase.table("task_execution_logs") \
            .select("id", count="exact") \
            .eq("status", "queued") \
            .execute()
        # CROSS-TENANT: worker health reads system-level queue metrics.
        running = admin_supabase.table("task_execution_logs") \
            .select("id", count="exact") \
            .eq("status", "running") \
            .execute()

        return {
            "worker_status": "healthy" if heartbeat else "unhealthy",
            "redis_connected": True,
            "jobs_queued": queued.count or 0,
            "jobs_running": running.count or 0,
            "worker_heartbeat": heartbeat,
            "redis_info": {
                "used_memory": redis_info.get("used_memory_human", "unknown"),
                "connected_clients": redis_info.get("connected_clients", 0),
            },
        }
    except Exception as exc:
        return {
            "worker_status": "unhealthy",
            "redis_connected": False,
            "error": str(exc),
        }
