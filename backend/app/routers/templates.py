"""
Pariana Backend — SOP Templates Router (Fully Refactored)

Handles:
  - POST /api/v1/templates         → Create a new SOP template
"""
import traceback
from fastapi import APIRouter, HTTPException, Depends, Request
from supabase import Client

from app.rate_limiter import limiter
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import TemplateCreateRequest

router = APIRouter()


@router.get("/templates")
@limiter.limit("60/minute")
async def list_templates(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        result = (
            supabase.table("task_templates")
            .select("*, task_template_items(count)")
            .eq("tenant_id", tenant_id)
            .order("created_at", desc=True)
            .execute()
        )
        return {"templates": result.data or []}
    except Exception as e:
        print(f"API List Templates Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates")
@limiter.limit("20/minute")
async def create_template(
    request: Request,
    body: TemplateCreateRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]

        header_payload = {
            "tenant_id": tenant_id,
            "name": body.name,
            "matter_type": body.matter_type
        }
        
        header_res = supabase.table("task_templates").insert({**header_payload, "tenant_id": tenant_id}).execute()
        
        if not header_res.data:
            raise HTTPException(status_code=500, detail="Failed to create template header")
            
        template_id = header_res.data[0]["id"]
        
        if body.items:
            items_payload = []
            for item in body.items:
                items_payload.append({
                    "tenant_id": tenant_id,
                    "template_id": template_id,
                    "title": item.title,
                    "description": item.description,
                    "days_offset": item.days_offset,
                    "position": item.position,
                    "procedural_steps": item.procedural_steps
                })
                
            items_res = supabase.table("task_template_items").insert([{**it, "tenant_id": tenant_id} for it in items_payload]).execute()
            
            if not items_res.data:
                 print("Warning: Template created but items failed to insert natively.")
        
        return {
            "status": "success", 
            "message": "Template created successfully", 
            "template_id": template_id
        }

    except Exception as e:
        print(f"API Create Template Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/templates/{template_id}")
@limiter.limit("60/minute")
async def delete_template(
    request: Request,
    template_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        supabase.table("task_templates").delete().eq("id", template_id).eq("tenant_id", tenant_id).execute()
        return {"deleted": True}
    except Exception as e:
        print(f"API Delete Template Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
