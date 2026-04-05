"""
Pariana Backend — Playbook Router (Fully Refactored)

Handles:
  - POST /api/playbook/vectorize → Vectorize a playbook rule into Qdrant
"""
import asyncio
from fastapi import APIRouter, HTTPException, Depends, Request

from app.config import openai_client, qdrant, admin_supabase
from app.rate_limiter import limiter
from app.dependencies import verify_clerk_token
from app.schemas import PlaybookVectorizeRequest
from qdrant_client.http.models import PointStruct

router = APIRouter()


async def async_embed(text: str) -> list[float]:
    response = await asyncio.to_thread(openai_client.embeddings.create, input=text, model="text-embedding-3-small")
    return response.data[0].embedding


async def async_qdrant_upsert(collection: str, points: list):
    return await asyncio.to_thread(
        qdrant.upsert,
        collection_name=collection,
        points=points
    )


@router.post("/vectorize")
@limiter.limit("20/minute")
async def vectorize_playbook_rule(
    request: Request,
    body: PlaybookVectorizeRequest,
    claims: dict = Depends(verify_clerk_token)
):
    try:
        tenant_id = claims["verified_tenant_id"]
        
        # NON-BLOCKING Vector Generation
        vector = await async_embed(body.rule_text)
        
        # NON-BLOCKING Upsert
        await async_qdrant_upsert(
            collection="company_rules",
            points=[PointStruct(
                id=body.id, 
                vector=vector,
                payload={
                    "user_id": tenant_id, 
                    "category": body.category,
                    "standard_position": body.standard_position,
                    "fallback_position": body.fallback_position,
                    "redline": body.redline,
                    "risk_severity": body.risk_severity,
                    "rule_text": body.rule_text, 
                    "rule_id": str(body.id)
                }
            )]
        )
        
        return {"status": "success", "message": "Rule successfully vectorized and stored in Qdrant."}
    except Exception as e:
        print(f"Playbook Vectorization Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/categories")
@limiter.limit("60/minute")
async def get_playbook_categories(request: Request, claims: dict = Depends(verify_clerk_token)):
    print("🔥 [BACKEND] Endpoint /categories hit!")
    try:
        tenant_id = claims["verified_tenant_id"]

        # Fetch tenant-specific playbook categories (strict isolation)
        tenant_res = admin_supabase.table("company_playbooks").select("category").eq("tenant_id", tenant_id).execute()

        # Fetch global/system playbook categories (tenant_id IS NULL = shared system rules)
        global_res = admin_supabase.table("company_playbooks").select("category").is_("tenant_id", "null").execute()

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
