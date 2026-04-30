"""
Pariana Backend — Playbook Router (Fully Refactored)

Handles:
  - POST /api/playbook/vectorize → Vectorize a playbook rule into Qdrant
"""
import asyncio
import time
from fastapi import APIRouter, HTTPException, Depends, Request
from supabase import Client

from app.ai_usage import log_openai_response_sync
from app.config import admin_supabase, openai_client
from app.rate_limiter import limiter
from app.dependencies import TenantQdrantClient, get_tenant_qdrant, get_tenant_supabase, verify_clerk_token
from app.schemas import PlaybookRuleCreateRequest, PlaybookVectorizeRequest
from qdrant_client.http.models import PointStruct

router = APIRouter()


async def async_embed(text: str, *, tenant_id: str | None = None, rule_id: str | None = None) -> list[float]:
    started_at = time.perf_counter()
    response = await asyncio.to_thread(openai_client.embeddings.create, input=text, model="text-embedding-3-small")
    log_openai_response_sync(
        admin_supabase,
        tenant_id,
        "playbook_embedding",
        "text-embedding-3-small",
        response,
        int((time.perf_counter() - started_at) * 1000),
        metadata={"rule_id": rule_id} if rule_id else None,
    )
    return response.data[0].embedding


async def async_qdrant_upsert(qdrant_client: TenantQdrantClient, collection: str, points: list):
    return await asyncio.to_thread(
        qdrant_client.upsert,
        collection_name=collection,
        points=points
    )


async def _vectorize_rule(
    *,
    qdrant_client: TenantQdrantClient,
    tenant_id: str,
    rule_id: str,
    rule_text: str,
    category: str | None,
    standard_position: str | None,
    fallback_position: str | None,
    redline: str | None,
    risk_severity: str | None,
):
    vector = await async_embed(rule_text, tenant_id=tenant_id, rule_id=rule_id)
    await async_qdrant_upsert(
        qdrant_client=qdrant_client,
        collection="company_rules",
        points=[PointStruct(
            id=str(rule_id),
            vector=vector,
            payload={
                "tenant_id": tenant_id,
                "category": category,
                "standard_position": standard_position,
                "fallback_position": fallback_position,
                "redline": redline,
                "risk_severity": risk_severity,
                "rule_text": rule_text,
                "rule_id": str(rule_id),
            },
        )],
    )


@router.get("/rules")
@limiter.limit("60/minute")
async def list_playbook_rules(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]

        tenant_res = (
            supabase.table("company_playbooks")
            .select("*")
            .eq("tenant_id", tenant_id)
            .order("created_at", desc=True)
            .execute()
        )
        try:
            legacy_res = (
                supabase.table("company_playbooks")
                .select("*")
                .eq("user_id", tenant_id)
                .order("created_at", desc=True)
                .execute()
            )
            legacy_rows = legacy_res.data or []
        except Exception:
            legacy_rows = []

        seen_ids: set[str] = set()
        rules: list[dict] = []
        for rule in (tenant_res.data or []) + legacy_rows:
            rule_id = str(rule.get("id"))
            if rule_id in seen_ids:
                continue
            seen_ids.add(rule_id)
            rules.append(rule)

        return {"rules": rules}
    except Exception as e:
        print(f"Playbook Rules List Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rules")
@limiter.limit("60/minute")
async def create_playbook_rule(
    request: Request,
    body: PlaybookRuleCreateRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        rule_text = f"[{body.category}] {body.standard_position.strip()}"

        insert_payload = {
            "tenant_id": tenant_id,
            "category": body.category,
            "standard_position": body.standard_position.strip(),
            "fallback_position": body.fallback_position.strip() if body.fallback_position else None,
            "redline": body.redline.strip() if body.redline else None,
            "risk_severity": body.risk_severity,
            "rule_text": rule_text,
        }
        insert_payload["user_id"] = tenant_id

        try:
            result = (
                supabase.table("company_playbooks")
                .insert(insert_payload)
                .select()
                .single()
                .execute()
            )
        except Exception:
            insert_payload.pop("user_id", None)
            result = (
                supabase.table("company_playbooks")
                .insert(insert_payload)
                .select()
                .single()
                .execute()
            )
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create playbook rule")

        await _vectorize_rule(
            qdrant_client=qdrant_client,
            tenant_id=tenant_id,
            rule_id=str(result.data["id"]),
            rule_text=result.data["rule_text"],
            category=result.data.get("category"),
            standard_position=result.data.get("standard_position"),
            fallback_position=result.data.get("fallback_position"),
            redline=result.data.get("redline"),
            risk_severity=result.data.get("risk_severity"),
        )

        return {"rule": result.data}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Playbook Rule Create Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/vectorize")
@limiter.limit("10/minute")
async def vectorize_playbook_rule(
    request: Request,
    body: PlaybookVectorizeRequest,
    claims: dict = Depends(verify_clerk_token),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        await _vectorize_rule(
            qdrant_client=qdrant_client,
            tenant_id=tenant_id,
            rule_id=body.id,
            rule_text=body.rule_text,
            category=body.category,
            standard_position=body.standard_position,
            fallback_position=body.fallback_position,
            redline=body.redline,
            risk_severity=body.risk_severity,
        )
        return {"status": "success", "message": "Rule successfully vectorized and stored in Qdrant."}
    except Exception as e:
        print(f"Playbook Vectorization Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/categories")
@limiter.limit("60/minute")
async def get_playbook_categories(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    print("🔥 [BACKEND] Endpoint /categories hit!")
    try:
        tenant_id = claims["verified_tenant_id"]

        # Fetch tenant-specific playbook categories (strict isolation)
        tenant_res = supabase.table("company_playbooks").select("category").eq("tenant_id", tenant_id).execute()

        # Fetch global/system playbook categories (tenant_id IS NULL = shared system rules)
        global_res = supabase.table("company_playbooks").select("category").is_("tenant_id", "null").execute()

        all_rows = (tenant_res.data or []) + (global_res.data or [])
        print(f"🔥 [BACKEND] Supabase response: {all_rows}")

        if not all_rows:
            return {"categories": []}

        categories = list(set(item["category"] for item in all_rows if item.get("category")))
        return {"categories": sorted(categories)}
    except Exception as e:
        print(f"🚨 [BACKEND] CRITICAL ERROR: {str(e)}")
        # Must return an HTTP exception so the frontend doesn't hang
        raise HTTPException(status_code=500, detail=str(e))
