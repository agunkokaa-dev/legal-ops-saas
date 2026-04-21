from __future__ import annotations

import json
import logging
import os
from typing import Any

import redis

logger = logging.getLogger("pariana.laws.cache")

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_redis_client = None


def _get_redis() -> redis.Redis | None:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        _redis_client.ping()
    except Exception as exc:
        logger.warning("Law cache unavailable: %s", exc)
        _redis_client = None
    return _redis_client


def get_redis_client() -> redis.Redis | None:
    return _get_redis()


def get_cache_key(prefix: str, *parts: Any) -> str:
    serialized = "::".join(str(part) for part in parts if part not in (None, ""))
    return f"laws:{prefix}:{serialized}" if serialized else f"laws:{prefix}"


def cache_get_json(key: str) -> Any | None:
    client = _get_redis()
    if not client:
        return None
    value = client.get(key)
    if not value:
        return None
    return json.loads(value)


def cache_set_json(key: str, value: Any, *, ttl_seconds: int = 300) -> None:
    client = _get_redis()
    if not client:
        return
    client.setex(key, ttl_seconds, json.dumps(value, default=str))


async def invalidate_law_caches(law_short: str | None = None, node_id: str | None = None) -> None:
    client = _get_redis()
    if not client:
        return
    patterns = [
        "laws:search:*",
        "laws:catalog*",
        "laws:coverage*",
        f"laws:pasal:{node_id}*" if node_id else "laws:pasal:*",
    ]
    if law_short:
        patterns.append(f"laws:citation:*{law_short}*")
    for pattern in patterns:
        cursor = 0
        while True:
            cursor, keys = client.scan(cursor=cursor, match=pattern, count=100)
            if keys:
                client.delete(*keys)
            if cursor == 0:
                break
