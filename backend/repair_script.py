from dotenv import load_dotenv; load_dotenv("/app/.env")
"""
Qdrant Payload Diagnostic & Repair Script
Run this script to re-vectorize your existing Supabase clauses into Qdrant,
ensuring the 'content', 'title', and 'guidance_notes' payloads are populated.

Usage:
  python repair_qdrant_payloads.py
"""

import asyncio
import os
from dotenv import load_dotenv

# Load environment to mimic main app
load_dotenv()

from app.config import admin_supabase, qdrant, openai_client
from qdrant_client.http.models import PointStruct

async def async_embed(text: str) -> list[float]:
    response = await asyncio.to_thread(
        openai_client.embeddings.create,
        input=text,
        model="text-embedding-3-small"
    )
    return response.data[0].embedding

async def repair_clauses():
    print("🔍 Fetching clauses from Supabase...")
    # Fetch all clauses using the service role bypass
    res = admin_supabase.table("contract_clauses").select("*").execute()
    clauses = res.data

    if not clauses:
        print("⚠️ No clauses found in Supabase.")
        return

    print(f"📦 Found {len(clauses)} clauses. Re-vectorizing...")

    points = []
    for clause in clauses:
        print(f"   -> Vectorizing: {clause.get('title', 'Unknown')}")
        
        # Re-generate vector embedding
        embed_text = f"{clause.get('title', clause.get('name', 'Unknown Title'))}\n{clause.get('content', clause.get('text', ''))}\n{clause.get('guidance_notes', '')}"
        vector = await async_embed(embed_text)
        
        # Build the CORRECTED payload containing 'content'
        payload = {
            "tenant_id": clause["tenant_id"],
            "clause_id": clause["id"],
            "title": clause.get('title', clause.get('name', 'Unknown Title')),
            "content": clause.get('content', clause.get('text', '')),  # FIXED: The missing field
            "guidance_notes": clause.get("guidance_notes")
        }

        points.append(
            PointStruct(
                id=clause["id"],
                vector=vector,
                payload=payload
            )
        )

    # Upsert the fixed points back into Qdrant
    print("🚀 Upserting fixed points to Qdrant 'clause_library_vectors'...")
    qdrant.upsert(
        collection_name="clause_library_vectors",
        points=points
    )
    
    print("✅ Repair complete. Qdrant payloads are now fully populated!")

if __name__ == "__main__":
    asyncio.run(repair_clauses())
