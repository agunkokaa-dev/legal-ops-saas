"""
Pariana Backend - FastAPI Dependencies
Reusable auth and database dependencies injected into all routers.
"""
import os
import jwt
import logging
from datetime import datetime, timezone
from fastapi import Header, HTTPException, Depends, Request
from supabase import create_client, Client
from app.config import CLERK_PEM_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

auth_logger = logging.getLogger("pariana.auth")
logging.basicConfig(level=logging.INFO)


async def verify_clerk_token(
    request: Request,
    authorization: str = Header(None),
) -> dict:
    """
    Validates the Clerk JWT from the Authorization header.
    Returns the decoded payload with `verified_tenant_id` injected.

    Tenant identity is derived exclusively from the cryptographically signed JWT claims:
      - `org_id` (Clerk Organization) takes precedence
      - `sub` (Clerk user ID) is used as fallback for solo users

    The header-based tenant override has been intentionally removed. Header-based
    tenant overrides allow any authenticated user to impersonate another tenant,
    bypassing JWT-level isolation entirely.
    """
    if not authorization or not authorization.startswith("Bearer "):
        auth_logger.warning(
            "AUTH_REJECT | reason=missing_or_malformed_header | ts=%s",
            datetime.now(timezone.utc).isoformat()
        )
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ")[1]
    # Log only a non-sensitive token prefix for correlation — never the full token
    token_prefix = token[:20] if len(token) >= 20 else "<short>"

    if not CLERK_PEM_KEY:
        # FAIL HARD - Do NOT decode with verify_signature=False
        auth_logger.critical("AUTH_CONFIG_ERROR | CLERK_PEM_KEY missing from environment | ts=%s",
            datetime.now(timezone.utc).isoformat())
        raise HTTPException(status_code=500, detail="Server authentication configuration error.")

    try:
        claims = jwt.decode(token, CLERK_PEM_KEY, algorithms=["RS256"])

        # Tenant identity comes exclusively from JWT claims — never from request headers.
        tenant_id = claims.get("org_id") or claims.get("sub")
        if not tenant_id:
            auth_logger.warning(
                "AUTH_REJECT | reason=no_tenant_identity | token_prefix=%s | ts=%s",
                token_prefix, datetime.now(timezone.utc).isoformat()
            )
            raise HTTPException(status_code=401, detail="No valid tenant identity found in token")

        claims["verified_tenant_id"] = tenant_id
        # NEW: Set tenant_id in request.state for rate limiter
        request.state.tenant_id = tenant_id
        return claims
    except jwt.ExpiredSignatureError:
        auth_logger.warning(
            "AUTH_REJECT | reason=token_expired | token_prefix=%s | ts=%s",
            token_prefix, datetime.now(timezone.utc).isoformat()
        )
        raise HTTPException(status_code=401, detail="Token has expired")
    except HTTPException:
        raise
    except Exception as e:
        auth_logger.warning(
            "AUTH_REJECT | reason=invalid_token | error=%s | token_prefix=%s | ts=%s",
            type(e).__name__, token_prefix, datetime.now(timezone.utc).isoformat()
        )
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


async def get_tenant_supabase() -> Client:
    """
    Since Pariana uses Clerk for authentication (RS256) instead of Supabase Auth (HS256),
    we bypass Supabase RLS token injection to prevent PGRST301 (wrong key type) errors.
    The backend already securely enforces tenant isolation via explicit .eq("tenant_id", tenant_id)
    and insert mappings in every router.
    """
    from app.config import admin_supabase
    return admin_supabase
