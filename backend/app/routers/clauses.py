"""
Pariana Backend - Clause Library Router
Enterprise Clause Library CRUD with Qdrant vectorization.
Enforces strict tenant isolation via verify_clerk_token + manual .eq() scoping.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
import uuid

from app.schemas import ClauseCreate, ClauseResponse, ClauseMatchRequest, ClauseMatchResult
from app.dependencies import verify_clerk_token
from app.config import admin_supabase, qdrant, openai_client
from qdrant_client.http.models import PointStruct, Filter, FieldCondition, MatchValue

router = APIRouter()


@router.get("/clauses", response_model=List[ClauseResponse])
async def get_clauses(claims: dict = Depends(verify_clerk_token)):
    """Fetch all clauses for the authenticated tenant."""
    tenant_id = claims.get("org_id") or claims.get("sub")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Unable to resolve tenant identity.")

    try:
        result = admin_supabase.table("clause_library") \
            .select("*") \
            .eq("tenant_id", tenant_id) \
            .order("category") \
            .order("created_at", desc=True) \
            .execute()

        return result.data or []
    except Exception as e:
        print(f"[ClauseLibrary] GET error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clauses", response_model=ClauseResponse)
async def create_clause(clause: ClauseCreate, claims: dict = Depends(verify_clerk_token)):
    """Create a new clause, save to Supabase, and vectorize into Qdrant."""
    tenant_id = claims.get("org_id") or claims.get("sub")
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Unable to resolve tenant identity.")

    # 1. Insert into Supabase
    try:
        insert_payload = {
            "tenant_id": tenant_id,
            "category": clause.category,
            "clause_type": clause.clause_type,
            "title": clause.title,
            "content": clause.content,
            "guidance_notes": clause.guidance_notes,
        }

        result = admin_supabase.table("clause_library") \
            .insert(insert_payload) \
            .execute()

        if not result.data or len(result.data) == 0:
            raise HTTPException(status_code=500, detail="Supabase insert returned no data.")

        new_clause = result.data[0]
        new_clause_id = new_clause["id"]

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ClauseLibrary] Supabase INSERT error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    # 2. Generate embedding via OpenAI
    try:
        embedding_response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=clause.content
        )
        embedding_vector = embedding_response.data[0].embedding
    except Exception as e:
        print(f"[ClauseLibrary] OpenAI embedding error: {e}")
        # Clause is saved but vectorization failed — log and continue
        return new_clause

    # 3. Upsert into Qdrant
    try:
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, new_clause_id))

        qdrant.upsert(
            collection_name="clause_library_vectors",
            points=[
                PointStruct(
                    id=point_id,
                    vector=embedding_vector,
                    payload={
                        "tenant_id": tenant_id,
                        "clause_id": new_clause_id,
                        "category": clause.category,
                        "clause_type": clause.clause_type,
                    }
                )
            ]
        )
        print(f"[ClauseLibrary] Vectorized clause {new_clause_id} -> Qdrant point {point_id}")
    except Exception as e:
        print(f"[ClauseLibrary] Qdrant upsert error: {e}")
        # Clause is saved but vectorization failed — log and continue

    return new_clause


@router.post("/clauses/match")
async def match_clause(request: ClauseMatchRequest, claims: dict = Depends(verify_clerk_token)):
    """Semantic search: find the best-matching approved clauses for a given vendor text block."""
    tenant_id = claims.get("org_id") or claims.get("sub")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Unable to resolve tenant identity.")

    try:
        # 1. Embed the incoming risky vendor clause
        embedding_response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=request.query_text
        )
        query_vector = embedding_response.data[0].embedding

        # 2. Build Qdrant filter (strict tenant isolation + optional category)
        must_conditions = [
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))
        ]
        if request.category:
            must_conditions.append(
                FieldCondition(key="category", match=MatchValue(value=request.category))
            )
        query_filter = Filter(must=must_conditions)

        # 3. Search Qdrant 'clause_library_vectors'
        search_results = qdrant.search(
            collection_name="clause_library_vectors",
            query_vector=query_vector,
            query_filter=query_filter,
            limit=request.limit,
            score_threshold=0.5
        )

        if not search_results:
            return {"matches": []}

        # 4. Hydrate from Supabase for full clause data
        clause_ids = [hit.payload.get("clause_id") for hit in search_results if hit.payload.get("clause_id")]
        scores_map = {hit.payload.get("clause_id"): round(hit.score, 4) for hit in search_results}

        if not clause_ids:
            return {"matches": []}

        hydrated = admin_supabase.table("clause_library") \
            .select("id, category, clause_type, title, content, guidance_notes") \
            .in_("id", clause_ids) \
            .eq("tenant_id", tenant_id) \
            .execute()

        matches = []
        for row in (hydrated.data or []):
            matches.append({
                "id": row["id"],
                "category": row["category"],
                "clause_type": row["clause_type"],
                "title": row["title"],
                "content": row["content"],
                "guidance_notes": row.get("guidance_notes"),
                "similarity_score": scores_map.get(row["id"], 0.0)
            })

        # Sort by similarity score descending
        matches.sort(key=lambda x: x["similarity_score"], reverse=True)

        print(f"[ClauseLibrary] Matched {len(matches)} clauses for tenant {tenant_id}")
        return {"matches": matches}

    except Exception as e:
        print(f"🔥 [ClauseLibrary] Semantic Match Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to run semantic match: {str(e)}")

