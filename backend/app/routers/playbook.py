"""
Pariana Backend — Playbook Router (Fully Refactored)

Handles:
  - POST /api/playbook/vectorize → Vectorize a playbook rule into Qdrant
"""
import asyncio
from fastapi import APIRouter, HTTPException, Depends

from app.config import openai_client, qdrant, admin_supabase
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
async def vectorize_playbook_rule(
    request: PlaybookVectorizeRequest,
    claims: dict = Depends(verify_clerk_token)
):
    try:
        tenant_id = claims["verified_tenant_id"]
        
        # NON-BLOCKING Vector Generation
        vector = await async_embed(request.rule_text)
        
        # NON-BLOCKING Upsert
        await async_qdrant_upsert(
            collection="company_rules",
            points=[PointStruct(
                id=request.id, 
                vector=vector,
                payload={
                    "user_id": tenant_id, 
                    "category": request.category,
                    "standard_position": request.standard_position,
                    "fallback_position": request.fallback_position,
                    "redline": request.redline,
                    "risk_severity": request.risk_severity,
                    "rule_text": request.rule_text, 
                    "rule_id": str(request.id)
                }
            )]
        )
        
        return {"status": "success", "message": "Rule successfully vectorized and stored in Qdrant."}
    except Exception as e:
        print(f"Playbook Vectorization Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/categories")
async def get_playbook_categories(claims: dict = Depends(verify_clerk_token)):
    print("🔥 [BACKEND] Endpoint /categories hit!")
    try:
        tenant_id = claims["verified_tenant_id"]
        res = admin_supabase.table("company_playbooks").select("category").or_(f"tenant_id.eq.{tenant_id},tenant_id.is.null").execute()
        print(f"🔥 [BACKEND] Supabase response: {res.data}")
        
        if not res.data:
            return {"categories": []}
            
        categories = list(set(item["category"] for item in res.data if item.get("category")))
        return {"categories": sorted(categories)}
    except Exception as e:
        print(f"🚨 [BACKEND] CRITICAL ERROR: {str(e)}")
        # Must return an HTTP exception so the frontend doesn't hang
        raise HTTPException(status_code=500, detail=str(e))
