"""
Pariana Backend — SOP Templates Router (Fully Refactored)

Handles:
  - POST /api/v1/templates         → Create a new SOP template
"""
import traceback
from fastapi import APIRouter, HTTPException, Depends
from supabase import Client

from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import TemplateCreateRequest

router = APIRouter()


@router.post("/templates")
async def create_template(
    request: TemplateCreateRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]

        header_payload = {
            "tenant_id": tenant_id,
            "name": request.name,
            "matter_type": request.matter_type
        }
        
        header_res = supabase.table("task_templates").insert(header_payload).execute()
        
        if not header_res.data:
            raise HTTPException(status_code=500, detail="Failed to create template header")
            
        template_id = header_res.data[0]["id"]
        
        if request.items:
            items_payload = []
            for item in request.items:
                items_payload.append({
                    "template_id": template_id,
                    "title": item.title,
                    "description": item.description,
                    "days_offset": item.days_offset,
                    "position": item.position,
                    "procedural_steps": item.procedural_steps
                })
                
            items_res = supabase.table("task_template_items").insert(items_payload).execute()
            
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
