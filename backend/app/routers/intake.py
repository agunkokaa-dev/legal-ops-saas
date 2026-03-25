"""
Pariana Backend — Intake Portal Router (Isolated)

Handles:
  - POST /api/v1/intake/request  → Submit a new legal request from the Intake Portal

This router is completely isolated from existing matters/tasks endpoints.
It creates a matter + an initial task in a single transaction-like flow.
"""
import uuid
from fastapi import APIRouter, HTTPException, Depends
from supabase import Client

from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import IntakeRequestCreate

router = APIRouter()

URGENCY_TO_PRIORITY = {
    "high": "high",
    "urgent": "high",
    "standard": "medium",
    "low": "low",
}


@router.post("/intake/request")
async def submit_intake_request(
    payload: IntakeRequestCreate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Intake Portal endpoint for business users.
    Creates a new Matter and an initial backlog Task in one call.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        matter_id = str(uuid.uuid4())

        # --- Step 1: Insert into `matters` ---
        try:
            matter_title = f"{payload.request_type} - {payload.counterparty}"
            matter_res = supabase.table("matters").insert({
                "id": matter_id,
                "tenant_id": tenant_id,
                "name": matter_title,
                "description": payload.business_context,
                "status": "Active",
            }).execute()

            if not matter_res.data:
                raise HTTPException(status_code=500, detail="Failed to create matter from intake request.")
        except Exception as e:
            print(f"🚨 SUPABASE INSERT ERROR (matters table): {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

        # --- Step 2: Insert into `tasks` linked to the new matter ---
        try:
            task_title = f"Legal Request: {payload.request_type} - {payload.counterparty}"
            priority = URGENCY_TO_PRIORITY.get(payload.urgency.lower(), "medium")

            task_res = supabase.table("tasks").insert({
                "tenant_id": tenant_id,
                "matter_id": matter_id,
                "title": task_title,
                "status": "backlog",
                "priority": priority,
            }).execute()

            if not task_res.data:
                raise HTTPException(status_code=500, detail="Matter created but failed to create initial task.")
        except Exception as e:
            print(f"🚨 SUPABASE INSERT ERROR (tasks table): {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

        return {
            "status": "success",
            "message": f"Intake request received. Matter '{matter_title}' created with an initial task.",
            "matter_id": matter_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Intake Portal Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/intake/requests")
async def get_recent_intake_requests(
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Fetch the 5 most recent intake requests and their status.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        res = supabase.table("matters").select("id, title, created_at, tasks(status)").eq("tenant_id", tenant_id).order("created_at", desc=True).limit(5).execute()
        return res.data
    except Exception as e:
        print(f"❌ Fetch Intake Requests Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
