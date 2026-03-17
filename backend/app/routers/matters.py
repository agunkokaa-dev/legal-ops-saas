"""
Pariana Backend — Matters Router

Handles:
  - POST /api/matters  → Create a new matter
  - GET  /api/matters  → List matters for the current tenant

Demonstrates the clean dependency injection pattern for all simple CRUD routers.
"""
import uuid
from fastapi import APIRouter, HTTPException, Depends
from supabase import Client

from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import MatterCreate

router = APIRouter()


@router.post("/matters")
async def create_matter(
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
            "name": matter.name,
            "description": matter.description
        }).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        print(f"API Create Matter Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create matter.")


@router.get("/matters")
async def get_matters(
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]
        response = supabase.table("matters").select("*").eq("tenant_id", tenant_id).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        print(f"API Get Matters Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch matters.")
