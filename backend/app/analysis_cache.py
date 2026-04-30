from __future__ import annotations

import hashlib
import json
import os
from typing import Any

import redis
import redis.asyncio as aioredis

CACHE_TTL_SECONDS = 60 * 60 * 24 * 7

_async_redis: aioredis.Redis | None = None
_sync_redis: redis.Redis | None = None


def _redis_url() -> str:
    return (
        os.getenv("ANALYSIS_CACHE_REDIS_URL")
        or os.getenv("REDIS_URL")
        or "redis://redis:6379/0"
    )


async def get_redis() -> aioredis.Redis:
    global _async_redis
    if _async_redis is None:
        _async_redis = aioredis.from_url(_redis_url(), decode_responses=True)
    return _async_redis


def get_redis_sync() -> redis.Redis:
    global _sync_redis
    if _sync_redis is None:
        _sync_redis = redis.Redis.from_url(_redis_url(), decode_responses=True)
    return _sync_redis


def build_cache_key(
    tenant_id: str,
    workflow: str,
    document_text: str,
    *,
    prompt_version: str = "v1",
    schema_version: str = "v1",
    model_family: str = "gpt-4o-mini",
    playbook_version: str = "v1",
    law_corpus_version: str = "v1",
) -> str:
    if not tenant_id:
        raise ValueError("tenant_id is required for analysis cache keys")

    doc_hash = hashlib.sha256(document_text.encode("utf-8")).hexdigest()[:16]
    parts = [
        "analysis_cache",
        f"tenant:{tenant_id}",
        f"workflow:{workflow}",
        f"doc:{doc_hash}",
        f"pv:{prompt_version}",
        f"sv:{schema_version}",
        f"mf:{model_family}",
        f"pb:{playbook_version}",
        f"lc:{law_corpus_version}",
    ]
    return ":".join(parts)


async def get_cached_analysis(cache_key: str) -> dict[str, Any] | None:
    try:
        client = await get_redis()
        cached = await client.get(cache_key)
        if cached:
            value = json.loads(cached)
            return value if isinstance(value, dict) else None
    except Exception:
        return None
    return None


async def set_cached_analysis(cache_key: str, result: dict[str, Any]) -> None:
    try:
        client = await get_redis()
        await client.set(cache_key, json.dumps(result), ex=CACHE_TTL_SECONDS)
    except Exception:
        return


def get_cached_analysis_sync(cache_key: str) -> dict[str, Any] | None:
    try:
        cached = get_redis_sync().get(cache_key)
        if cached:
            value = json.loads(cached)
            return value if isinstance(value, dict) else None
    except Exception:
        return None
    return None


def set_cached_analysis_sync(cache_key: str, result: dict[str, Any]) -> None:
    try:
        get_redis_sync().set(cache_key, json.dumps(result), ex=CACHE_TTL_SECONDS)
    except Exception:
        return
