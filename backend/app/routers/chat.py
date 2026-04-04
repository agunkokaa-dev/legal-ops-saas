"""
Pariana Backend — Chat & RAG Router (Fully Refactored)

This router handles:
  - POST /api/chat              → Dashboard portfolio-wide RAG chat
  - POST /api/chat/clause-assistant → Contract detail deep-dive RAG chat

All synchronous OpenAI and Qdrant calls are wrapped in `asyncio.to_thread()`
to prevent blocking the FastAPI event loop under concurrent load.

WHY asyncio.to_thread()?
  FastAPI runs on a single-threaded async event loop (uvloop/asyncio).
  When we call `openai_client.embeddings.create(...)`, it's a SYNCHRONOUS
  HTTP request that blocks the thread for 1-4 seconds. During that time,
  NO other request can be processed — the event loop is frozen.
  
  `asyncio.to_thread()` offloads the blocking call to a background thread
  from Python's default ThreadPoolExecutor, freeing the event loop to
  handle other concurrent requests while the LLM call completes.
"""
import asyncio
import re
import traceback
from typing import Any, Dict

from fastapi import APIRouter, Form, HTTPException, Depends
from supabase import Client
from qdrant_client.http.models import Filter, FieldCondition, MatchValue
from qdrant_client import models

from app.config import openai_client, qdrant, COLLECTION_NAME, admin_supabase
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import ClauseAssistantRequest

import os
from dotenv import load_dotenv
load_dotenv()

router = APIRouter()


# =====================================================================
# ASYNC WRAPPERS — Prevent Event Loop Starvation
# =====================================================================

async def async_embed(text: str) -> list[float]:
    """Offloads the synchronous OpenAI embedding call to a background thread."""
    response = await asyncio.to_thread(
        openai_client.embeddings.create,
        input=text,
        model="text-embedding-3-small"
    )
    return response.data[0].embedding


async def async_chat_completion(messages: list, tools=None, tool_choice=None) -> Any:
    """Offloads the synchronous OpenAI chat completion call to a background thread."""
    kwargs = {"model": "gpt-4o-mini", "messages": messages}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice or "auto"
    response = await asyncio.to_thread(
        openai_client.chat.completions.create,
        **kwargs
    )
    return response


async def async_qdrant_search(collection: str, vector: list, limit: int, query_filter=None) -> list:
    """Offloads the synchronous Qdrant query_points call to a background thread (v1.17+ API)."""
    try:
        kwargs = {
            "collection_name": collection,
            "query": vector,
            "limit": limit,
            "with_payload": True,
        }
        if query_filter:
            kwargs["query_filter"] = query_filter
        response = await asyncio.to_thread(qdrant.query_points, **kwargs)
        return response.points  # List[ScoredPoint] with .payload, .score, .id
    except Exception as e:
        import logging
        logging.error(f"🔥 RAG RETRIEVAL CRASHED in chat.py: {str(e)}")
        logging.error(traceback.format_exc())
        return []

async def async_fetch_full_document(contract_id: str, tenant_id: str, max_chars: int = 8000) -> str:
    """Offloads the synchronous Qdrant scroll call to fetch the full document text."""
    try:
        response = await asyncio.to_thread(
            qdrant.scroll,
            collection_name=COLLECTION_NAME,
            scroll_filter=Filter(must=[
                FieldCondition(key="contract_id", match=MatchValue(value=contract_id)),
                FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))
            ]),
            limit=15, # 15 chunks x ~1000 chars = plenty to reach max_chars
            with_payload=True
        )
        points, _ = response
        points = sorted(points, key=lambda p: p.payload.get("chunk_index", 0))
        # PERBAIKAN RAG CITATION
        texts_with_meta = []
        for p in points:
            # Mengambil metadata halaman atau chunk
            page = p.payload.get("page_number", p.payload.get("chunk_index", "Unknown"))
            text_chunk = p.payload.get("text", "")
            texts_with_meta.append(f"[Sumber Dokumen, Bagian/Halaman: {page}]\n{text_chunk}")
            
        full_text = "\n\n".join(texts_with_meta)
        return full_text[:max_chars]
    except Exception as e:
        import logging
        logging.error(f"🔥 RAG SCROLL CRASHED in chat.py: {str(e)}")
        return ""


# =====================================================================
# POST /api/chat — Dashboard Portfolio-Wide RAG Chat
# =====================================================================
@router.post("/chat")
async def chat_with_clause(
    question: str = Form(...),
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]

        # 1. Embed question (NON-BLOCKING)
        question_vector = await async_embed(question)

        # 2. Tenant-isolated vector search (NON-BLOCKING)
        search_results = await async_qdrant_search(
            collection=COLLECTION_NAME,
            vector=question_vector,
            limit=20,
            query_filter=Filter(
                must=[FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))]
            )
        )

        if not search_results:
            return {"answer": "Maaf, saya tidak menemukan dokumen yang relevan di brankas perusahaan Anda untuk menjawab ini.", "citations": []}

        # 3. Ghost Data Handling & Context Enrichment
        contract_ids = list(set([
            str(hit.payload.get('contract_id'))
            for hit in search_results if hit.payload.get('contract_id')
        ]))

        valid_contracts: dict = {}
        if contract_ids:
            try:
                supabase_response = supabase.table("contracts").select("*").in_("id", contract_ids).eq("tenant_id", tenant_id).execute()
                for record in supabase_response.data:
                    valid_contracts[str(record['id'])] = record
            except Exception as e:
                print(f"Error fetching contract metadata: {e}")

        # 3b. GENEALOGY: Fetch parent documents for all found contracts
        parent_context_map: dict = {}  # child_id -> parent metadata & text
        if contract_ids:
            try:
                rels_resp = admin_supabase.table("document_relationships").select("parent_id, child_id, relationship_type").in_("child_id", contract_ids).execute()
                if rels_resp.data:
                    parent_ids = list(set([r["parent_id"] for r in rels_resp.data if r.get("parent_id")]))
                    if parent_ids:
                        # Fetch parent contract metadata — scoped to tenant
                        parent_docs_resp = admin_supabase.table("contracts").select("id, title, risk_level, document_category, contract_value").in_("id", parent_ids).eq("tenant_id", tenant_id).execute()
                        parent_docs = {str(d["id"]): d for d in (parent_docs_resp.data or [])}

                        # Fetch parent vector chunks for context
                        for parent_id in parent_ids:
                            try:
                                parent_chunks = await async_qdrant_search(
                                    collection=COLLECTION_NAME,
                                    vector=question_vector,
                                    limit=3,
                                    query_filter=Filter(must=[FieldCondition(key="contract_id", match=MatchValue(value=parent_id))])
                                )
                                parent_text = "\n".join([c.payload.get("text", "") for c in parent_chunks]) if parent_chunks else "(No text indexed)"
                                parent_meta = parent_docs.get(parent_id, {})
                                parent_context_map[parent_id] = {
                                    "title": parent_meta.get("title", "Unknown Parent"),
                                    "category": parent_meta.get("document_category", "Unknown"),
                                    "risk_level": parent_meta.get("risk_level", "Unknown"),
                                    "text": parent_text
                                }
                            except Exception as pq_err:
                                print(f"Warning: Failed to fetch parent {parent_id} vectors: {pq_err}")

                        # Map children to their parents
                        for rel in rels_resp.data:
                            child_id = rel["child_id"]
                            parent_id = rel["parent_id"]
                            if parent_id in parent_context_map:
                                if child_id not in parent_context_map:
                                    parent_context_map[child_id] = parent_context_map[parent_id]
                print(f"[GENEALOGY] Found {len(parent_context_map)} parent relationships for chat context.")
            except Exception as gen_err:
                print(f"Warning: Genealogy lookup failed: {gen_err}")

        #clean ghost data
        context = ""
        citations = []
        for hit in search_results:
            contract_id = str(hit.payload.get('contract_id'))

            if contract_id not in valid_contracts:
                # Ghost data — schedule async cleanup
                try:
                    await asyncio.to_thread(
                        qdrant.delete,
                        collection_name=COLLECTION_NAME,
                        wait=False,
                        points_selector=models.Filter(
                            must=[models.FieldCondition(key="contract_id", match=models.MatchValue(value=contract_id))]
                        )
                    )
                except Exception:
                    pass
                continue

            meta = valid_contracts.get(contract_id, {})
            risk_level = meta.get('risk_level', 'Unknown')
            smart_meta = meta.get('smart_metadata', meta.get('metadata', 'None'))
            file_title = meta.get('title', meta.get('file_name', 'Unknown Document'))

            context += f"Sumber Dokumen:\nJudul Dokumen: {file_title}\n"
            page = hit.payload.get('page_number', 'Unknown')
            context += f"Raw Text [DOKUMEN: {file_title}, HALAMAN: {page}]: {hit.payload.get('text', '')}\n"
            context += f"LangGraph Risk Assessment: Risk Level: {risk_level}, Metadata: {smart_meta}\n"

            # GENEALOGY: Inject parent document context if this document has a parent
            parent_doc = parent_context_map.get(contract_id)
            if parent_doc:
                context += f"\n⚠️ PARENT DOCUMENT (This document is subordinate to):\n"
                context += f"  Parent Title: {parent_doc.get('title', 'Unknown')}\n"
                context += f"  Parent Category: {parent_doc.get('category', 'Unknown')}\n"
                context += f"  Parent Risk Level: {parent_doc.get('risk_level', 'Unknown')}\n"
                context += f"  Parent Key Text: {str(parent_doc.get('text', ''))[:3000]}\n"

            context += "---\n"

            if not any(c['contract_id'] == contract_id for c in citations):
                citations.append({"contract_id": contract_id, "file_name": file_title})

        if not citations:
            return {"answer": "Maaf, seluruh dokumen relevan yang ditemukan sudah dihapus dari sistem (Ghost Data).", "citations": []}

        # 5. LLM Call (NON-BLOCKING)
        system_prompt = f"""# ROLE
You are "Clause Assistant", a World-Class Senior Legal Consultant and Enterprise CLM (Contract Lifecycle Management) AI inside the "Global Intelligence Vault" platform. Your primary user is a Managing Partner or General Counsel of a top-tier law firm or enterprise.

# TONE & PERSONALITY
- "Silent Luxury": Elegant, authoritative, concise, and highly professional.
- Empathetic but objective: You provide reassurance through data and analytics.
- Action-Oriented: You do not just present data; you analyze it and recommend the next best step.
- Language: Always respond in fluent, formal, yet modern Indonesian (Bahasa Indonesia), unless explicitly asked otherwise.

# STRICT FORMATTING RULES (CRITICAL)
1. NO RAW DATA DUMPS: NEVER output raw database formats (e.g., "id | status | priority" or JSON strings). Translate all machine data into human-readable insights.
2. USE MARKDOWN ELEGANTLY: 
   - Use **Bold** for emphasis on key terms, statuses (e.g., **HIGH RISK**), or task names.
   - Use bullet points (-) or numbered lists (1, 2, 3) to break down multiple items.
   - Use blockquotes (>) for specific legal clauses or executive summaries.
3. HIERARCHY OF INFORMATION: Always structure your response in this exact order:
   - Phase 1: The Executive Summary (1-2 sentences summarizing the overall status).
   - Phase 2: The Breakdown (Categorized lists or bullet points of the data provided).
   - Phase 3: The Next Action (A polite question proposing the next logical step or asking if they need a specific document drafted).
4. ALWAYS CITE YOUR SOURCES: Jika Anda mengambil informasi dari dokumen, Anda WAJIB mengutip sumbernya di akhir kalimat. Contoh: "...sesuai dengan ketentuan pasal tersebut [Sumber Dokumen, Bagian/Halaman: 2]."

# SCENARIO HANDLING
- If Portfolio Status is safe: Reassure the user, but proactively mention Medium/Low risks that might need future attention.
- If handling Tasks (Backlog/To-Do): Group them by Matter or Priority. Do not just list them randomly. Highlight missing deadlines as a potential risk.
- If asked about Legal Clauses: Quote the exact rule from the "Playbook" and provide a strict recommendation (Standard vs. Fallback vs. Walk-away).

# EXAMPLE OF EXPECTED OUTPUT:
User: "Apa tugas saya hari ini?"
AI: 
Anda memiliki 2 tugas aktif di dalam *Backlog* yang membutuhkan perhatian Anda hari ini. 

📋 **Daftar Tugas (Prioritas Medium):**
1. **[test 123]** — *Matter: Kasus Sawit*
2. **[Conduct Initial workflow]** — *Matter: Kasus Sawit*

*Catatan:* Kedua tugas di atas belum memiliki tenggat waktu (*deadline*). Apakah Anda ingin saya menjadwalkannya untuk minggu ini, atau Anda ingin langsung membuka detail tugas pertama?
        KONTEKS DOKUMEN:
        {context}"""

        print("=== DEBUG LLM CONTEXT ===")
        print(context)
        print("=========================")

        response = await async_chat_completion([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question}
        ])

        return {
            "answer": response.choices[0].message.content,
            "reply": response.choices[0].message.content,
            "citations": citations
        }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="An internal error occurred during chat processing.")


# =====================================================================
# POST /api/chat/clause-assistant — Contract Detail Deep-Dive
# =====================================================================
@router.post("/chat/clause-assistant")
async def chat_clause_assistant(
    request: ClauseAssistantRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase)
):
    try:
        tenant_id = claims["verified_tenant_id"]

        # 1. Fetch Contract Lineage (Genealogy)
        contract_ids_to_search = []
        if request.matterId:
            try:
                response = supabase.table("contracts").select("id").eq("matter_id", request.matterId).eq("tenant_id", tenant_id).execute()
                if response.data:
                    contract_ids_to_search = [record["id"] for record in response.data]
            except Exception as e:
                print(f"Failed to fetch lineage: {e}")

        if not contract_ids_to_search:
            contract_ids_to_search = [request.contractId]

        # GENEALOGY: Expand search scope to include parent documents
        genealogy_labels = {}  # contract_id -> label like "PARENT (MSA)" or "PRIMARY"
        try:
            rels_resp = admin_supabase.table("document_relationships").select("parent_id, child_id, relationship_type").in_("child_id", contract_ids_to_search).execute()
            if rels_resp.data:
                parent_ids = [r["parent_id"] for r in rels_resp.data if r.get("parent_id") and r["parent_id"] not in contract_ids_to_search]
                for pid in parent_ids:
                    contract_ids_to_search.append(pid)
                    genealogy_labels[pid] = "PARENT DOCUMENT (MSA/Master Agreement)"
                print(f"[GENEALOGY] Expanded search to include {len(parent_ids)} parent document(s): {parent_ids}")
        except Exception as gen_err:
            print(f"Warning: Genealogy expansion failed: {gen_err}")

        # Mark primary documents
        for cid in contract_ids_to_search:
            if cid not in genealogy_labels:
                genealogy_labels[cid] = "PRIMARY DOCUMENT"

        # Fetch titles
        contract_titles = {}
        try:
            resp = supabase.table("contracts").select("id, title, document_category").in_("id", contract_ids_to_search).eq("tenant_id", tenant_id).execute()
            if resp.data:
                for record in resp.data:
                    contract_titles[record["id"]] = record.get("title", "Unknown Document")
        except Exception as e:
            print(f"Failed to fetch contract titles: {e}")

        # 2. Fetch Historical Context (Agent Analysis)
        historical_context = ""
        try:
            clauses_resp = supabase.table("contract_clauses").select("*").in_("contract_id", contract_ids_to_search).eq("tenant_id", tenant_id).execute()
            if clauses_resp.data:
                historical_context += "--- HISTORICAL AGENT ANALYSIS (CLAUSES) ---\n"
                for clause in clauses_resp.data:
                    historical_context += f"- [Doc: {clause.get('contract_id')}] Type: {clause.get('clause_type', 'Unknown')} | AI Finding: {clause.get('ai_summary', '')}\n"

            obs_resp = supabase.table("contract_obligations").select("*").in_("contract_id", contract_ids_to_search).eq("tenant_id", tenant_id).execute()
            if obs_resp.data:
                historical_context += "\n--- HISTORICAL AGENT ANALYSIS (OBLIGATIONS) ---\n"
                for ob in obs_resp.data:
                    historical_context += f"- Obligation: {ob.get('description', '')} (Status: {ob.get('status', 'pending')})\n"
        except Exception as err:
            print(f"Failed to fetch historical context: {err}")

        # 3. Embed User Query (NON-BLOCKING)
        question_vector = await async_embed(request.message)

        # 4. Dual RAG Retrieval (NON-BLOCKING, PARALLEL)
        # SECURITY: Contract filter must include tenant_id to prevent cross-tenant vector access
        contract_filter = Filter(
            must=[
                FieldCondition(key="contract_id", match=models.MatchAny(any=contract_ids_to_search)),
                FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))
            ]
        )

        # Run contract search, law search, and playbook search IN PARALLEL
        contract_task = async_qdrant_search(COLLECTION_NAME, question_vector, limit=4, query_filter=contract_filter)
        law_task = async_qdrant_search("id_national_laws", question_vector, limit=2)
        playbook_task = async_qdrant_search(
            "company_rules", question_vector, limit=3,
            query_filter=Filter(must=[FieldCondition(key="user_id", match=MatchValue(value=tenant_id))])
        )

        try:
            contract_results, law_results, playbook_results = await asyncio.gather(
                contract_task, law_task, playbook_task, return_exceptions=True
            )
            if isinstance(contract_results, BaseException):
                contract_results = []
            if isinstance(law_results, BaseException):
                law_results = []
            if isinstance(playbook_results, BaseException):
                playbook_results = []
        except Exception:
            contract_results, law_results, playbook_results = [], [], []

        # 5. Assemble Context
        combined_context = ""
        
        # We need the full text for primary and parent docs.
        primary_docs = [cid for cid, label in genealogy_labels.items() if "PRIMARY" in label]
        parent_docs = [cid for cid, label in genealogy_labels.items() if "PARENT" in label]
        
        try:
            # Fetch full text concurrently
            primary_tasks = [async_fetch_full_document(cid, tenant_id) for cid in primary_docs]
            parent_tasks = [async_fetch_full_document(cid, tenant_id) for cid in parent_docs]
            
            primary_texts = await asyncio.gather(*primary_tasks)
            parent_texts = await asyncio.gather(*parent_tasks)
            
            for cid, text in zip(primary_docs, primary_texts):
                combined_context += "=== PRIMARY DOCUMENT (SOW/Child) ===\n"
                combined_context += f"Title: {contract_titles.get(cid, 'Unknown Document')}\n"
                combined_context += f"Content: {text}\n\n"
                
            for cid, text in zip(parent_docs, parent_texts):
                combined_context += "=== PARENT DOCUMENT (MSA/Master) ===\n"
                combined_context += f"Title: {contract_titles.get(cid, 'Unknown Document')}\n"
                combined_context += f"Content: {text}\n\n"
        except Exception as e:
            print(f"Error fetching full document texts: {e}")

        combined_context += "=== KONTEKS HUKUM NASIONAL (INDONESIA) ===\n"
        if not law_results:
            combined_context += "Tidak ada pasal hukum nasional yang cocok.\n\n"
        else:
            for hit in law_results:
                source = hit.payload.get("source_law", "Unknown Law")
                pasal = hit.payload.get("pasal", "Unknown Pasal")
                text = hit.payload.get("text", "")
                combined_context += f"TAG SUMBER: [{source}, Pasal {pasal}]\nTeks: {text}\n\n"

        # Inject real-time playbook rules
        combined_context += "=== ATURAN PERUSAHAAN SAAT INI (PLAYBOOK) ===\n"
        if not playbook_results:
            combined_context += "Tidak ada aturan playbook yang relevan ditemukan.\n\n"
        else:
            for hit in playbook_results:
                p = hit.payload
                combined_context += (
                    f"- Kategori: {p.get('category', 'N/A')}\n"
                    f"  Standard Position: {p.get('standard_position', 'N/A')}\n"
                    f"  Fallback (Compromise): {p.get('fallback_position', 'Tidak ada')}\n"
                    f"  Redline (Walk-away): {p.get('redline', 'Tidak ada')}\n"
                    f"  Severity: {p.get('risk_severity', 'N/A')}\n\n"
                )

        combined_context += "CRITICAL INSTRUCTION FOR AI: You now have BOTH documents in their exact raw text form. Do not guess. If the user asks about conflicts (e.g., payment terms), compare the Primary Document directly against the Parent Document above.\n"

        # 6. System Prompt
        system_prompt = f"""You are an elite Indonesian Corporate Lawyer and Contract Negotiator.
You are provided with three contexts: 'KONTEKS KONTRAK' (client document), 'KONTEKS HUKUM NASIONAL' (Indonesian laws), and 'ATURAN PERUSAHAAN SAAT INI (PLAYBOOK)' (company compliance rules).

CRITICAL INSTRUCTIONS:
1. Always base your legal analysis on Indonesian Law.
2. Check for cross-references between documents in the matter lineage.
3. Jika pertanyaan pengguna berkaitan dengan batas toleransi, denda, atau kebijakan, Anda WAJIB merujuk pada bagian [ATURAN PERUSAHAAN SAAT INI (PLAYBOOK)]. Laporkan jika dokumen melanggar 'Redline' atau tidak sesuai dengan 'Standard Position'.
4. WAJIB KUTIP SUMBER: Setiap kali Anda mengambil fakta/pasal dari dokumen, Anda WAJIB mengakhiri kalimat dengan [DOKUMEN: Nama File, HALAMAN: X]. JANGAN MENGARANG HALAMAN JIKA TIDAK ADA.
5. Format using clean Markdown with bold, bullet points, and numbered lists.
6. Answer in professional Indonesian, maintaining legal terminology.

HISTORICAL AGENT DATA:
{historical_context}

DRAFTING/REVISING LOGIC:
If drafting or revising, follow this format:
**THE ORIGINAL CLAUSE:** [Quote]
**THE PROPOSED REVISION:** [Rewrite] *(Legal reasoning)*
**THE COUNTER-ARGUMENT:** *(Risk mitigation)*

Context:
{combined_context}
"""

        # 7. Generate Response (NON-BLOCKING)
        print("=== DEBUG LLM CONTEXT ===")
        print(combined_context)
        print("=========================")
        response = await async_chat_completion([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.message}
        ])

        return {
            "reply": response.choices[0].message.content,
            "answer": response.choices[0].message.content
        }

    except Exception as e:
        print(f"Clause Assistant Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="An internal error occurred during analysis.")
