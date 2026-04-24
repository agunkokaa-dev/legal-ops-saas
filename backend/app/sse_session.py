"""
SSE Session Token Manager

Replaces long-lived Clerk JWTs in SSE query params with short-lived
opaque session tokens stored in Redis.

Security properties:
- Token is random 32-byte hex and carries no information.
- TTL is 300 seconds (5 minutes).
- Token is invalidated when the SSE connection closes.
- Redis key: sse_session:{token} -> JSON {tenant_id, contract_id?, issued_at}
"""

from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Any


logger = logging.getLogger(__name__)

SSE_TOKEN_TTL = 300
SSE_TOKEN_PREFIX = "sse_session:"
SSE_TOKEN_LENGTH = 32


async def create_sse_session(
    redis_client,
    tenant_id: str,
    contract_id: str | None = None,
) -> str:
    if not tenant_id or not tenant_id.strip():
        raise ValueError("tenant_id required for SSE session")

    token = secrets.token_hex(SSE_TOKEN_LENGTH)
    key = f"{SSE_TOKEN_PREFIX}{token}"

    payload: dict[str, Any] = {
        "tenant_id": tenant_id,
        "issued_at": time.time(),
    }
    if contract_id:
        payload["contract_id"] = contract_id

    await redis_client.set(key, json.dumps(payload), ex=SSE_TOKEN_TTL)

    logger.info(
        "SSE session created",
        extra={
            "tenant_id_hash": hash(tenant_id),
            "token_prefix": token[:8],
            "has_contract_id": contract_id is not None,
        },
    )
    return token


async def validate_sse_session(
    redis_client,
    token: str,
) -> dict[str, Any] | None:
    if not token or len(token) != SSE_TOKEN_LENGTH * 2:
        logger.warning("SSE session: invalid token format")
        return None

    key = f"{SSE_TOKEN_PREFIX}{token}"
    try:
        raw = await redis_client.get(key)
        if not raw:
            logger.warning(
                "SSE session: not found or expired",
                extra={"token_prefix": token[:8]},
            )
            return None

        data = json.loads(raw)
        if not data.get("tenant_id"):
            logger.error("SSE session: missing tenant_id in payload")
            return None
        return data
    except Exception as exc:
        logger.error("SSE session validation error: %s", exc)
        return None


async def invalidate_sse_session(redis_client, token: str) -> None:
    if not token:
        return

    try:
        await redis_client.delete(f"{SSE_TOKEN_PREFIX}{token}")
        logger.info(
            "SSE session invalidated",
            extra={"token_prefix": token[:8]},
        )
    except Exception as exc:
        logger.warning("SSE session invalidation failed: %s", exc)
