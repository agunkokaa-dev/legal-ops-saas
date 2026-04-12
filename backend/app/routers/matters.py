"""
Pariana Backend — Matters Router

Handles:
  - POST /api/v1/matters  → Create a new matter
  - GET  /api/v1/matters  → List matters for the current tenant
  - GET  /api/v1/matters/{matter_id}/contracts → List documents in a matter
  - GET  /api/v1/matters/{matter_id}/genealogy → Return matter contracts + relationships

Legacy /api/matters routes remain registered as backward-compatible aliases.

Demonstrates the clean dependency injection pattern for all simple CRUD routers.
"""
import uuid
import traceback
from fastapi import APIRouter, HTTPException, Depends, Request
from supabase import Client

from app.rate_limiter import limiter
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import MatterCreate

router = APIRouter()


@router.post("/matters")
@limiter.limit("20/minute")
async def create_matter(
    request: Request,
    matter: MatterCreate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]
        matter_id = str(uuid.uuid4())
        response = supabase.table("matters").insert({
            "id": matter_id,
            "tenant_id": tenant_id,
            "title": matter.name,
            "description": matter.description
        }).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        print(f"API Create Matter Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create matter.")


@router.get("/matters")
@limiter.limit("60/minute")
async def get_matters(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]
        print(f"🔥 DEBUG GET /api/matters - tenant_id from claims: '{tenant_id}'")
        response = supabase.table("matters").select("*").eq("tenant_id", tenant_id).execute()
        print(f"🔥 DEBUG GET /api/matters - Supabase returned {len(response.data)} rows")
        return {"status": "success", "data": response.data}
    except Exception as e:
        print(f"API Get Matters Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch matters.")


@router.get("/matters/{matter_id}/contracts")
@limiter.limit("60/minute")
async def get_matter_contracts(
    request: Request,
    matter_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]

        matter_res = supabase.table("matters") \
            .select("id") \
            .eq("id", matter_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()
        if not matter_res.data:
            raise HTTPException(status_code=404, detail="Matter not found")

        response = supabase.table("contracts") \
            .select("*") \
            .eq("matter_id", matter_id) \
            .eq("tenant_id", tenant_id) \
            .neq("status", "ARCHIVED") \
            .order("created_at", desc=True) \
            .execute()

        return {"data": response.data or []}
    except HTTPException:
        raise
    except Exception as e:
        print(f"API Get Matter Contracts Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch matter contracts.")


@router.get("/matters/{matter_id}/genealogy")
@limiter.limit("60/minute")
async def get_matter_genealogy(
    request: Request,
    matter_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]

        matter_res = supabase.table("matters") \
            .select("id") \
            .eq("id", matter_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()
        if not matter_res.data:
            raise HTTPException(status_code=404, detail="Matter not found")

        documents_res = supabase.table("contracts") \
            .select("id, title, document_category, contract_value, risk_level, created_at, status, matter_id") \
            .eq("matter_id", matter_id) \
            .eq("tenant_id", tenant_id) \
            .neq("status", "ARCHIVED") \
            .order("created_at", desc=False) \
            .execute()

        documents = documents_res.data or []
        doc_ids = {doc["id"] for doc in documents if doc.get("id")}

        relationships = []
        if doc_ids:
            rels_res = supabase.table("document_relationships") \
                .select("*") \
                .eq("tenant_id", tenant_id) \
                .execute()

            relationships = [
                rel for rel in (rels_res.data or [])
                if rel.get("parent_id") in doc_ids and rel.get("child_id") in doc_ids
            ]

        return {
            "documents": documents,
            "relationships": relationships,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"API Get Matter Genealogy Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch matter genealogy.")
