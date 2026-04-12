"""
Pariana Backend - FastAPI Dependencies
Reusable auth, database, and vector-store dependencies injected into routers.
"""
from __future__ import annotations

import jwt
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, Header, HTTPException, Request
from qdrant_client.http import models as qdrant_models
from qdrant_client.http.models import FieldCondition, Filter, MatchValue, PointStruct
from supabase import Client, create_client

try:
    from supabase.lib.client_options import ClientOptions
except Exception:  # pragma: no cover - version-specific import fallback
    ClientOptions = None  # type: ignore[assignment]

from app.config import (
    CLERK_PEM_KEY,
    SUPABASE_ANON_KEY,
    SUPABASE_URL,
    admin_supabase,
    qdrant,
)

auth_logger = logging.getLogger("pariana.auth")
logging.basicConfig(level=logging.INFO)


def _normalized_claim_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _extract_tenant_id(claims: dict[str, Any]) -> str | None:
    # Mirror the SQL RLS resolver exactly:
    # Clerk Production JWT structure places the org identifier in several
    # possible locations depending on the JWT template version:
    #   1. "tenant_id"  – custom claim injected by the Clerk JWT template
    #   2. "o" -> "id"  – nested organization object (Clerk v2 default)
    #   3. "org_id"     – legacy top-level claim (Clerk v1 / dev instances)
    #   4. "sub"        – personal workspace fallback (user_xxx)
    org_from_nested = None
    o_claim = claims.get("o")
    if isinstance(o_claim, dict):
        org_from_nested = _normalized_claim_text(o_claim.get("id"))

    return (
        _normalized_claim_text(claims.get("tenant_id"))
        or org_from_nested
        or _normalized_claim_text(claims.get("org_id"))
        or _normalized_claim_text(claims.get("sub"))
    )


class TenantQdrantClient:
    """
    Tenant-aware Qdrant facade.

    Every request-path search, scroll, delete, and upsert call is forced through a
    tenant payload filter. Upserts also normalize payloads so routers cannot forget
    to attach tenant_id.
    """

    def __init__(self, tenant_id: str, raw_client: Any):
        self.tenant_id = tenant_id
        self._raw = raw_client

    def _tenant_filter(self) -> Filter:
        return Filter(
            must=[FieldCondition(key="tenant_id", match=MatchValue(value=self.tenant_id))]
        )

    def _merge_filter(self, existing: Filter | None) -> Filter:
        if existing is None:
            return self._tenant_filter()

        must = list(existing.must or [])
        should = list(existing.should or []) if existing.should else None
        must_not = list(existing.must_not or []) if existing.must_not else None

        has_tenant = any(
            isinstance(condition, FieldCondition) and condition.key == "tenant_id"
            for condition in must
        )
        if not has_tenant:
            must.append(FieldCondition(key="tenant_id", match=MatchValue(value=self.tenant_id)))

        return Filter(must=must, should=should, must_not=must_not)

    def _normalize_points(self, points: list[Any]) -> list[Any]:
        normalized: list[Any] = []
        for point in points:
            if isinstance(point, PointStruct):
                payload = dict(point.payload or {})
                existing_tenant = payload.get("tenant_id")
                if existing_tenant and existing_tenant != self.tenant_id:
                    raise ValueError("Point payload tenant_id does not match authenticated tenant")
                payload["tenant_id"] = self.tenant_id
                normalized.append(
                    PointStruct(id=point.id, vector=point.vector, payload=payload)
                )
                continue

            if isinstance(point, dict):
                payload = dict(point.get("payload") or {})
                existing_tenant = payload.get("tenant_id")
                if existing_tenant and existing_tenant != self.tenant_id:
                    raise ValueError("Point payload tenant_id does not match authenticated tenant")
                payload["tenant_id"] = self.tenant_id
                cloned = dict(point)
                cloned["payload"] = payload
                normalized.append(cloned)
                continue

            payload = dict(getattr(point, "payload", {}) or {})
            existing_tenant = payload.get("tenant_id")
            if existing_tenant and existing_tenant != self.tenant_id:
                raise ValueError("Point payload tenant_id does not match authenticated tenant")
            payload["tenant_id"] = self.tenant_id
            setattr(point, "payload", payload)
            normalized.append(point)

        return normalized

    def query_points(self, *, collection_name: str, query: Any, query_filter: Filter | None = None, **kwargs):
        return self._raw.query_points(
            collection_name=collection_name,
            query=query,
            query_filter=self._merge_filter(query_filter),
            **kwargs,
        )

    def search(self, *, collection_name: str, query_vector: list[float], query_filter: Filter | None = None, **kwargs):
        return self._raw.search(
            collection_name=collection_name,
            query_vector=query_vector,
            query_filter=self._merge_filter(query_filter),
            **kwargs,
        )

    def scroll(self, *, collection_name: str, scroll_filter: Filter | None = None, **kwargs):
        return self._raw.scroll(
            collection_name=collection_name,
            scroll_filter=self._merge_filter(scroll_filter),
            **kwargs,
        )

    def upsert(self, *, collection_name: str, points: list[Any], **kwargs):
        return self._raw.upsert(
            collection_name=collection_name,
            points=self._normalize_points(points),
            **kwargs,
        )

    def delete(self, *, collection_name: str, points_selector: Any, **kwargs):
        selector = points_selector
        if isinstance(points_selector, Filter):
            selector = self._merge_filter(points_selector)
        elif hasattr(qdrant_models, "FilterSelector") and isinstance(points_selector, qdrant_models.FilterSelector):
            selector = qdrant_models.FilterSelector(filter=self._merge_filter(points_selector.filter))
        else:
            raise ValueError("TenantQdrantClient.delete only supports filter-based deletes")

        return self._raw.delete(
            collection_name=collection_name,
            points_selector=selector,
            **kwargs,
        )

    def __getattr__(self, item: str) -> Any:
        return getattr(self._raw, item)


async def verify_clerk_token(
    request: Request,
    authorization: str = Header(None),
) -> dict:
    """
    Validates the Clerk JWT from the Authorization header.
    Returns the decoded payload with `verified_tenant_id` injected.
    """
    if not authorization or not authorization.startswith("Bearer "):
        auth_logger.warning(
            "AUTH_REJECT | reason=missing_or_malformed_header | ts=%s",
            datetime.now(timezone.utc).isoformat(),
        )
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ", 1)[1]
    token_prefix = token[:20] if len(token) >= 20 else "<short>"

    if not CLERK_PEM_KEY:
        auth_logger.critical(
            "AUTH_CONFIG_ERROR | CLERK_PEM_KEY missing from environment | ts=%s",
            datetime.now(timezone.utc).isoformat(),
        )
        raise HTTPException(status_code=500, detail="Server authentication configuration error.")

    try:
        claims = jwt.decode(token, CLERK_PEM_KEY, algorithms=["RS256"])

        tenant_id = _extract_tenant_id(claims)
        if not tenant_id:
            auth_logger.warning(
                "AUTH_REJECT | reason=no_tenant_identity | token_prefix=%s | ts=%s",
                token_prefix,
                datetime.now(timezone.utc).isoformat(),
            )
            raise HTTPException(status_code=401, detail="No valid tenant identity found in token")

        claims["verified_tenant_id"] = tenant_id
        request.state.tenant_id = tenant_id
        request.state.clerk_jwt = token
        return claims
    except jwt.ExpiredSignatureError:
        auth_logger.warning(
            "AUTH_REJECT | reason=token_expired | token_prefix=%s | ts=%s",
            token_prefix,
            datetime.now(timezone.utc).isoformat(),
        )
        raise HTTPException(status_code=401, detail="Token has expired")
    except HTTPException:
        raise
    except Exception as e:
        auth_logger.warning(
            "AUTH_REJECT | reason=invalid_token | error=%s | token_prefix=%s | ts=%s",
            type(e).__name__,
            token_prefix,
            datetime.now(timezone.utc).isoformat(),
        )
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


def _bind_supabase_headers(client: Client, clerk_jwt: str) -> Client:
    bearer = f"Bearer {clerk_jwt}"

    postgrest = getattr(client, "postgrest", None)
    if postgrest is not None:
        auth_fn = getattr(postgrest, "auth", None)
        if callable(auth_fn):
            auth_fn(clerk_jwt)

    storage = getattr(client, "storage", None)
    if storage is not None:
        auth_fn = getattr(storage, "auth", None)
        if callable(auth_fn):
            auth_fn(clerk_jwt)

    realtime = getattr(client, "realtime", None)
    if realtime is not None and hasattr(realtime, "headers"):
        realtime.headers["Authorization"] = bearer
        realtime.headers["apikey"] = SUPABASE_ANON_KEY

    if hasattr(client, "options") and getattr(client.options, "headers", None) is not None:
        client.options.headers.update({
            "Authorization": bearer,
            "apikey": SUPABASE_ANON_KEY,
        })

    return client


def _create_rls_supabase_client(clerk_jwt: str) -> Client:
    bearer_headers = {
        "Authorization": f"Bearer {clerk_jwt}",
        "apikey": SUPABASE_ANON_KEY,
    }

    if ClientOptions is not None:
        try:
            return create_client(
                SUPABASE_URL,
                SUPABASE_ANON_KEY,
                options=ClientOptions(
                    auto_refresh_token=False,
                    persist_session=False,
                    headers=bearer_headers,
                ),
            )
        except TypeError:
            pass
        except Exception:
            pass

    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return _bind_supabase_headers(client, clerk_jwt)


async def get_tenant_supabase(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
) -> Client:
    """
    Standard request-path Supabase client.

    Uses the anon key and forwards the validated Clerk JWT so PostgREST and
    Postgres RLS enforce tenant isolation natively.
    """
    clerk_jwt = getattr(request.state, "clerk_jwt", None)
    if not clerk_jwt:
        raise HTTPException(status_code=401, detail="Missing authenticated request context")
    return _create_rls_supabase_client(clerk_jwt)


async def get_admin_supabase() -> Client:
    """
    Explicit privileged dependency for audited background/admin flows only.
    """
    return admin_supabase


async def get_tenant_qdrant(
    claims: dict = Depends(verify_clerk_token),
) -> TenantQdrantClient:
    return TenantQdrantClient(claims["verified_tenant_id"], qdrant)
