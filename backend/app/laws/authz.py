from __future__ import annotations

import hashlib
import logging
from typing import Any

from fastapi import Depends, HTTPException

from app.dependencies import verify_clerk_token

ROLE_NAMESPACE = "https://clause.id/roles"
ALLOWED_LAWS_ADMIN_ROLES = {"laws_admin", "platform_admin"}

logger = logging.getLogger("pariana.laws.authz")


def _hash_text(value: str | None) -> str:
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()


def extract_namespaced_roles(claims: dict[str, Any]) -> set[str]:
    raw_roles = claims.get(ROLE_NAMESPACE)
    if raw_roles is None:
        raise HTTPException(status_code=403, detail="Admin role claim is missing")
    if not isinstance(raw_roles, list) or any(not isinstance(item, str) for item in raw_roles):
        raise HTTPException(status_code=403, detail="Admin role claim is malformed")

    normalized = {item.strip() for item in raw_roles if item and item.strip()}
    if not normalized:
        raise HTTPException(status_code=403, detail="Admin role claim is empty")
    return normalized


async def require_laws_admin(claims: dict = Depends(verify_clerk_token)) -> dict:
    try:
        roles = extract_namespaced_roles(claims)
    except HTTPException:
        logger.warning(
            "LAWS_ADMIN_DENY roles_claim_invalid user_hash=%s tenant_hash=%s legacy_role=%s",
            _hash_text(str(claims.get("sub"))),
            _hash_text(str(claims.get("verified_tenant_id"))),
            claims.get("role"),
        )
        raise

    if roles.intersection(ALLOWED_LAWS_ADMIN_ROLES):
        return claims

    logger.warning(
        "LAWS_ADMIN_DENY role_missing user_hash=%s tenant_hash=%s roles=%s legacy_role=%s",
        _hash_text(str(claims.get("sub"))),
        _hash_text(str(claims.get("verified_tenant_id"))),
        sorted(roles),
        claims.get("role"),
    )
    raise HTTPException(status_code=403, detail="Admin role is required")

