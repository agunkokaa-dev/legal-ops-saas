"""
Pariana Backend — Playbook Router (Fully Refactored)

Handles:
  - POST /api/playbook/vectorize → Vectorize a playbook rule into Qdrant
"""
import asyncio
from fastapi import APIRouter, HTTPException, Depends

from app.config import openai_client, qdrant
from app.schemas import PlaybookRuleRequest
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


@router.post("/playbook/vectorize")
async def vectorize_playbook_rule(request: PlaybookRuleRequest):
    try:
        # NON-BLOCKING Vector Generation
        vector = await async_embed(request.rule_text)
        
        # NON-BLOCKING Upsert
        await async_qdrant_upsert(
            collection="company_rules",
            points=[PointStruct(
                id=request.rule_id, 
                vector=vector,
                payload={
                    "user_id": request.user_id, 
                    "rule_text": request.rule_text, 
                    "rule_id": request.rule_id
                }
            )]
        )
        
        return {"status": "success", "message": "Rule successfully vectorized and stored in Qdrant."}
    except Exception as e:
        print(f"Playbook Vectorization Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
