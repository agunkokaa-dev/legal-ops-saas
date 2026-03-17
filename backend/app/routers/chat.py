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

from fastapi import APIRouter, Form, HTTPException, Depends
from supabase import Client
from qdrant_client.http.models import Filter, FieldCondition, MatchValue
from qdrant_client import models

from app.config import openai_client, qdrant, COLLECTION_NAME
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import ClauseAssistantRequest

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


async def async_chat_completion(messages: list, tools=None, tool_choice=None) -> any:
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

        valid_contracts = {}
        if contract_ids:
            try:
                supabase_response = supabase.table("contracts").select("*").in_("id", contract_ids).execute()
                for record in supabase_response.data:
                    valid_contracts[str(record['id'])] = record
            except Exception as e:
                print(f"Error fetching contract metadata: {e}")

        # 4. Build context & clean ghost data
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

            meta = valid_contracts[contract_id]
            risk_level = meta.get('risk_level', 'Unknown')
            smart_meta = meta.get('smart_metadata', meta.get('metadata', 'None'))
            file_title = meta.get('title', meta.get('file_name', 'Unknown Document'))

            context += f"Sumber Dokumen:\nJudul Dokumen: {file_title}\n"
            context += f"Raw Text: {hit.payload.get('text', '')}\n"
            context += f"LangGraph Risk Assessment: Risk Level: {risk_level}, Metadata: {smart_meta}\n---\n"

            if not any(c['contract_id'] == contract_id for c in citations):
                citations.append({"contract_id": contract_id, "file_name": file_title})

        if not citations:
            return {"answer": "Maaf, seluruh dokumen relevan yang ditemukan sudah dihapus dari sistem (Ghost Data).", "citations": []}

        # 5. LLM Call (NON-BLOCKING)
        system_prompt = f"""Anda adalah CLAUSE, Manajer Portofolio Hukum AI (AI Legal Portfolio Manager) tingkat Enterprise yang sangat profesional, sopan, dan analitis.
        Tugas Anda adalah merangkum, mengevaluasi, dan membandingkan informasi dari KESELURUHAN DOKUMEN yang diberikan di konteks.
        Jawablah pertanyaan secara general dan komprehensif.

        PANDUAN MENJAWAB:
        1. Jika pengguna bertanya tentang "risiko", SELALU identifikasi dan urutkan berdasarkan 'Risk Level'.
        2. Jika seluruh dokumen berisiko rendah, berikan ringkasan manajerial profesional.
        3. Jika informasi tidak tertuang dalam teks, jawab dengan sopan.
        4. Gunakan bahasa Indonesia yang baku, terstruktur, elegan, dan berorientasi pada eksekutif.

        KONTEKS DOKUMEN:
        {context}"""

        response = await async_chat_completion([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question}
        ])

        return {
            "answer": response.choices[0].message.content,
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
                response = supabase.table("contracts").select("id").eq("matter_id", request.matterId).execute()
                if response.data:
                    contract_ids_to_search = [record["id"] for record in response.data]
            except Exception as e:
                print(f"Failed to fetch lineage: {e}")

        if not contract_ids_to_search:
            contract_ids_to_search = [request.contractId]

        # Fetch titles
        contract_titles = {}
        try:
            resp = supabase.table("contracts").select("id, title").in_("id", contract_ids_to_search).execute()
            if resp.data:
                for record in resp.data:
                    contract_titles[record["id"]] = record.get("title", "Unknown Document")
        except Exception as e:
            print(f"Failed to fetch contract titles: {e}")

        # 2. Fetch Historical Context (Agent Analysis)
        historical_context = ""
        try:
            clauses_resp = supabase.table("contract_clauses").select("*").in_("contract_id", contract_ids_to_search).execute()
            if clauses_resp.data:
                historical_context += "--- HISTORICAL AGENT ANALYSIS (CLAUSES) ---\n"
                for clause in clauses_resp.data:
                    historical_context += f"- [Doc: {clause.get('contract_id')}] Type: {clause.get('clause_type', 'Unknown')} | AI Finding: {clause.get('ai_summary', '')}\n"

            obs_resp = supabase.table("contract_obligations").select("*").in_("contract_id", contract_ids_to_search).execute()
            if obs_resp.data:
                historical_context += "\n--- HISTORICAL AGENT ANALYSIS (OBLIGATIONS) ---\n"
                for ob in obs_resp.data:
                    historical_context += f"- Obligation: {ob.get('description', '')} (Status: {ob.get('status', 'pending')})\n"
        except Exception as err:
            print(f"Failed to fetch historical context: {err}")

        # 3. Embed User Query (NON-BLOCKING)
        question_vector = await async_embed(request.message)

        # 4. Dual RAG Retrieval (NON-BLOCKING, PARALLEL)
        contract_filter = Filter(
            must=[FieldCondition(key="contract_id", match=models.MatchAny(any=contract_ids_to_search))]
        )

        # Run contract search and law search IN PARALLEL
        contract_task = async_qdrant_search(COLLECTION_NAME, question_vector, limit=4, query_filter=contract_filter)
        law_task = async_qdrant_search("id_national_laws", question_vector, limit=2)

        try:
            contract_results, law_results = await asyncio.gather(contract_task, law_task, return_exceptions=True)
            if isinstance(contract_results, Exception):
                contract_results = []
            if isinstance(law_results, Exception):
                law_results = []
        except Exception:
            contract_results, law_results = [], []

        # 5. Assemble Context
        combined_context = "=== KONTEKS KONTRAK (DOKUMEN KLIEN) ===\n"
        if not contract_results:
            combined_context += "Tidak ada klausul yang cocok.\n\n"
        else:
            for hit in contract_results:
                text_snippet = hit.payload.get('text', '')
                doc_id = hit.payload.get('contract_id', 'Unknown')
                doc_name = contract_titles.get(doc_id, "Unknown Document")
                page_match = re.search(r'\[Page (\d+)\]', text_snippet)
                citation_tag = f"[{doc_name}, Hal: {page_match.group(1)}]" if page_match else f"[{doc_name}]"
                combined_context += f"TAG SUMBER: {citation_tag}\nTeks: {text_snippet}\n\n"

        combined_context += "=== KONTEKS HUKUM NASIONAL (INDONESIA) ===\n"
        if not law_results:
            combined_context += "Tidak ada pasal hukum nasional yang cocok.\n\n"
        else:
            for hit in law_results:
                source = hit.payload.get("source_law", "Unknown Law")
                pasal = hit.payload.get("pasal", "Unknown Pasal")
                text = hit.payload.get("text", "")
                combined_context += f"TAG SUMBER: [{source}, Pasal {pasal}]\nTeks: {text}\n\n"

        # 6. System Prompt
        system_prompt = f"""You are an elite Indonesian Corporate Lawyer and Contract Negotiator.
You are provided with two contexts: 'KONTEKS KONTRAK' (client document) and 'KONTEKS HUKUM NASIONAL' (Indonesian laws).

CRITICAL INSTRUCTIONS:
1. Always base your legal analysis on Indonesian Law.
2. Check for cross-references between documents in the matter lineage.
4. CITE your sources inline: [MSA.pdf, Hal: 1] or [KUHPerdata Buku III, Pasal 1320].
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
        response = await async_chat_completion([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.message}
        ])

        return {"reply": response.choices[0].message.content}

    except Exception as e:
        print(f"Clause Assistant Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="An internal error occurred during analysis.")
