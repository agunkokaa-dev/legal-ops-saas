from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from supabase import Client

from app.dependencies import get_tenant_supabase, verify_clerk_token
from app.config import admin_supabase, openai_client

from app.bilingual_schemas import (
    ClauseSyncRequest,
    ClauseSyncResponse,
    ClauseUpdateRequest,
    ClauseCreateRequest
)
from app.bilingual_agent import run_bilingual_consistency_agent
from app.rate_limiter import limiter
from app.task_logger import TaskLogger
import io

router = APIRouter()


def assemble_bilingual_contract_texts(
    contract_id: str,
    tenant_id: str,
    supabase_client: Optional[Client] = None,
) -> tuple[str, str, list[dict]]:
    if supabase_client is None:
        # AUDITED: Requires service-role only for shared internal/background callers without request context.
        supabase_client = admin_supabase
    clauses_res = supabase_client.table("bilingual_clauses").select("*") \
        .eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "active").execute()
    clauses = clauses_res.data or []
    clauses.sort(key=lambda c: float(c.get("clause_number", "0") or "0"))

    id_text_blocks = []
    en_text_blocks = []
    for clause in clauses:
        if clause.get("id_text"):
            id_text_blocks.append(f"Pasal {clause['clause_number']}\n{clause['id_text']}")
        if clause.get("en_text"):
            en_text_blocks.append(f"Clause {clause['clause_number']}\n{clause['en_text']}")

    return "\n\n".join(id_text_blocks), "\n\n".join(en_text_blocks), clauses


def generate_bilingual_pdf_bytes(
    contract_id: str,
    tenant_id: str,
    supabase_client: Optional[Client] = None,
) -> bytes:
    if supabase_client is None:
        # AUDITED: Requires service-role only for shared internal/background callers without request context.
        supabase_client = admin_supabase
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
    except ImportError:
        raise HTTPException(status_code=500, detail="ReportLab is not installed correctly.")

    contract_res = supabase_client.table("contracts").select("title, parties") \
        .eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    if not contract_res.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract_title = contract_res.data[0].get("title", "Bilingual_Contract")
    parties = contract_res.data[0].get("parties") or {}
    party_a = parties.get("party_a", "[Party A Name]")
    party_b = parties.get("party_b", "[Party B Name]")

    _, _, clauses = assemble_bilingual_contract_texts(contract_id, tenant_id, supabase_client)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=30)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(name='TitleStyle', parent=styles['Heading1'], alignment=1, spaceAfter=20)
    normal_id = ParagraphStyle(name='NormalID', parent=styles['Normal'], fontSize=10, leading=14)
    normal_en = ParagraphStyle(name='NormalEN', parent=styles['Normal'], fontSize=10, leading=14, textColor=colors.darkslategray)

    elements = [Paragraph(contract_title, title_style), Spacer(1, 12)]
    table_data = [[
        Paragraph("<b>Bahasa Indonesia</b>", normal_id),
        Paragraph("<b>English</b>", normal_en),
    ]]

    for clause in clauses:
        id_para = Paragraph(
            f"<b>Pasal {clause['clause_number']}</b><br/>" + (clause.get('id_text', '') or '').replace('\n', '<br/>'),
            normal_id,
        )
        en_para = Paragraph(
            f"<b>Clause {clause['clause_number']}</b><br/>" + (clause.get('en_text', '') or '').replace('\n', '<br/>'),
            normal_en,
        )
        table_data.append([id_para, en_para])

    table = Table(table_data, colWidths=['50%', '50%'])
    table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ('LINEBELOW', (0, 0), (-1, 0), 1, colors.black),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 30))

    sig_table = Table([
        [Paragraph(f"<b>{party_a}</b>", normal_id), Paragraph(f"<b>{party_b}</b>", normal_id)],
        [Spacer(1, 60), Spacer(1, 60)],
        [Paragraph("[Title]<br/>Date: _________________", normal_id), Paragraph("[Title]<br/>Date: _________________", normal_id)],
    ], colWidths=['50%', '50%'])
    sig_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ]))
    elements.append(sig_table)

    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()


@router.get("/{contract_id}/clauses")
@limiter.limit("60/minute")
async def get_clauses(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    contract = supabase.table("contracts").select("id") \
        .eq("id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .execute()
    if not contract.data:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    try:
        res = supabase.table("bilingual_clauses").select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .eq("status", "active") \
            .execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{contract_id}/clauses")
@limiter.limit("60/minute")
async def create_clause(
    request: Request,
    contract_id: str,
    payload: ClauseCreateRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    contract = supabase.table("contracts").select("id") \
        .eq("id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .execute()
    if not contract.data:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    try:
        new_clause = {
            "contract_id": contract_id,
            "tenant_id": tenant_id,
            "clause_number": payload.clause_number,
            "id_text": "",
            "en_text": "",
            "sync_status": "synced"
        }
        res = supabase.table("bilingual_clauses").insert({**new_clause, "tenant_id": tenant_id}).execute()
        return {"status": "success", "data": res.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{contract_id}/sync-clause")
@limiter.limit("10/minute")
async def sync_clause(
    request: Request,
    contract_id: str,
    payload: ClauseSyncRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    contract = supabase.table("contracts").select("id") \
        .eq("id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .execute()
    if not contract.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    
    try:
        _logger = TaskLogger(tenant_id=tenant_id, task_type="bilingual_sync", contract_id=contract_id)
        if payload.source_language == "id":
             target_language = "English"
             origin = "Indonesian"
        else:
             target_language = "Indonesian (Bahasa Indonesia)"
             origin = "English"
             
        system_prompt = (
            f"You are a bilingual legal translator expert in Indonesian Law No. 24/2009. "
            f"Translate the {origin} clause to {target_language}. "
            f"Ensure semantic consistency and legal equivalence. "
            f"Return your output strictly complying to the JSON schema."
        )
        
        response = openai_client.beta.chat.completions.parse(
             model="gpt-4o",
             messages=[
                  {"role": "system", "content": system_prompt},
                  {"role": "user", "content": payload.source_text}
             ],
             response_format=ClauseSyncResponse
        )
        result = response.choices[0].message.parsed
        _logger.complete(result_summary={"translated_to": target_language})
        return result
        
    except Exception as e:
        if '_logger' in locals(): _logger.fail(e)
        print(f"Error in sync-clause: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{contract_id}/validate-consistency")
@limiter.limit("5/minute")
async def validate_consistency(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    contract_res = supabase.table("contracts").select("id").eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    if not contract_res.data:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    clauses_res = supabase.table("bilingual_clauses").select("*").eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "active").execute()
    clauses = clauses_res.data
    clauses.sort(key=lambda c: float(c.get("clause_number", "0") or "0"))

    if not clauses:
        raise HTTPException(status_code=400, detail="No active clauses to validate")
        
    try:
        _logger = TaskLogger(tenant_id=tenant_id, task_type="bilingual_validate", contract_id=contract_id)
        report = run_bilingual_consistency_agent(clauses)
        _logger.complete(result_summary={"clauses_checked": len(clauses)})
        return {"status": "success", "data": report.model_dump()}
    except Exception as e:
        if '_logger' in locals(): _logger.fail(e)
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{contract_id}/clause/{clause_id}")
@limiter.limit("30/minute")
async def patch_clause(
    request: Request,
    contract_id: str,
    clause_id: str,
    payload: ClauseUpdateRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]
    
    contract = supabase.table("contracts").select("id") \
        .eq("id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .execute()
    if not contract.data:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    updates = {}
    if payload.id_text is not None:
        updates["id_text"] = payload.id_text
    if payload.en_text is not None:
        updates["en_text"] = payload.en_text
        
    if payload.id_text is not None and payload.en_text is not None:
        updates["sync_status"] = "synced"
        updates["last_synced_at"] = datetime.utcnow().isoformat()
        updates["edited_language"] = "both"
    elif payload.id_text is not None:
        updates["sync_status"] = "out_of_sync"
        updates["edited_language"] = "id"
    elif payload.en_text is not None:
        updates["sync_status"] = "out_of_sync"
        updates["edited_language"] = "en"
        
    if not updates:
        return {"status": "no_updates"}
        
    try:
        res = supabase.table("bilingual_clauses").update(updates) \
            .eq("id", clause_id) \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .execute()
            
        if not res.data:
            raise HTTPException(status_code=404, detail="Clause not found or update failed")
        
        return {"status": "success", "data": res.data[0]}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{contract_id}/finalize")
@limiter.limit("10/minute")
async def finalize_contract(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    contract_res = supabase.table("contracts").select("id, latest_version_id, draft_revisions").eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    if not contract_res.data:
        raise HTTPException(status_code=404, detail="Contract not found")
    
    contract = contract_res.data[0]
    
    full_id_text, full_en_text, _clauses = assemble_bilingual_contract_texts(contract_id, tenant_id, supabase)
    
    if contract.get("latest_version_id"):
        supabase.table("contract_versions").update({
            "id_raw_text": full_id_text,
            "en_raw_text": full_en_text,
        }).eq("id", contract["latest_version_id"]).eq("tenant_id", tenant_id).execute()
        
    draft_revisions = contract.get("draft_revisions") or {}
    draft_revisions["id_text"] = full_id_text
    draft_revisions["en_text"] = full_en_text
    
    supabase.table("contracts").update({
        "draft_revisions": draft_revisions
    }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    
    return {"status": "success", "message": "Contract finalized"}

@router.get("/{contract_id}/export-pdf")
@limiter.limit("10/minute")
async def export_pdf(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    contract_res = supabase.table("contracts").select("title") \
        .eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    if not contract_res.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    contract_title = contract_res.data[0].get("title", "Bilingual_Contract")
    buffer = io.BytesIO(generate_bilingual_pdf_bytes(contract_id, tenant_id, supabase))
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=\"{contract_title}.pdf\""}
    )
