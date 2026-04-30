"""
Pariana Backend - Clause Library Router
Enterprise Clause Library CRUD with Qdrant vectorization.
Enforces strict tenant isolation via verify_clerk_token + manual .eq() scoping.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import List
import uuid
import time
from supabase import Client

from app.ai_usage import log_openai_response_sync
from app.schemas import ClauseCreate, ClauseResponse, ClauseMatchRequest, ClauseMatchResult
from app.rate_limiter import limiter
from app.dependencies import TenantQdrantClient, get_tenant_qdrant, get_tenant_supabase, verify_clerk_token
from app.config import admin_supabase, openai_client
from qdrant_client.http.models import PointStruct, Filter, FieldCondition, MatchValue

router = APIRouter()


@router.get("/clauses", response_model=List[ClauseResponse])
@limiter.limit("60/minute")
async def get_clauses(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """Fetch all clauses for the authenticated tenant."""
    tenant_id = claims["verified_tenant_id"]

    try:
        result = supabase.table("clause_library") \
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
@limiter.limit("20/minute")
async def create_clause(
    request: Request,
    clause: ClauseCreate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
):
    """Create a new clause, save to Supabase, and vectorize into Qdrant."""
    tenant_id = claims["verified_tenant_id"]

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

        result = supabase.table("clause_library") \
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
        started_at = time.perf_counter()
        embedding_response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=clause.content
        )
        log_openai_response_sync(
            admin_supabase,
            tenant_id,
            "clause_library_embedding",
            "text-embedding-3-small",
            embedding_response,
            int((time.perf_counter() - started_at) * 1000),
            metadata={"clause_id": new_clause_id},
        )
        embedding_vector = embedding_response.data[0].embedding
    except Exception as e:
        print(f"[ClauseLibrary] OpenAI embedding error: {e}")
        # Clause is saved but vectorization failed — log and continue
        return new_clause

    # 3. Upsert into Qdrant
    try:
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, new_clause_id))

        qdrant_client.upsert(
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
                        "title": clause.title,
                        "content": clause.content,
                        "guidance_notes": clause.guidance_notes
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
@limiter.limit("30/minute")
async def match_clause(
    request: Request,
    body: ClauseMatchRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
):
    """Semantic search: find the best-matching approved clauses for a given vendor text block."""
    tenant_id = claims["verified_tenant_id"]

    try:
        # 1. Embed the incoming risky vendor clause
        started_at = time.perf_counter()
        embedding_response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=body.query_text
        )
        log_openai_response_sync(
            admin_supabase,
            tenant_id,
            "clause_match_embedding",
            "text-embedding-3-small",
            embedding_response,
            int((time.perf_counter() - started_at) * 1000),
        )
        query_vector = embedding_response.data[0].embedding

        # 2. Build Qdrant filter (strict tenant isolation + optional category)
        must_conditions = []
        if body.category:
            must_conditions.append(
                FieldCondition(key="category", match=MatchValue(value=body.category))
            )
        query_filter = Filter(must=must_conditions)

        # 3. Search Qdrant 'clause_library_vectors'
        search_results = qdrant_client.search(
            collection_name="clause_library_vectors",
            query_vector=query_vector,
            query_filter=query_filter,
            limit=body.limit,
            score_threshold=0.5
        )

        if not search_results:
            return {"matches": []}

        # 4. Hydrate from Supabase for full clause data
        clause_ids = [hit.payload.get("clause_id") for hit in search_results if hit.payload.get("clause_id")]
        scores_map = {hit.payload.get("clause_id"): round(hit.score, 4) for hit in search_results}

        if not clause_ids:
            return {"matches": []}

        hydrated = supabase.table("clause_library") \
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


# =====================================================================
# [TEMPORARY] POST /repair-vectors — Re-vectorize all clauses
# DELETE THIS ENDPOINT after use.
# =====================================================================
@router.post("/clauses/repair-vectors")
@limiter.limit("1/hour")
async def repair_clause_vectors(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
):
    """
    Temporary maintenance endpoint: re-embeds ALL clauses for the
    authenticated tenant and upserts corrected payloads (with content)
    into Qdrant. Runs inside the live Uvicorn process so env vars are
    already loaded.
    """
    tenant_id = claims["verified_tenant_id"]
    print(f"🔧 [RepairVectors] Starting repair for tenant: {tenant_id}")

    try:
        # 1. Fetch all clauses for this tenant
        res = supabase.table("clause_library") \
            .select("*") \
            .eq("tenant_id", tenant_id) \
            .execute()

        clauses = res.data or []
        if not clauses:
            return {"status": "warning", "message": "No clauses found for this tenant.", "repaired": 0}

        print(f"🔧 [RepairVectors] Found {len(clauses)} clauses. Re-vectorizing...")

        repaired = 0
        errors = []

        for clause in clauses:
            try:
                clause_id = clause["id"]
                title = clause.get("title", "")
                content = clause.get("content", "")
                guidance = clause.get("guidance_notes", "")

                # 2. Re-embed
                embed_text = f"{title}\n{content}\n{guidance}"
                started_at = time.perf_counter()
                embedding_response = openai_client.embeddings.create(
                    model="text-embedding-3-small",
                    input=embed_text
                )
                log_openai_response_sync(
                    admin_supabase,
                    tenant_id,
                    "clause_repair_embedding",
                    "text-embedding-3-small",
                    embedding_response,
                    int((time.perf_counter() - started_at) * 1000),
                    metadata={"clause_id": clause_id},
                )
                vector = embedding_response.data[0].embedding

                # 3. Upsert with FULL payload (the fix)
                point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, clause_id))
                qdrant_client.upsert(
                    collection_name="clause_library_vectors",
                    points=[
                        PointStruct(
                            id=point_id,
                            vector=vector,
                            payload={
                                "tenant_id": tenant_id,
                                "clause_id": clause_id,
                                "category": clause.get("category"),
                                "clause_type": clause.get("clause_type"),
                                "title": title,
                                "content": content,
                                "guidance_notes": guidance
                            }
                        )
                    ]
                )
                repaired += 1
                print(f"   ✅ Repaired: {title} ({clause_id})")

            except Exception as clause_err:
                errors.append({"clause_id": clause.get("id"), "error": str(clause_err)})
                print(f"   ❌ Failed: {clause.get('title')} — {clause_err}")

        print(f"🔧 [RepairVectors] Done. Repaired: {repaired}, Errors: {len(errors)}")
        return {
            "status": "success",
            "repaired": repaired,
            "errors": errors,
            "message": f"Re-vectorized {repaired}/{len(clauses)} clauses."
        }

    except Exception as e:
        print(f"🔥 [RepairVectors] Fatal Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
