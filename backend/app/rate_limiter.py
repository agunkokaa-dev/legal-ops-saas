# backend/app/rate_limiter.py

import os
import logging
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# --- Tenant-aware key function ---
def get_rate_limit_key(request: Request) -> str:
    """
    Rate limit by tenant_id (extracted from JWT), not by IP.
    
    Why tenant_id instead of IP?
    - Multiple users in the same organization share a tenant_id
    - This prevents org-level abuse (one org flooding the system)
    - IP-based limiting would break for users behind corporate proxies/VPNs
    
    Fallback to IP if tenant_id is not available (e.g., unauthenticated endpoints).
    """
    # The tenant_id is set in request.state by the verify_clerk_token dependency
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id:
        return f"tenant:{tenant_id}"
    return get_remote_address(request)


# --- Redis configuration ---
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Use Redis as the storage backend for rate limiting.
# IMPORTANT: We eagerly probe the connection at startup.
# slowapi's Limiter constructor uses lazy connections — it will SUCCEED even
# when Redis is down, then throw ConnectionError at runtime on every endpoint,
# causing widespread 500 errors. The ping below catches that at init time.
_use_redis = False
try:
    import redis as _redis_lib
    _r = _redis_lib.from_url(REDIS_URL, socket_connect_timeout=2)
    _r.ping()
    _use_redis = True
    logger.info(f"Redis is reachable at {REDIS_URL} — using Redis-backed rate limiting.")
except Exception as e:
    logger.warning(
        f"Redis unavailable ({e}). Falling back to in-memory rate limiting. "
        "THIS IS NOT SAFE FOR PRODUCTION — rate limits will not survive restarts."
    )

limiter = Limiter(
    key_func=get_rate_limit_key,
    storage_uri=REDIS_URL if _use_redis else "memory://",
    strategy="fixed-window",
)


# --- Custom rate limit exceeded handler ---
def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """
    Return a clean JSON error when rate limit is exceeded.
    Include Retry-After header so frontend knows when to retry.
    """
    # Extract the limit detail for the error message
    limit_detail = str(exc.detail) if hasattr(exc, "detail") else "Rate limit exceeded"
    
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "message": f"Terlalu banyak permintaan. Silakan tunggu sebelum mencoba lagi. ({limit_detail})",
            "message_en": f"Too many requests. Please wait before trying again. ({limit_detail})",
            "retry_after": 60,  # Default suggestion
        },
        headers={
            "Retry-After": "60",
            "X-RateLimit-Limit": limit_detail,
        }
    )
