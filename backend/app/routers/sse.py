import asyncio
import json

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.config import CLERK_PEM_KEY
from app.dependencies import _create_rls_supabase_client, _extract_tenant_id, verify_clerk_token
from app.event_bus import SSEEvent, event_bus
from app.rate_limiter import limiter

router = APIRouter()
admin_router = APIRouter()


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


@router.get("/contracts/{contract_id}/stream")
@limiter.limit("60/minute")
async def stream_contract_events(
    request: Request,
    contract_id: str,
    token: str = Query(..., description="Clerk JWT used for SSE authentication"),
):
    claims = verify_sse_token(token)
    tenant_id = claims["verified_tenant_id"]
    supabase = _create_rls_supabase_client(token)

    contract_res = supabase.table("contracts") \
        .select("id, tenant_id, title, status") \
        .eq("id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .limit(1) \
        .execute()
    if not contract_res.data:
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

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=_streaming_headers(),
    )


@router.get("/tenant/stream")
@limiter.limit("60/minute")
async def stream_tenant_events(
    request: Request,
    token: str = Query(..., description="Clerk JWT used for SSE authentication"),
):
    claims = verify_sse_token(token)
    tenant_id = claims["verified_tenant_id"]
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
    from app.config import admin_supabase
    from app.job_queue import get_pool, get_worker_heartbeat

    try:
        pool = await get_pool()
        redis_info = await pool.info()
        heartbeat_raw = await get_worker_heartbeat()
        heartbeat = json.loads(heartbeat_raw) if heartbeat_raw else None

        queued = admin_supabase.table("task_execution_logs") \
            .select("id", count="exact") \
            .eq("status", "queued") \
            .execute()
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
