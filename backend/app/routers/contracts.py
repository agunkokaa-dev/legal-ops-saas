"""
Pariana Backend — Contracts Router (Fully Refactored)

Handles:
  - POST /api/upload              → Upload and process a PDF contract
  - POST /api/obligations/extract → AI extraction of obligations

All synchronous OpenAI and Qdrant calls are wrapped in `asyncio.to_thread()`
to prevent blocking the FastAPI event loop under concurrent load.
"""
import io
import asyncio
import functools
import uuid
import traceback
import json

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from supabase import Client
from qdrant_client.http.models import PointStruct, Filter, FieldCondition, MatchValue
from qdrant_client import models
from PyPDF2 import PdfReader
from dotenv import load_dotenv
import os

from app.config import openai_client, qdrant, COLLECTION_NAME, admin_supabase
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import ExtractObligationsRequest, ArchiveContractRequest, ConfirmVersionLinkRequest
from app.utils import chunk_text
from difflib import SequenceMatcher
from graph import clm_graph
import traceback

load_dotenv()

router = APIRouter()


# =====================================================================
# ASYNC WRAPPERS & CALLBACKS
# =====================================================================

def handle_task_result(task: asyncio.Task, contract_id: str, tenant_id: str = None):
    try:
        exc = task.exception()
        if exc:
            print(f"🚨 [BACKGROUND TASK FAILED] Contract {contract_id}: {exc}")
            # Update status to Failed so UI doesn't hang forever
            # NOTE: tenant_id is included here but may be None for truly orphaned tasks
            # (e.g., if background task itself crashed before tenant_id was captured).
            # The eq("id", ...) filter is safe here since this fires after our own task creation.
            q = admin_supabase.table("contracts").update({"status": "Failed"}).eq("id", contract_id)
            if tenant_id:
                q = q.eq("tenant_id", tenant_id)
            q.execute()
    except asyncio.CancelledError:
        print(f"⚠️ [BACKGROUND TASK CANCELLED] Contract {contract_id}")

async def async_embed(text: str) -> list[float]:
    response = await asyncio.to_thread(
        openai_client.embeddings.create,
        input=text,
        model="text-embedding-3-small"
    )
    return response.data[0].embedding


async def async_chat_completion(messages: list, response_format=None) -> any:
    kwargs = {"model": "gpt-4o-mini", "messages": messages}
    if response_format:
        kwargs["response_format"] = response_format
    response = await asyncio.to_thread(
        openai_client.chat.completions.create,
        **kwargs
    )
    return response


async def async_qdrant_scroll(collection: str, scroll_filter: Filter, limit: int):
    return await asyncio.to_thread(
        qdrant.scroll,
        collection_name=collection,
        scroll_filter=scroll_filter,
        limit=limit
    )


async def async_clm_graph_invoke(inputs: dict):
    if clm_graph is None:
        raise RuntimeError(
            "FATAL: LangGraph CLM pipeline failed to initialize at startup. "
            "Check graph.py for compilation errors."
        )
    return await asyncio.to_thread(clm_graph.invoke, inputs)


async def async_qdrant_upsert(collection: str, points: list):
    return await asyncio.to_thread(
        qdrant.upsert,
        collection_name=collection,
        points=points
    )


# =====================================================================
# ENDPOINTS
# =====================================================================

@router.get("/contracts")
async def list_contracts(
    tab: str = "Archived",
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    """
    GET /api/contracts?tab=Archived|active|Active Contracts|templates
    Returns contracts filtered by status category for the authenticated tenant.
    """
    tenant_id = claims["verified_tenant_id"]

    # Map tab names to status filters
    tab_lower = tab.lower().strip()
    if tab_lower in ("archived", "expired", "terminated"):
        status_filters = ["EXPIRED", "TERMINATED", "ARCHIVED", "Superseded"]
    elif tab_lower in ("active", "active contracts"):
        status_filters = ["ACTIVE", "DRAFT", "IN_REVIEW", "Active", "In Review"]
    elif tab_lower in ("templates", "templates & playbooks"):
        status_filters = ["TEMPLATE"]
    else:
        status_filters = []

    try:
        query = supabase.table("contracts").select("*").eq("tenant_id", tenant_id)

        if status_filters:
            query = query.in_("status", status_filters)
        else:
            # Default: exclude ARCHIVED (and other terminal statuses) from global queries
            query = query.neq("status", "ARCHIVED").neq("status", "EXPIRED").neq("status", "TERMINATED")

        query = query.order("created_at", desc=True)
        result = query.execute()

        return {"data": result.data or []}
    except Exception as e:
        print(f"[GET /contracts] Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

async def process_contract_background(
    contract_id: str,
    tenant_id: str,
    matter_id: str,
    filename: str,
    text_content: str
):
    print(f"🚀 [BACKGROUND] Starting LangGraph pipeline for contract_id={contract_id}")
    try:
        # 1. Before LangGraph is invoked
        print(f"🔄 [LANGGRAPH] Invoking agentic workflow for document ID: {contract_id}")
        
        # Invoke the Multi-Agent Workflow
        final_state = await async_clm_graph_invoke({
            "contract_id": contract_id,
            "raw_document": text_content[:150000] 
        })
        
        # 2. Raw JSON output from LLM extraction
        print(f"[LANGGRAPH] Execution complete for {contract_id}. Raw JSON output:")
        print(json.dumps({
            "risk_score": final_state.get("risk_score"),
            "contract_value": final_state.get("contract_value"),
            "end_date": final_state.get("end_date"),
            "currency": final_state.get("currency"),
            "effective_date": final_state.get("effective_date")
        }, default=str, indent=2))

        # Map the numerical risk_score to categorical classification
        score = final_state.get("risk_score", 0.0)
        risk_level = "High" if score >= 75.0 else ("Medium" if score >= 40.0 else "Low")

        # 3. Exactly payload being sent to Supabase
        update_payload = {
            "contract_value": float(final_state.get("contract_value", 0.0) or 0.0), # Safe float parsing
            "end_date": final_state.get("end_date", "Unknown"),
            "effective_date": final_state.get("effective_date", None),
            "jurisdiction": final_state.get("jurisdiction", None),
            "governing_law": final_state.get("governing_law", None),
            "risk_level": risk_level,
            "currency": final_state.get("currency", "IDR"),
            "counter_proposal": final_state.get("counter_proposal"),
            "draft_revisions": {
                "latest_text": text_content,
                "findings": final_state.get("draft_revisions", []),
                "history": []
            }
        }
        
        print(f"[SUPABASE UPDATE] Checking if contract_id: {contract_id} already exists (Admin Client).")
        existing = admin_supabase.table("contracts").select("id").eq("id", contract_id).eq("tenant_id", tenant_id).execute()
        
        if existing.data and len(existing.data) > 0:
            print(f"[SUPABASE UPDATE] Existing record found. Sending exact payload to update():")
            print(json.dumps(update_payload, indent=2, default=str))
            try:
                res = admin_supabase.table("contracts").update(update_payload).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
                print(f"[SUPABASE UPDATE] Success! Response: {res.data}")
            except Exception as e:
                print(f"!!! [SUPABASE UPDATE ERROR] Exceptions swallowed during update(): {e}")
                traceback.print_exc()
        else:
            insert_payload = {
                "id": contract_id, 
                "tenant_id": tenant_id, 
                "matter_id": matter_id,
                "title": filename,
                **update_payload
            }
            print(f"[SUPABASE INSERT] Record NOT found. Sending payload to insert():")
            print(json.dumps(insert_payload, indent=2, default=str))
            try:
                res = admin_supabase.table("contracts").insert(insert_payload).execute()
                print(f"[SUPABASE INSERT] Success! Response: {res.data}")
            except Exception as e:
                print(f"!!! [SUPABASE INSERT ERROR] Exceptions swallowed during insert(): {e}")
                traceback.print_exc()
        
        # ── War Room: Persist version snapshot ──
        try:
            # Determine the version number for this contract
            version_res = admin_supabase.table("contract_versions") \
                .select("version_number") \
                .eq("contract_id", contract_id) \
                .order("version_number", desc=True) \
                .limit(1) \
                .execute()
            
            next_version = 1
            if version_res.data:
                next_version = (version_res.data[0].get("version_number", 0) or 0) + 1
            
            # Serialize the pipeline output (strip raw_document to save space)
            pipeline_snapshot = {}
            for key in ["risk_score", "risk_level", "risk_flags_v2", "compliance_findings_v2",
                        "draft_revisions_v2", "obligations_v2", "classified_clauses_v2",
                        "review_findings", "quick_insights", "banner",
                        "contract_value", "currency", "end_date", "effective_date",
                        "jurisdiction", "governing_law", "counter_proposal"]:
                if key in final_state:
                    pipeline_snapshot[key] = final_state[key]

            version_id = str(uuid.uuid4())
            version_record = {
                "id": version_id,
                "contract_id": contract_id,
                "tenant_id": tenant_id,
                "version_number": next_version,
                "raw_text": text_content[:500000],
                "pipeline_output": pipeline_snapshot,
                "risk_score": float(score),
                "risk_level": risk_level,
                "uploaded_filename": filename
            }
            admin_supabase.table("contract_versions").insert(version_record).execute()
            
            # Update contracts table with version tracking
            admin_supabase.table("contracts") \
                .update({"version_count": next_version, "latest_version_id": version_id}) \
                .eq("id", contract_id) \
                .eq("tenant_id", tenant_id) \
                .execute()
            
            print(f"✅ [War Room] Persisted version V{next_version} (id={version_id}) for contract {contract_id}")
        except Exception as ver_err:
            print(f"⚠️ [War Room] Failed to persist version snapshot: {ver_err}")
            traceback.print_exc()

        # Insert extracted obligations
        obligations = final_state.get("extracted_obligations", [])
        if obligations:
            obligations_data = [
                {
                    "tenant_id": tenant_id,
                    "contract_id": contract_id,
                    "description": ob.get("description", ""),
                    "due_date": ob.get("due_date"), 
                    "status": "pending"
                }
                for ob in obligations if ob.get("description")
            ]
            if obligations_data:
                try:
                    admin_supabase.table("contract_obligations").insert(obligations_data).execute()
                    print(f"✅ Inserted {len(obligations_data)} obligations for contract {contract_id}")
                except Exception as ob_err:
                    print(f"⚠️ Failed to insert obligations: {ob_err}")

        # Insert classified clauses
        clauses = final_state.get("classified_clauses", [])
        if clauses:
            clauses_data = [
                {
                    "tenant_id": tenant_id,
                    "contract_id": contract_id,
                    "clause_type": cl.get("clause_type", "Other"),
                    "original_text": cl.get("original_text", ""),
                    "ai_summary": cl.get("ai_summary")
                }
                for cl in clauses if cl.get("original_text")
            ]
            if clauses_data:
                try:
                    admin_supabase.table("contract_clauses").insert(clauses_data).execute()
                    print(f"✅ Inserted {len(clauses_data)} clauses for contract {contract_id}")
                except Exception as cl_err:
                    print(f"⚠️ Failed to insert clauses: {cl_err}")
        
        # Chunking & Vectorization (Batched Insert)
        import re
        chunks = chunk_text(text_content, chunk_size=1500, overlap=200)
        print(f"🔄 [BACKGROUND] Document split into {len(chunks)} chunks. Starting Qdrant vectorization...")
        
        points = []
        for i, chunk in enumerate(chunks):
            chunk_embed = await async_embed(chunk)
            
            # Extract page number for citations
            page_match = re.search(r'\[Page (\d+)\]', chunk)
            page_number = page_match.group(1) if page_match else "Unknown"
            
            point_id = str(uuid.uuid4())
            points.append(
                PointStruct(
                    id=point_id, 
                    vector=chunk_embed,
                    payload={
                        "tenant_id": tenant_id, 
                        "contract_id": contract_id, 
                        "chunk_index": i,
                        "text": chunk,
                        "page_number": page_number
                    }
                )
            )
            
        if points:
            batch_size = 100
            for i in range(0, len(points), batch_size):
                batch = points[i:i + batch_size]
                await async_qdrant_upsert(COLLECTION_NAME, batch)
                
        print(f"[BACKGROUND] process_contract_background successfully completed for {contract_id}.")
    except Exception as e:
        print(f"!!! [BACKGROUND] Unhandled Exception during process_contract_background: {e}")
        traceback.print_exc()

@router.post("/upload")
async def upload_contract(
    file: UploadFile = File(...),
    matter_id: str = Form(None),
    contract_id: str = Form(None),
    parent_contract_id: str = Form(None),
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    tenant_id = claims["verified_tenant_id"]
    
    print(f"[ENDPOINT HIT] /api/upload called for filename: {file.filename}")
    
    # Validasi 1: Ekstensi Kasar
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Hanya menerima file berformat PDF.")

    contents = await file.read()
    
    # Validasi 2: OWASP Magic Numbers (PDF Signature '%PDF-')
    if not contents.startswith(b'%PDF-'):
        raise HTTPException(status_code=403, detail="Peringatan Keamanan: File ini mencoba menyamar sebagai PDF. Ditolak.")

    try:
        import fitz
        import pymupdf4llm
        doc = fitz.open(stream=contents, filetype="pdf")
        text_content = pymupdf4llm.to_markdown(doc)

        if not text_content.strip():
            raise HTTPException(status_code=400, detail="Kami tidak dapat membaca dokumen ini. Pastikan PDF tidak dienkripsi atau berupa gambar hasil scan tanpa OCR.")

        if not contract_id:
            contract_id = parent_contract_id if parent_contract_id else str(uuid.uuid4())
        elif parent_contract_id:
            contract_id = parent_contract_id

        # ── War Room: Version-Aware Fuzzy Match ──
        version_candidate = None
        if matter_id and not parent_contract_id:
            try:
                existing_contracts = admin_supabase.table("contracts") \
                    .select("id, title") \
                    .eq("matter_id", matter_id) \
                    .eq("tenant_id", tenant_id) \
                    .execute()
                
                if existing_contracts.data:
                    upload_name = (file.filename or "").lower().replace(".pdf", "").strip()
                    best_match = None
                    best_score = 0.0
                    
                    for ec in existing_contracts.data:
                        existing_title = (ec.get("title") or "").lower().replace(".pdf", "").strip()
                        if not existing_title:
                            continue
                        ratio = SequenceMatcher(None, upload_name, existing_title).ratio()
                        if ratio >= 0.6 and ratio > best_score:
                            best_score = ratio
                            best_match = ec
                    
                    if best_match:
                        version_candidate = {
                            "is_version_candidate": True,
                            "matched_contract_id": best_match["id"],
                            "matched_contract_title": best_match.get("title", "Unknown"),
                            "similarity_score": round(best_score, 3)
                        }
                        print(f"🔗 [War Room] Version candidate detected: '{file.filename}' matches '{best_match.get('title')}' (score={best_score:.3f})")
            except Exception as match_err:
                print(f"⚠️ [War Room] Fuzzy match check failed (non-fatal): {match_err}")

        # Schedule on the running event loop (NOT BackgroundTasks).
        task = asyncio.create_task(
            process_contract_background(
                contract_id=contract_id,
                tenant_id=tenant_id,
                matter_id=matter_id,
                filename=file.filename,
                text_content=text_content
            )
        )
        task.add_done_callback(functools.partial(handle_task_result, contract_id=contract_id, tenant_id=tenant_id))
        print(f"[ENDPOINT SUCCESS] Background task scheduled for contract_id: {contract_id}. Returning 200 immediately.")

        response = {
            "status": "success", 
            "message": "Upload diproses di latar belakang.",
            "contract_id": contract_id,
            "smart_metadata": {}
        }
        
        # Attach version candidate info if detected
        if version_candidate:
            response["version_candidate"] = {
                **version_candidate,
                "uploaded_contract_id": contract_id,
                "uploaded_filename": file.filename
            }
        
        return response
    except Exception as e:
        print(f"API Upload Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/confirm-version")
async def confirm_version_link(
    payload: ConfirmVersionLinkRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """
    User confirms that a newly uploaded contract is a new version of an existing one.
    This merges the new contract's data into the parent contract's version chain.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        
        # Verify both contracts exist and belong to this tenant
        parent_res = admin_supabase.table("contracts") \
            .select("id, title, version_count, matter_id") \
            .eq("id", payload.parent_contract_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()
        
        new_res = admin_supabase.table("contracts") \
            .select("id, title") \
            .eq("id", payload.new_contract_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()
        
        if not parent_res.data:
            raise HTTPException(status_code=404, detail="Parent contract not found.")
        if not new_res.data:
            raise HTTPException(status_code=404, detail="New contract not found.")
        
        parent = parent_res.data[0]
        
        # Check if the new contract already has a V1 version entry — re-assign it to the parent
        new_version_res = admin_supabase.table("contract_versions") \
            .select("id, version_number, raw_text, pipeline_output, risk_score, risk_level, uploaded_filename") \
            .eq("contract_id", payload.new_contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("version_number", desc=True) \
            .limit(1) \
            .execute()
        
        current_version_count = parent.get("version_count", 1) or 1
        next_version = current_version_count + 1
        
        if new_version_res.data:
            # Re-assign the version snapshot to the parent contract
            version_row = new_version_res.data[0]
            admin_supabase.table("contract_versions") \
                .update({
                    "contract_id": payload.parent_contract_id,
                    "version_number": next_version
                }) \
                .eq("id", version_row["id"]) \
                .eq("tenant_id", tenant_id) \
                .execute()
            
            # Update parent contract tracking
            admin_supabase.table("contracts") \
                .update({
                    "version_count": next_version,
                    "latest_version_id": version_row["id"]
                }) \
                .eq("id", payload.parent_contract_id) \
                .eq("tenant_id", tenant_id) \
                .execute()
            
            # [HOTFIX] Cleanup orphaned child contract shell
            admin_supabase.table("contracts") \
                .delete() \
                .eq("id", payload.new_contract_id) \
                .eq("tenant_id", tenant_id) \
                .execute()
            
            print(f"✅ [War Room] Linked version V{next_version} to parent contract {payload.parent_contract_id}. Orphaned contract {payload.new_contract_id} deleted.")
        else:
            print(f"⚠️ [War Room] No version snapshot found for new contract {payload.new_contract_id} — pipeline may still be running.")
        
        return {
            "status": "success",
            "message": f"Contract linked as Version {next_version}.",
            "parent_contract_id": payload.parent_contract_id,
            "new_version_number": next_version
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Confirm Version Link Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/obligations/extract")
async def extract_obligations(
    request: ExtractObligationsRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]

        # 1. Fetch Contract Text from Qdrant (NON-BLOCKING)
        contract_res, rules_res = await asyncio.gather(
            async_qdrant_scroll(
                collection=COLLECTION_NAME,
                scroll_filter=Filter(must=[
                    FieldCondition(key="contract_id", match=models.MatchValue(value=request.contract_id)),
                    FieldCondition(key="tenant_id", match=models.MatchValue(value=tenant_id))
                ]),
                limit=100
            ),
            async_qdrant_scroll(
                collection="company_rules",
                scroll_filter=Filter(must=[
                    FieldCondition(key="user_id", match=models.MatchValue(value=request.user_id))
                ]),
                limit=50
            )
        )
        
        contract_text = ""
        for hit in contract_res[0]:
            contract_text += hit.payload.get("text", "") + "\n\n"
            
        if not contract_text.strip():
            raise HTTPException(status_code=404, detail="Contract text not found in vector database.")

        playbook_rules = ""
        if rules_res[0]:
            for hit in rules_res[0]:
                playbook_rules += f"- {hit.payload.get('rule_text', '')}\n"
        else:
            playbook_rules = "No custom playbook rules defined."

        # 3. Call OpenAI for Extraction & Compliance Check (NON-BLOCKING)
        system_prompt = """
You are an Elite Indonesian Corporate Lawyer AI. Read the provided CONTRACT TEXT.
Your task is to extract ONLY actionable obligations (things a party MUST DO, such as paying, delivering, or reporting). 
DO NOT extract general facts, background information, or declarations.

CRITICAL RULES:
1. ALWAYS write the output in INDONESIAN (Bahasa Indonesia).
2. Format each obligation clearly, starting with the responsible party. Example: "Vendor wajib..." or "Klien wajib...".
3. Evaluate each obligation against the provided COMPANY PLAYBOOK RULES.

Return a JSON object containing an array called 'obligations' with keys:
- 'description': (string) The actionable obligation in Indonesian.
- 'due_date': (string) The deadline, or 'N/A'.
- 'compliance_flag': (string) MUST BE 'SAFE' or 'CONFLICT' (if it violates the playbook).
"""
        user_prompt = f"COMPANY PLAYBOOK RULES:\n{playbook_rules}\n\nCONTRACT TEXT:\n{contract_text}"

        response = await async_chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        raw_output = response.choices[0].message.content
        extracted_data = json.loads(raw_output)
        obligations_list = extracted_data.get("obligations", [])
        
        if not obligations_list:
            return {"status": "success", "message": "No obligations found.", "data": []}

        # 4. Save to Supabase
        insert_payload = []
        for ob in obligations_list:
            insert_payload.append({
                "tenant_id": tenant_id,
                "contract_id": request.contract_id,
                "description": ob.get("description", "Unknown obligation"),
                "due_date": ob.get("due_date", None) if ob.get("due_date") != "N/A" else None,
                "status": "pending",
                "source": "AI",
                "compliance_flag": ob.get("compliance_flag", "SAFE")
            })
            
        # Each element in insert_payload already contains "tenant_id": tenant_id
        db_res = supabase.table("contract_obligations").insert([{**ob, "tenant_id": tenant_id} for ob in insert_payload]).execute()
        
        return {
            "status": "success", 
            "message": f"Successfully extracted {len(obligations_list)} obligations.",
            "data": db_res.data
        }
    except Exception as e:
        print(f"Obligation Extraction Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{contract_id}/archive")
async def archive_contract(
    contract_id: str,
    request: ArchiveContractRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        from datetime import datetime
        tenant_id = claims["verified_tenant_id"]
        
        update_payload = {
            "status": "ARCHIVED",
            "archive_reason": request.archive_reason,
            "archived_at": datetime.utcnow().isoformat()
        }
        res = supabase.table("contracts").update(update_payload).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="Contract not found or permission denied.")
            
        return {"status": "success", "message": "Contract archived successfully"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"API Archive Contract Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
