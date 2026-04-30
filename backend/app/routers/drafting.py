"""
Pariana Backend — Smart Drafting Router (Isolated)

Handles:
  - POST /api/v1/drafting/generate  → AI-powered contract draft generation
  - POST /api/v1/drafting/audit     → Send a raw-text draft to the LangGraph audit pipeline

This router is completely isolated from the existing contracts/upload flow.
"""
import asyncio
import json
import time
import uuid

from fastapi import APIRouter, HTTPException, Depends, Request
from supabase import Client

from app.ai_usage import extract_openai_usage, log_ai_usage_sync, log_openai_response_sync
from app.config import OUTPUT_TOKEN_CAPS, admin_supabase, openai_client
from app.rate_limiter import limiter
from app.dependencies import TenantQdrantClient, get_tenant_qdrant, get_tenant_supabase, verify_clerk_token
from app.schemas import DraftGenerateRequest, DraftAuditRequest, DraftChatRequest, DraftSaveRequest
from app.pipeline_output_schema import PipelineOutput, serialize_pipeline_output
from app.routers.contracts import _schedule_contract_processing, publish_contract_event

router = APIRouter()


# =====================================================================
# POST /generate — AI Draft Generation
# =====================================================================

@router.post("/generate")
@limiter.limit("5/minute")
async def generate_draft(
    request: Request,
    payload: DraftGenerateRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Uses OpenAI gpt-4o-mini to generate a professional legal contract draft
    based on the template name, counterparty, and user instructions.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        system_prompt = (
            "You are an expert Corporate Lawyer. Draft a professional legal contract "
            "based on the provided inputs. CRITICAL RULE: You MUST write the entire contract in Bahasa Indonesia. "
            "Output strictly in CLEAN PLAIN TEXT. "
            "DO NOT use any Markdown symbols (no asterisks **, no hashes #). "
            "Use ALL CAPS for section headings, standard legal numbering (1., 2., 3.), "
            "and clear double line breaks between paragraphs. "
            "The text must look like a perfectly formatted formal document inside a plain text editor."
        )

        user_prompt = (
            f"Template: {payload.template_name}\n"
            f"Counterparty: {payload.party_name}\n"
        )
        if payload.instructions:
            user_prompt += f"Special Instructions: {payload.instructions}\n"

        started_at = time.time()
        response = await asyncio.to_thread(
            openai_client.chat.completions.create,
            model="gpt-4o-mini",
            max_tokens=OUTPUT_TOKEN_CAPS["draft_generate"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        log_ai_usage_sync(
            admin_supabase,
            tenant_id,
            "draft_generate",
            "gpt-4o-mini",
            *extract_openai_usage(response),
            int((time.time() - started_at) * 1000),
        )

        draft_text = response.choices[0].message.content

        return {"status": "success", "draft_text": draft_text}

    except Exception as e:
        print(f"❌ Draft Generate Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# POST /audit — Send Draft Text to LangGraph Audit Pipeline
# =====================================================================

@router.post("/audit")
@limiter.limit("3/minute")
@limiter.limit("15/hour")
async def audit_draft(
    request: Request,
    payload: DraftAuditRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Inserts the raw-text draft into the `contracts` table and triggers the
    LangGraph multi-agent audit pipeline as a background task.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        if not tenant_id:
            raise HTTPException(status_code=401, detail="Invalid token claims")
            
        contract_id = str(uuid.uuid4())

        # --- Step 1: Insert into contracts table ---
        version_id = str(uuid.uuid4())
        try:
            insert_res = supabase.table("contracts").insert({
                "id": contract_id,
                "tenant_id": tenant_id,
                "matter_id": payload.matter_id,
                "title": payload.title,
                "draft_revisions": {"latest_text": payload.draft_text},
                "status": "Queued",
                "version_count": 1,
                "latest_version_id": None,
            }).execute()

            if not insert_res.data:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to insert draft contract into database.",
                )
        except HTTPException:
            raise
        except Exception as e:
            print(f"🚨 SUPABASE INSERT ERROR (contracts table - drafting audit): {e}")
            raise HTTPException(status_code=500, detail=str(e))

        try:
            supabase.table("contract_versions").insert({
                "id": version_id,
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "version_number": 1,
                "raw_text": payload.draft_text[:500000],
                "uploaded_filename": payload.title,
                "pipeline_output": serialize_pipeline_output(PipelineOutput()),
            }).execute()
        except Exception as e:
            print(f"🚨 SUPABASE INSERT ERROR (contract_versions table - drafting audit): {e}")
            raise HTTPException(status_code=500, detail=str(e))

        try:
            supabase.table("contracts").update({
                "latest_version_id": version_id,
            }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
        except Exception as e:
            print(f"🚨 SUPABASE UPDATE ERROR (contracts.latest_version_id - drafting audit): {e}")
            raise HTTPException(status_code=500, detail=str(e))

        await publish_contract_event(
            "contract.created",
            tenant_id,
            contract_id=contract_id,
            data={
                "contract_id": contract_id,
                "contract_title": payload.title,
                "status": "Queued",
                "matter_id": payload.matter_id,
                "message": f"{payload.title} queued for audit",
            },
        )
        await publish_contract_event(
            "contract.status_changed",
            tenant_id,
            contract_id=contract_id,
            data={
                "contract_id": contract_id,
                "contract_title": payload.title,
                "old_status": None,
                "new_status": "Queued",
                "message": f"{payload.title} is queued for audit",
            },
        )

        # --- Step 2: Trigger durable background pipeline ---
        await _schedule_contract_processing(
            contract_id=contract_id,
            version_id=version_id,
            tenant_id=tenant_id,
            matter_id=payload.matter_id,
            filename=payload.title,
            text_content=payload.draft_text,
        )

        return {
            "status": "success",
            "message": "Draft sent to LangGraph Audit",
            "contract_id": contract_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Draft Audit Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


from langchain_core.tools import tool
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage


# =====================================================================
# LangChain Tool Factory: Semantic Clause Search (Strict Tenant Isolation)
# =====================================================================

class ClauseSearchInput(BaseModel):
    query: str = Field(description="The risky vendor clause text to search for.")

def get_clause_search_tool(qdrant_client: TenantQdrantClient):
    @tool("search_standard_clauses", args_schema=ClauseSearchInput)
    def search_standard_clauses(query: str) -> str:
        """Search the company's approved standard clause library in Qdrant. Use this when you find a risky vendor clause and need to suggest a replacement."""
        try:
            from app.config import openai_client
            
            # Embed query
            started_at = time.time()
            response = openai_client.embeddings.create(input=query, model="text-embedding-3-small")
            log_openai_response_sync(
                admin_supabase,
                getattr(qdrant_client, "tenant_id", None),
                "clause_assistant_embedding",
                "text-embedding-3-small",
                response,
                int((time.time() - started_at) * 1000),
            )
            
            # Search Qdrant through the tenant-scoped facade so tenant filtering cannot be bypassed.
            hits = qdrant_client.search(
                collection_name="clause_library_vectors",
                query_vector=response.data[0].embedding,
                limit=1,
                score_threshold=0.5
            )
            
            if not hits:
                return "System Message: No matching standard clauses found in the company library."
                
            match = hits[0]
            # Provide rich context back to the LLM so it can format the suggestion
            clause_id = match.payload.get('clause_id', '')
            
            return f"""
            FOUND MATCH!
            Standard Text: {match.payload.get('content', '')}
            Type: {match.payload.get('clause_type', 'Standard')}
            Similarity Score: {round(match.score, 2)}
            
            Instruct the user to replace their risky clause with this Standard Text. Provide the replacement button using the exact format `[REPLACE_ACTION: {clause_id}]` in your reply. Set the `suggestion` key to the exact Standard Text.
            """
        except Exception as e:
            print(f"Tool Error: {e}")
            return "System Message: Failed to search the clause library due to an internal error."
            
    return search_standard_clauses


# =====================================================================
# POST /chat — Clause Assistant (Live Draft Q&A with Tooling)
# =====================================================================

@router.post("/chat")
@limiter.limit("20/minute")
async def draft_chat(
    request: Request,
    payload: DraftChatRequest,
    claims: dict = Depends(verify_clerk_token),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
):
    """
    Clause Assistant: Agentic loop with tooling to answer draft questions
    and actively search the custom Clause Library.
    """
    try:
        if not claims["verified_tenant_id"]:
            raise HTTPException(status_code=401, detail="Invalid token claims")

        # 1. Get the tenant-aware tool
        clause_tool = get_clause_search_tool(qdrant_client)
        
        # 2. Initialize LLM
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0, max_tokens=OUTPUT_TOKEN_CAPS["clause_assistant_simple"])
        llm_with_tools = llm.bind_tools([clause_tool])

        system_prompt = (
            "You are an expert Legal Clause Assistant. "
            "Review the user's current draft and answer their question. "
            "If they ask to review a clause against playbooks, ALWAYS use the `search_standard_clauses` tool. "
            "YOU MUST RESPOND ONLY IN VALID JSON FORMAT at the very end. "
            "The JSON must contain exactly two keys: "
            "1. `reply`: Your conversational explanation and any [REPLACE_ACTION: id] tags. "
            "2. `suggestion`: The exact new legal paragraph if suggesting a replacement, otherwise null."
        )

        user_prompt = (
            f"CURRENT DRAFT:\n{payload.draft_text}\n\n"
            f"LAWYER'S REQUEST:\n{payload.question}"
        )

        messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]
        
        # 3. First Pass (Tool Calling)
        response = await llm_with_tools.ainvoke(messages)
        
        # 4. Agentic Loop: Execute Tool if Requested
        if response.tool_calls:
            messages.append(response)
            for tool_call in response.tool_calls:
                if tool_call["name"] == "search_standard_clauses":
                    tool_result = clause_tool.invoke(tool_call["args"])
                    messages.append(ToolMessage(content=str(tool_result), tool_call_id=tool_call["id"]))
            
            # Second Pass: Force JSON Object Output
            llm_json = ChatOpenAI(model="gpt-4o-mini", temperature=0, max_tokens=OUTPUT_TOKEN_CAPS["clause_assistant_synthesis"]).bind(response_format={"type": "json_object"})
            final_response = await llm_json.ainvoke(messages)
            content = json.loads(final_response.content)
        else:
            # First pass didn't use tools, but we must guarantee JSON
            try:
                content = json.loads(response.content)
            except json.JSONDecodeError:
                llm_json = ChatOpenAI(model="gpt-4o-mini", temperature=0, max_tokens=OUTPUT_TOKEN_CAPS["clause_assistant_synthesis"]).bind(response_format={"type": "json_object"})
                final_response = await llm_json.ainvoke(messages)
                content = json.loads(final_response.content)

        return {
            "reply": content.get("reply", ""),
            "suggestion": content.get("suggestion", None),
        }

    except Exception as e:
        print(f"❌ Draft Chat Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# POST /save — Save Draft to Contracts Table
# =====================================================================

@router.post("/save")
@limiter.limit("30/minute")
async def save_draft(
    request: Request,
    payload: DraftSaveRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Saves or updates a draft in the contracts table.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        if not tenant_id:
            raise HTTPException(status_code=401, detail="Invalid token claims")
        
        if payload.contract_id:
            # Update existing
            contract_id = payload.contract_id

            # Smart passthrough: accept both legacy string and new JSONB object
            draft_revisions = payload.draft_text if isinstance(payload.draft_text, dict) else {"latest_text": payload.draft_text}

            update_res = supabase.table("contracts").update({
                "draft_revisions": draft_revisions,
                "status": "Draft",
            }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
            
            if not update_res.data:
                raise HTTPException(status_code=500, detail="Failed to update draft.")
        else:
            # Insert new
            contract_id = str(uuid.uuid4())

            # Smart passthrough: accept both legacy string and new JSONB object
            draft_revisions = payload.draft_text if isinstance(payload.draft_text, dict) else {"latest_text": payload.draft_text}

            insert_res = supabase.table("contracts").insert({
                "id": contract_id,
                "tenant_id": tenant_id,
                "matter_id": payload.matter_id,
                "title": payload.title,
                "draft_revisions": draft_revisions,
                "status": "Draft",
            }).execute()
            
            if not insert_res.data:
                raise HTTPException(status_code=500, detail="Failed to insert draft.")

        return {"status": "success", "contract_id": contract_id}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Draft Save Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# GET /load/{matter_id} — Load Latest Draft
# =====================================================================

@router.get("/load/{matter_id}")
@limiter.limit("60/minute")
async def load_draft(
    request: Request,
    matter_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
    contract_id: str | None = None,
):
    """
    Loads the latest draft for a specific matter.
    If contract_id is provided, loads that specific contract instead.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        if not tenant_id:
            raise HTTPException(status_code=401, detail="Invalid token claims")
        
        if contract_id:
            # Load a specific contract by ID
            res = supabase.table("contracts") \
                .select("id, draft_revisions, status, matter_id") \
                .eq("id", contract_id) \
                .eq("tenant_id", tenant_id) \
                .limit(1) \
                .execute()
        else:
            # Load the latest contract for this matter
            res = supabase.table("contracts") \
                .select("id, draft_revisions, status") \
                .eq("matter_id", matter_id) \
                .eq("tenant_id", tenant_id) \
                .order("created_at", desc=True) \
                .limit(1) \
                .execute()
            
        if res.data and len(res.data) > 0:
            draft = res.data[0]
            revisions = draft.get("draft_revisions")

            # Adaptive JSONB parsing: handle dict, list, or raw string
            draft_text = ""
            if revisions:
                if isinstance(revisions, dict):
                    draft_text = revisions.get("latest_text", "")
                elif isinstance(revisions, list):
                    # LangGraph Compliance Audit stores an array of findings
                    formatted = []
                    for idx, item in enumerate(revisions):
                        if isinstance(item, dict):
                            original = item.get("original_issue", "N/A")
                            rewrite = item.get("neutral_rewrite", "N/A")
                            formatted.append(
                                f"📌 PASAL REVISI {idx + 1}\n\n"
                                f"[Isu Awal]:\n{original}\n\n"
                                f"[Saran Redaksi AI]:\n{rewrite}"
                            )
                        elif isinstance(item, str):
                            formatted.append(item)
                    draft_text = ("\n\n" + "─" * 40 + "\n\n").join(formatted)
                elif isinstance(revisions, str):
                    draft_text = revisions

            return {
                "found": True,
                "contract_id": draft["id"],
                "draft_text": draft_text,
                "draft_revisions": revisions,  # Return raw JSONB for frontend history parsing
                "status": draft["status"]
            }
        
        return {"found": False}

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Draft Load Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load draft")


# =====================================================================
# POST /apply-suggestion — Smart AI text replacement
# =====================================================================

from app.schemas import ApplySuggestionRequest

@router.post("/apply-suggestion")
@limiter.limit("10/minute")
async def apply_suggestion(
    request: Request,
    payload: ApplySuggestionRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Intelligently locates the referenced clause based on original_issue and replaces it
    with the neutral_rewrite, saving the updated document to the database.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        if not tenant_id:
            raise HTTPException(status_code=401, detail="Invalid token claims")

        # 1. Fetch current draft text & history
        res = supabase.table("contracts") \
            .select("draft_revisions, id") \
            .eq("id", payload.contract_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()

        if not res.data or not res.data[0].get("draft_revisions"):
            raise HTTPException(status_code=404, detail="Contract draft not found.")

        revisions = res.data[0].get("draft_revisions")
        if not isinstance(revisions, dict) or "latest_text" not in revisions:
            raise HTTPException(status_code=400, detail="Draft format is incompatible with suggestions.")

        current_text = revisions["latest_text"]

        # 2. Use LLM to accurately replace the text
        system_prompt = (
            "You are an expert context-aware text replacer. "
            "You will be given the full current document text, an issue description or excerpt ('original_issue'), "
            "and a new clause to apply ('neutral_rewrite'). "
            "Locate the exact paragraph/clause in the document that matches the 'original_issue'. "
            "Replace that entire clause with the 'neutral_rewrite'. "
            "Return ONLY the complete updated document text. "
            "CRITICAL: You MUST preserve all existing Markdown formatting, bolding, headings, line breaks, and structure exactly as they appear in the original text. Do not strip any Markdown structure."
        )

        user_prompt = (
            f"ORIGINAL_ISSUE:\n{payload.original_issue}\n\n"
            f"NEUTRAL_REWRITE:\n{payload.neutral_rewrite}\n\n"
            f"CURRENT DOCUMENT TEXT:\n{current_text}"
        )

        started_at = time.time()
        response = await asyncio.to_thread(
            openai_client.chat.completions.create,
            model="gpt-4o-mini",
            max_tokens=OUTPUT_TOKEN_CAPS["draft_apply_suggestion"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.0
        )
        log_ai_usage_sync(
            admin_supabase,
            tenant_id,
            "draft_apply_suggestion",
            "gpt-4o-mini",
            *extract_openai_usage(response),
            int((time.time() - started_at) * 1000),
            contract_id=payload.contract_id,
        )

        updated_text = response.choices[0].message.content.strip()

        # 3. Save the updated text back to the database
        revisions["latest_text"] = updated_text
        
        # Add to history
        history = revisions.get("history", [])
        from datetime import datetime
        history.append({
            "version_id": str(int(datetime.utcnow().timestamp())),
            "timestamp": datetime.utcnow().isoformat(),
            "actor": "User (AI Assist)",
            "action_type": "Applied Suggestion",
            "content": updated_text
        })
        revisions["history"] = history

        update_res = supabase.table("contracts").update({
            "draft_revisions": revisions
        }).eq("id", payload.contract_id).eq("tenant_id", tenant_id).execute()

        if not update_res.data:
            raise HTTPException(status_code=500, detail="Failed to save the updated document.")

        return {
            "status": "success",
            "message": "Suggestion applied successfully.",
            "updated_text": updated_text
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Apply Suggestion Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
