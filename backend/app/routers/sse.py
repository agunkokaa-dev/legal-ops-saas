import asyncio

import jwt
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.config import CLERK_PEM_KEY
from app.dependencies import _create_rls_supabase_client, _extract_tenant_id
from app.event_bus import SSEEvent, event_bus

router = APIRouter()


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
async def stream_contract_events(
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
async def stream_tenant_events(
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
async def get_sse_stats():
    return event_bus.get_stats()
