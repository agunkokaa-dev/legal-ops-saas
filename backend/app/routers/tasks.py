"""
Pariana Backend — Tasks & AI Assistant Router (Fully Refactored)

Handles:
  - POST /api/v1/tasks/from-template  → Generate tasks from SOP template
  - POST /api/v1/ai/task-assistant     → Agentic AI assistant with tool calling
"""
import asyncio
import traceback
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Depends, Request
from supabase import Client
from qdrant_client.http.models import Filter, FieldCondition, MatchAny
import json

from app.config import openai_client, qdrant, COLLECTION_NAME
from app.rate_limiter import limiter
from app.dependencies import (
    TenantQdrantClient,
    get_tenant_qdrant,
    get_tenant_supabase,
    verify_clerk_token,
)
from app.schemas import ApplyTemplateRequest, TaskAssistantRequest

router = APIRouter()


async def get_cross_tenant_tasks_admin_client() -> Client:
    # CROSS-TENANT: legacy personal-workspace task routes intentionally span multiple allowed tenant ids.
    from app.dependencies import get_admin_supabase

    return await get_admin_supabase()


# =====================================================================
# AGENTIC TOOL & ASYNC WRAPPERS
# =====================================================================

def get_user_tasks_tool_logic(tenant_ids: list[str], supabase: Client) -> str:
    """
    Fetch the list of active tasks/to-dos for the user from Supabase.
    Use this tool ONLY when the user asks about their tasks, schedule,
    deadlines, or to-do list.
    """
    print(f"🔍 DEBUG TOOL: Executing get_user_tasks for tenant_ids: {tenant_ids}")
    try:
        query = (
            supabase.table("tasks")
            .select("title, status, priority, due_date, source_document_name")
            .in_("tenant_id", tenant_ids)
            .neq("status", "done")
            .neq("status", "archived")
            .neq("status", "ARCHIVED")
            .order("created_at", desc=True)
        )
        response = query.execute()

        print(f"🔍 DEBUG TOOL: Supabase Raw Response Data: {response.data}")

        tasks = response.data
        if not tasks:
            return f"Saat ini tidak ada tugas aktif untuk tenant(s) {tenant_ids}."

        formatted_tasks = []
        for t in tasks:
            date_str = (
                t.get("due_date", "")[:10]
                if t.get("due_date")
                else "No Deadline"
            )
            source = t.get("source_document_name") or "-"
            formatted_tasks.append(
                f"- **{t.get('title', 'Untitled')}** | Status: {t.get('status', 'Todo')} "
                f"| Priority: {t.get('priority', 'medium')} | Due: {date_str} "
                f"| Source: {source}"
            )

        return (
            f"Berikut adalah daftar {len(tasks)} tugas aktif dari database:\n"
            + "\n".join(formatted_tasks)
        )
    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"🔥 SUPABASE TOOL ERROR: {error_trace}")
        return f"CRITICAL DATABASE ERROR. TELL THE USER EXACTLY THIS STRING: {str(e)}"


def get_high_risk_contracts_tool_logic(tenant_id: str, supabase: Client) -> str:
    """
    Fetch the list of contracts/documents for the user, specifically highlighting dangerous or HIGH RISK contracts.
    """
    print(f"🔍 DEBUG TOOL: Executing get_high_risk_contracts for tenant_id: '{tenant_id}'")
    try:
        response = (
            supabase.table("contracts")
            .select("id, title, risk_level, created_at")
            .eq("tenant_id", tenant_id)
            .neq("status", "archived")
            .neq("status", "ARCHIVED")
            .execute()
        )
        
        docs = response.data
        if not docs:
            return "Status: Optimal. Tidak ada dokumen di dalam portofolio Anda saat ini."
            
        # Filter high risk contracts specifically
        high_risk_docs = [d for d in docs if str(d.get("risk_level")).upper() == "HIGH"]
        
        if not high_risk_docs:
            return "Status Portofolio: Aman. Tidak ada kontrak dengan eksposur Risiko Tinggi (HIGH RISK) yang teridentifikasi."
            
        # Return a dictionary/JSON so the LLM gets the id and title explicitly
        import json
        result = []
        for d in high_risk_docs:
            result.append({
                "id": str(d.get('id', '')).strip(),
                "title": str(d.get('title') or "Untitled Document").replace('\\n', '').replace('\\r', '').strip(),
                "risk_level": "HIGH RISK",
                "created_at": d.get('created_at')[:10] if d.get('created_at') else "N/A"
            })
            
        return json.dumps({
            "status": "Found high risk contracts", 
            "contracts": result
        })
        
    except Exception as e:
        error_trace = traceback.format_exc()
        print(f"🔥 SUPABASE TOOL ERROR (get_high_risk_contracts): {error_trace}")
        return f"CRITICAL SYSTEM ERROR: Gagal mengambil data portofolio. Detail: {str(e)}"


# --- OpenAI Function Calling tool definition for task fetching ---
GET_TASKS_TOOL_DEF = {
    "type": "function",
    "function": {
        "name": "get_user_tasks",
        "description": (
            "Fetch the user's active tasks from the database. "
            "Call this when the user asks 'apa tugasku', 'apa tugasku hari ini', "
            "'jadwal hari ini', 'my tasks', 'daily brief', 'to-do list', "
            "'pending work', 'deadlines', or any question about their schedule."
        ),
        "parameters": {
            "type": "object", 
            "properties": {
                "tenant_id": {
                    "type": "string",
                    "description": "The unique UUID of the user's tenant or organization context."
                }
            }, 
            "required": ["tenant_id"]
        },
    },
}

# --- OpenAI Function Calling tool definition for high risk contracts ---
GET_HIGH_RISK_CONTRACTS_TOOL_DEF = {
    "type": "function",
    "function": {
        "name": "get_high_risk_contracts",
        "description": (
            "Fetch the list of contracts/documents for the user, specifically highlighting dangerous or HIGH RISK contracts. "
            "Use this tool EVERY TIME the user asks 'apa saja kontrak yang berbahaya?', 'which contracts are high risk?', "
            "or asks for a portfolio risk overview."
        ),
        "parameters": {
            "type": "object", 
            "properties": {
                "tenant_id": {
                    "type": "string",
                    "description": "The unique UUID of the user's tenant or organization context."
                }
            }, 
            "required": ["tenant_id"]
        },
    },
}

# Tools bound ONLY for dashboard / matters source pages
DASHBOARD_TOOLS = [GET_TASKS_TOOL_DEF, GET_HIGH_RISK_CONTRACTS_TOOL_DEF]

async def async_embed(text: str) -> list[float]:
    response = await asyncio.to_thread(openai_client.embeddings.create, input=text, model="text-embedding-3-small")
    return response.data[0].embedding

async def async_chat_completion(messages: list, tools=None) -> any:
    kwargs = {"model": "gpt-4o-mini", "messages": messages}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    return await asyncio.to_thread(openai_client.chat.completions.create, **kwargs)

async def async_qdrant_search(qdrant_client: Any, collection: str, query_vector: list, limit: int, query_filter=None) -> list:
    """Async wrapper for qdrant-client v1.17+ query_points API."""
    try:
        kwargs = {
            "collection_name": collection,
            "query": query_vector,
            "limit": limit,
            "with_payload": True,
        }
        if query_filter:
            kwargs["query_filter"] = query_filter
        response = await asyncio.to_thread(qdrant_client.query_points, **kwargs)
        return response.points  # List[ScoredPoint] with .payload, .score, .id
    except Exception as e:
        import logging
        logging.error(f"🔥 RAG RETRIEVAL CRASHED: {str(e)}")
        logging.error(traceback.format_exc())
        return []  # Return empty list so the LLM still gets a response, just without context


# =====================================================================
# ENDPOINTS
# =====================================================================

@router.post("/tasks/from-template")
@limiter.limit("20/minute")
async def create_tasks_from_template(request: Request, req: ApplyTemplateRequest, claims: dict = Depends(verify_clerk_token), supabase: Client = Depends(get_tenant_supabase)):
    try:
        tenant_id = claims["verified_tenant_id"]

        res = supabase.table("task_template_items").select("*").eq("template_id", req.template_id).eq("tenant_id", tenant_id).order("position").execute()
        template_items = res.data
        if not template_items:
            raise HTTPException(status_code=404, detail="Template is empty or not found.")

        now = datetime.utcnow()
        new_tasks_payload = []
        for item in template_items:
            days_offset = item.get('days_offset', 0)
            due_date = now + timedelta(days=days_offset) if days_offset else None
            new_tasks_payload.append({
                "tenant_id": tenant_id,
                "matter_id": req.matter_id,
                "title": item.get('title', 'Untitled Task'),
                "description": item.get('description', ''),
                "status": "backlog",
                "position": item.get('position', 0),
                "due_date": due_date.isoformat() if due_date else None,
            })

        tasks_res = supabase.table("tasks").insert([{**t, "tenant_id": tenant_id} for t in new_tasks_payload]).execute()
        created_tasks = tasks_res.data

        all_new_sub_tasks = []
        for created_task in created_tasks:
            original_item = next((x for x in template_items if x['title'] == created_task['title']), None)
            if original_item and original_item.get('procedural_steps'):
                steps = original_item['procedural_steps']
                if isinstance(steps, list):
                    for step_title in steps:
                        all_new_sub_tasks.append({
                            "task_id": created_task['id'],
                            "title": step_title,
                            "is_completed": False
                        })

        if all_new_sub_tasks:
            supabase.table("sub_tasks").insert(all_new_sub_tasks).execute()

        first_task_id = created_tasks[0]["id"] if created_tasks and "id" in created_tasks[0] else None
        log_payload = {
            "tenant_id": tenant_id,
            "matter_id": req.matter_id,
            "action": f"{len(template_items)} tasks created from SOP Template",
            "actor_name": "System/User", 
        }
        if first_task_id:
            log_payload["task_id"] = first_task_id
            
        try:
             supabase.table("activity_logs").insert({**log_payload, "tenant_id": tenant_id}).execute()
        except Exception:
             pass

        return {
            "status": "success", 
            "message": f"Successfully generated {len(created_tasks)} Tasks and {len(all_new_sub_tasks)} Checklists.",
            "tasks": created_tasks
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai/task-assistant")
@limiter.limit("15/minute")
async def ask_task_assistant(
    request: Request,
    req: TaskAssistantRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
):
    try:
        # SECURITY: tenant_id MUST come exclusively from the verified JWT — never from the request body.
        tenant_id = claims["verified_tenant_id"]
        allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
        
        source = req.source_page or "dashboard"
        document_id = getattr(req, "document_id", None)
        
        task_context_str = "Unknown Task"
        try:
            task_resp = (
                supabase.table("tasks")
                .select("title, description")
                .eq("id", req.task_id)
                .in_("tenant_id", allowed_tenant_ids)
                .limit(1)
                .execute()
            )
            if task_resp.data:
                t_title = task_resp.data[0].get('title', '')
                t_desc = task_resp.data[0].get('description', '')
                task_context_str = f"Task Title: {t_title} | Description: {t_desc}"
        except Exception:
            pass

        # 🚨 CRITICAL: When source_page == "document", use document_id DIRECTLY
        contract_ids_to_search = []
        contract_titles = {}

        if source == "document" and document_id:
            contract_ids_to_search = [document_id]
            try:
                doc_resp = supabase.table("contracts").select("id, title, matter_id").eq("id", document_id).eq("tenant_id", tenant_id).execute()
                if doc_resp.data:
                    doc_record = doc_resp.data[0]
                    contract_titles[document_id] = doc_record.get("title", "Target Document")
                    real_matter_id = doc_record.get("matter_id")
                    if real_matter_id:
                        siblings_resp = supabase.table("contracts").select("id, title").eq("matter_id", real_matter_id).eq("tenant_id", tenant_id).execute()
                        if siblings_resp.data:
                            for record in siblings_resp.data:
                                if record["id"] not in contract_ids_to_search:
                                    contract_ids_to_search.append(record["id"])
                                contract_titles[record["id"]] = record.get("title", "Unknown Document")
                else:
                    contract_titles[document_id] = "Target Document"
            except Exception:
                contract_titles[document_id] = "Target Document"
        else:
            try:
                contracts_resp = supabase.table("contracts").select("id, title").eq("matter_id", req.matter_id).eq("tenant_id", tenant_id).execute()
                if contracts_resp.data:
                    for record in contracts_resp.data:
                        contract_ids_to_search.append(record["id"])
                        contract_titles[record["id"]] = record.get("title", "Unknown Document")
            except Exception:
                pass

        # NON-BLOCKING Execution
        question_vector = await async_embed(req.message)

        combined_context = ""
        if source != "document":
            combined_context += f"=== KONTEKS TUGAS (TASK) SAAT INI ===\n{task_context_str}\n\n"

        combined_context += "=== KONTEKS KONTRAK (DOKUMEN KLIEN) ===\n"

        if contract_ids_to_search:
            contract_results = await async_qdrant_search(
                qdrant_client=qdrant_client,
                collection=COLLECTION_NAME,
                query_vector=question_vector,
                limit=8 if source == "document" else 4, 
                query_filter=Filter(must=[FieldCondition(key="contract_id", match=MatchAny(any=contract_ids_to_search))])
            )
            for hit in contract_results:
                combined_context += f"TAG SUMBER: [{contract_titles.get(hit.payload.get('contract_id', ''), 'Unknown Document')}]\nTeks: {hit.payload.get('text', '')}\n\n"
        else:
            combined_context += "Tidak ada dokumen kontrak yang terhubung dengan konteks ini.\n\n"

        combined_context += "=== KONTEKS HUKUM NASIONAL (INDONESIA) ===\n"
        try:
            law_results = await async_qdrant_search(qdrant, "id_national_laws", question_vector, 2)
            for hit in law_results:
                combined_context += f"TAG SUMBER: [{hit.payload.get('source_law', 'Unknown Law')}, Pasal {hit.payload.get('pasal', 'Unknown Pasal')}]\nTeks: {hit.payload.get('text', '')}\n\n"
        except Exception:
            pass

        # SYSTEM PROMPT
        target_doc_name = contract_titles.get(document_id, "the target contract") if document_id else "the target contract"
        
        if source == "document":
            system_prompt = f"""
You are an elite, highly professional Senior Legal Counsel at a top-tier enterprise. The user is inquiring about a specific contract with Document ID: {document_id}.

CRITICAL INSTRUCTIONS:
1. MANDATORY RAG USAGE: You MUST use your retrieval tools to read the specific contract, related documents (MSA/SOW), and the company Playbook BEFORE answering.
2. PROFESSIONAL TONE: Use a highly formal, enterprise-grade tone. ABSOLUTELY NO EMOJIS. Use clean formatting (bolding, bullet points) for readability.
3. NATURAL CONVERSATION FLOW: Directly and naturally answer the user's specific prompt in the first paragraph. Connect the answer smoothly. For example, if the user asks "Kenapa kontrak ini berbahaya?", you must begin your response with "Kontrak ini teridentifikasi memiliki risiko tinggi dikarenakan..." and immediately state the exact reasons found in the text.
4. ORDER OF PRECEDENCE RULE (STRICT): Jika menemukan klausul Hierarki Dokumen (Order of Precedence), JANGAN mengutip KUHPerdata Pasal 1320 atau teori umum. Alih-alih, fokuslah mencari pertentangan spesifik pada pasal Ganti Rugi (Liability) atau Jaminan (Warranty) antara dokumen utama dan lampirannya, lalu berikan instruksi mitigasi yang sangat spesifik.
5. EVIDENCE-BASED: Base every claim strictly on the exact clauses retrieved. Do not hallucinate.

FORMAT REQUIREMENTS:
Do not use emojis. Structure your response logically:
**Executive Summary**
[Direct, natural answer to the user's question, summarizing the core issue]

**Clause & Obligation Analysis**
- **[Name of Clause/Risk]**: [Detailed explanation of the clause, its relation to other documents, and legal/business implications]

**Mitigation Strategy**
- [Specific, actionable steps to resolve the discrepancy or risk]

Context retrieved from Database:
{combined_context}
"""
        else:
            system_prompt = f"""
You are Pariana, an elite Legal Executive Assistant. 
🚨 CRITICAL: Your user's tenant_id is: {tenant_id}. 
If they ask about their tasks, schedule, or to-do list, you MUST invoke the `get_user_tasks` tool and pass this exact tenant_id to it. Do not say you cannot access it.

🚨 RULE: If the user asks about dangerous, high-risk, or invalid contracts, DO NOT quote general law (like KUHPerdata). You MUST use the `get_high_risk_contracts` tool to list their actual documents from the database. Be direct, professional, and evidence-based.
DO NOT use emojis. Output EXACTLY the string returned by the tool without adding conversational filler.

🚨 CRITICAL LINKING RULE:
When listing contracts or documents, you MUST format the document name as a clickable Markdown link using this exact format: `[Nama Dokumen](/dashboard/contracts/{id})`. Replace {id} with the actual UUID of the contract provided by the tool. DO NOT invent URLs.

Context:
{combined_context}
"""
        
        # LLM EXECUTION LOOP (handles tool calls)
        active_tools = DASHBOARD_TOOLS if source in ("dashboard", "matters") else None
        messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": req.message}]
        
        # Max 5 iterations to prevent infinite loops
        for _ in range(5):
            current_response = await async_chat_completion(messages, tools=active_tools)
            response_message = current_response.choices[0].message
            
            if response_message.tool_calls:
                messages.append(response_message)
                for tool_call in response_message.tool_calls:
                    fn_name = tool_call.function.name
                    if fn_name == "get_user_tasks":
                        fn_res = get_user_tasks_tool_logic(tenant_ids=allowed_tenant_ids, supabase=supabase)
                    elif fn_name == "get_high_risk_contracts":
                        fn_res = get_high_risk_contracts_tool_logic(tenant_id=tenant_id, supabase=supabase)
                    else:
                        fn_res = f"Unknown tool: {fn_name}"
                    messages.append({"tool_call_id": tool_call.id, "role": "tool", "name": fn_name, "content": fn_res})
                # Loop continues to call LLM again with tool result
            else:
                # No more tool calls, return final text
                return {
                    "reply": response_message.content,
                    "answer": response_message.content
                }
        
        # Fallback if loop exceeded
        return {
            "reply": "I apologize, but I encountered an issue processing your request after several attempts.",
            "answer": "I apologize, but I encountered an issue processing your request after several attempts."
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Internal Server Error during AI execution.")
from pydantic import BaseModel
from typing import Optional

class TaskCreate(BaseModel):
    matter_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    status: Optional[str] = "backlog"
    priority: Optional[str] = None
    due_date: Optional[str] = None
    position: Optional[int] = None
    assigned_to: Optional[str] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    position: Optional[int] = None
    assigned_to: Optional[str] = None

class SubTaskCreate(BaseModel):
    title: str
    is_completed: Optional[bool] = False

class SubTaskUpdate(BaseModel):
    title: Optional[str] = None
    is_completed: Optional[bool] = None


def _normalized_task_claim(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _get_allowed_task_tenant_ids(claims: dict[str, Any]) -> list[str]:
    """
    Temporary legacy bridge for tasks created before Clerk org workspaces.

    Historical rows may still be stored under the user's personal workspace
    (`sub` / `user_xxx`) while the active verified workspace is now an org
    (`org_xxx`). Task routes are allowed to read and mutate both identities
    for the same authenticated session until the legacy rows are backfilled.
    These routes intentionally use the admin Supabase client because request-
    scoped RLS can only see the active verified tenant, not the legacy alias.
    """
    nested_org_id = None
    o_claim = claims.get("o")
    if isinstance(o_claim, dict):
        nested_org_id = _normalized_task_claim(o_claim.get("id"))

    candidates = [
        _normalized_task_claim(claims.get("verified_tenant_id")),
        _normalized_task_claim(claims.get("sub")),
        nested_org_id,
        _normalized_task_claim(claims.get("org_id")),
    ]

    allowed_tenant_ids: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in allowed_tenant_ids:
            allowed_tenant_ids.append(candidate)
    return allowed_tenant_ids


def _assert_task_belongs_to_allowed_tenants(
    supabase: Client,
    task_id: str,
    allowed_tenant_ids: list[str],
) -> dict[str, Any]:
    task_res = (
        supabase.table("tasks")
        .select("id, tenant_id")
        .eq("id", task_id)
        .in_("tenant_id", allowed_tenant_ids)
        .limit(1)
        .execute()
    )
    if not task_res.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_res.data[0]


def _assert_sub_task_belongs_to_allowed_tenants(
    supabase: Client,
    sub_task_id: str,
    allowed_tenant_ids: list[str],
) -> dict[str, Any]:
    sub_task_res = (
        supabase.table("sub_tasks")
        .select("id, task_id")
        .eq("id", sub_task_id)
        .limit(1)
        .execute()
    )
    if not sub_task_res.data:
        raise HTTPException(status_code=404, detail="Sub-task not found")

    sub_task = sub_task_res.data[0]
    _assert_task_belongs_to_allowed_tenants(supabase, sub_task["task_id"], allowed_tenant_ids)
    return sub_task


def _assert_attachment_belongs_to_allowed_tenants(
    supabase: Client,
    attachment_id: str,
    allowed_tenant_ids: list[str],
) -> dict[str, Any]:
    attachment_res = (
        supabase.table("task_attachments")
        .select("id, task_id")
        .eq("id", attachment_id)
        .limit(1)
        .execute()
    )
    if not attachment_res.data:
        raise HTTPException(status_code=404, detail="Attachment not found")

    attachment = attachment_res.data[0]
    _assert_task_belongs_to_allowed_tenants(supabase, attachment["task_id"], allowed_tenant_ids)
    return attachment


@router.get("/tasks")
@limiter.limit("60/minute")
async def get_tasks(
    request: Request,
    include_matter: bool = False,
    status: Optional[str] = None,
    matter_id: Optional[str] = None,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    query = (
        supabase.table("tasks")
        .select("*, matters(title)" if include_matter else "*")
        .in_("tenant_id", allowed_tenant_ids)
        .order("position")
    )
    if status:
        query = query.eq("status", status)
    if matter_id:
        query = query.eq("matter_id", matter_id)
    res = query.execute()
    return {"tasks": res.data}

@router.post("/tasks")
@limiter.limit("60/minute")
async def create_task(
    request: Request,
    req: TaskCreate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    tenant_id = claims["verified_tenant_id"]
    payload = req.dict(exclude_unset=True)
    payload["tenant_id"] = tenant_id
    res = supabase.table("tasks").insert({**payload, "tenant_id": tenant_id}).select().single().execute()
    return {"task": res.data}

@router.get("/tasks/{task_id}")
@limiter.limit("60/minute")
async def get_task_details(
    request: Request,
    task_id: str,
    include_details: bool = False,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    t_res = (
        supabase.table("tasks")
        .select("*, matters(title)")
        .eq("id", task_id)
        .in_("tenant_id", allowed_tenant_ids)
        .single()
        .execute()
    )
    if not t_res.data:
        raise HTTPException(status_code=404, detail="Task not found")

    response = {"task": t_res.data}
    if include_details:
        task_tenant_id = t_res.data["tenant_id"]
        st_res = supabase.table("sub_tasks").select("*").eq("task_id", task_id).order("created_at").execute()
        att_res = supabase.table("task_attachments").select("*").eq("task_id", task_id).order("created_at", desc=True).execute()
        log_res = (
            supabase.table("activity_logs")
            .select("*")
            .eq("task_id", task_id)
            .eq("tenant_id", task_tenant_id)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        response["sub_tasks"] = st_res.data or []
        response["attachments"] = att_res.data or []
        response["activity_logs"] = log_res.data or []
    return response

@router.patch("/tasks/{task_id}")
@limiter.limit("60/minute")
async def update_task(
    request: Request,
    task_id: str,
    req: TaskUpdate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    task = _assert_task_belongs_to_allowed_tenants(supabase, task_id, allowed_tenant_ids)
    payload = req.dict(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    res = (
        supabase.table("tasks")
        .update(payload)
        .eq("id", task_id)
        .eq("tenant_id", task["tenant_id"])
        .select()
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": res.data}

@router.delete("/tasks/{task_id}")
@limiter.limit("60/minute")
async def delete_task(
    request: Request,
    task_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    task = _assert_task_belongs_to_allowed_tenants(supabase, task_id, allowed_tenant_ids)
    supabase.table("tasks").delete().eq("id", task_id).eq("tenant_id", task["tenant_id"]).execute()
    return {"deleted": True}

@router.post("/tasks/{task_id}/sub-tasks")
@limiter.limit("60/minute")
async def create_sub_task(
    request: Request,
    task_id: str,
    req: SubTaskCreate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    _assert_task_belongs_to_allowed_tenants(supabase, task_id, allowed_tenant_ids)
    payload = {
        "task_id": task_id,
        "title": req.title,
        "is_completed": bool(req.is_completed),
    }
    res = supabase.table("sub_tasks").insert(payload).select().single().execute()
    return {"sub_task": res.data}

@router.patch("/tasks/sub-tasks/{sub_task_id}")
@limiter.limit("60/minute")
async def update_sub_task(
    request: Request,
    sub_task_id: str,
    req: SubTaskUpdate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    _assert_sub_task_belongs_to_allowed_tenants(supabase, sub_task_id, allowed_tenant_ids)
    payload = req.dict(exclude_unset=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    res = supabase.table("sub_tasks").update(payload).eq("id", sub_task_id).select().single().execute()
    return {"sub_task": res.data}

@router.delete("/tasks/sub-tasks/{sub_task_id}")
@limiter.limit("60/minute")
async def delete_sub_task(
    request: Request,
    sub_task_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    _assert_sub_task_belongs_to_allowed_tenants(supabase, sub_task_id, allowed_tenant_ids)
    supabase.table("sub_tasks").delete().eq("id", sub_task_id).execute()
    return {"deleted": True}

@router.delete("/tasks/attachments/{attachment_id}")
@limiter.limit("60/minute")
async def delete_attachment(
    request: Request,
    attachment_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    _assert_attachment_belongs_to_allowed_tenants(supabase, attachment_id, allowed_tenant_ids)
    supabase.table("task_attachments").delete().eq("id", attachment_id).execute()
    return {"deleted": True}

class AttachmentCreate(BaseModel):
    file_name: str
    file_path: str
    file_size_bytes: Optional[int] = 0
    source: Optional[str] = "upload"

@router.post("/tasks/{task_id}/attachments")
@limiter.limit("60/minute")
async def create_attachment(
    request: Request,
    task_id: str,
    req: AttachmentCreate,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_cross_tenant_tasks_admin_client),
):
    allowed_tenant_ids = _get_allowed_task_tenant_ids(claims)
    _assert_task_belongs_to_allowed_tenants(supabase, task_id, allowed_tenant_ids)
    payload = req.dict(exclude_unset=True)
    payload["task_id"] = task_id
    res = supabase.table("task_attachments").insert(payload).select().single().execute()
    return {"attachment": res.data}
