import time
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from app.dependencies import verify_clerk_token
from app.config import admin_supabase, openai_client

from app.bilingual_schemas import (
    ClauseSyncRequest,
    ClauseSyncResponse,
    ClauseUpdateRequest,
    ClauseCreateRequest
)
from app.bilingual_agent import run_bilingual_consistency_agent
import io

router = APIRouter()

# WARNING: in-memory counter, resets on container restart.
# Replace with persistent store before public launch.
rate_limit_store = {}
RATE_LIMIT_WINDOW_SEC = 60
RATE_LIMIT_MAX_REQUESTS = 20

def check_rate_limit(tenant_id: str):
    now = time.time()
    if tenant_id not in rate_limit_store:
        rate_limit_store[tenant_id] = []
    
    # Prune old requests
    rate_limit_store[tenant_id] = [req_time for req_time in rate_limit_store[tenant_id] if now - req_time < RATE_LIMIT_WINDOW_SEC]
    
    if len(rate_limit_store[tenant_id]) >= RATE_LIMIT_MAX_REQUESTS:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again in a minute.")
    
    rate_limit_store[tenant_id].append(now)

@router.get("/{contract_id}/clauses")
async def get_clauses(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]

    contract = admin_supabase.table("contracts").select("id") \
        .eq("id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .execute()
    if not contract.data:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    try:
        res = admin_supabase.table("bilingual_clauses").select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .eq("status", "active") \
            .execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{contract_id}/clauses")
async def create_clause(
    contract_id: str,
    payload: ClauseCreateRequest,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]

    contract = admin_supabase.table("contracts").select("id") \
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
        res = admin_supabase.table("bilingual_clauses").insert({**new_clause, "tenant_id": tenant_id}).execute()
        return {"status": "success", "data": res.data[0]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{contract_id}/sync-clause")
async def sync_clause(
    contract_id: str,
    payload: ClauseSyncRequest,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]

    contract = admin_supabase.table("contracts").select("id") \
        .eq("id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .execute()
    if not contract.data:
        raise HTTPException(status_code=404, detail="Contract not found")

    check_rate_limit(tenant_id)
    
    try:
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
        return response.choices[0].message.parsed
        
    except Exception as e:
        print(f"Error in sync-clause: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{contract_id}/validate-consistency")
async def validate_consistency(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]

    contract_res = admin_supabase.table("contracts").select("id").eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    if not contract_res.data:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    clauses_res = admin_supabase.table("bilingual_clauses").select("*").eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "active").execute()
    clauses = clauses_res.data
    clauses.sort(key=lambda c: float(c.get("clause_number", "0") or "0"))

    if not clauses:
        raise HTTPException(status_code=400, detail="No active clauses to validate")
        
    try:
        report = run_bilingual_consistency_agent(clauses)
        return {"status": "success", "data": report.model_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{contract_id}/clause/{clause_id}")
async def patch_clause(
    contract_id: str,
    clause_id: str,
    payload: ClauseUpdateRequest,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]
    
    contract = admin_supabase.table("contracts").select("id") \
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
        res = admin_supabase.table("bilingual_clauses").update(updates) \
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
async def finalize_contract(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]

    contract_res = admin_supabase.table("contracts").select("id, latest_version_id, draft_revisions").eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    if not contract_res.data:
        raise HTTPException(status_code=404, detail="Contract not found")
    
    contract = contract_res.data[0]
    
    clauses_res = admin_supabase.table("bilingual_clauses").select("*").eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "active").execute()
    clauses = clauses_res.data
    clauses.sort(key=lambda c: float(c.get("clause_number", "0") or "0"))
    
    id_text_blocks = []
    en_text_blocks = []
    
    for c in clauses:
        if c.get("id_text"):
            id_text_blocks.append(f"Pasal {c['clause_number']}\n{c['id_text']}")
        if c.get("en_text"):
            en_text_blocks.append(f"Clause {c['clause_number']}\n{c['en_text']}")
            
    full_id_text = "\n\n".join(id_text_blocks)
    full_en_text = "\n\n".join(en_text_blocks)
    
    if contract.get("latest_version_id"):
        admin_supabase.table("contract_versions").update({
            "id_raw_text": full_id_text,
            "en_raw_text": full_en_text,
        }).eq("id", contract["latest_version_id"]).eq("tenant_id", tenant_id).execute()
        
    draft_revisions = contract.get("draft_revisions") or {}
    draft_revisions["id_text"] = full_id_text
    draft_revisions["en_text"] = full_en_text
    
    admin_supabase.table("contracts").update({
        "draft_revisions": draft_revisions
    }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    
    return {"status": "success", "message": "Contract finalized"}

@router.get("/{contract_id}/export-pdf")
async def export_pdf(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    tenant_id = claims["verified_tenant_id"]

    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib import colors
    except ImportError:
        raise HTTPException(status_code=500, detail="ReportLab is not installed correctly.")

    contract_res = admin_supabase.table("contracts").select("title, parties").eq("id", contract_id).eq("tenant_id", tenant_id).execute()
    if not contract_res.data:
        raise HTTPException(status_code=404, detail="Contract not found")
        
    contract_title = contract_res.data[0].get("title", "Bilingual_Contract")
    # Metadata fallback extraction wrapper
    parties = contract_res.data[0].get("parties") or {}
    party_a = parties.get("party_a", "[Party A Name]")
    party_b = parties.get("party_b", "[Party B Name]")
        
    clauses_res = admin_supabase.table("bilingual_clauses").select("*").eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "active").execute()
    clauses = clauses_res.data
    clauses.sort(key=lambda c: float(c.get("clause_number", "0") or "0"))

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=30)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        name='TitleStyle',
        parent=styles['Heading1'],
        alignment=1,
        spaceAfter=20,
    )
    
    normal_id = ParagraphStyle(name='NormalID', parent=styles['Normal'], fontSize=10, leading=14)
    normal_en = ParagraphStyle(name='NormalEN', parent=styles['Normal'], fontSize=10, leading=14, textColor=colors.darkslategray)
    
    elements = []
    elements.append(Paragraph(contract_title, title_style))
    elements.append(Spacer(1, 12))
    
    table_data = []
    table_data.append([
        Paragraph("<b>Bahasa Indonesia</b>", normal_id),
        Paragraph("<b>English</b>", normal_en)
    ])
    
    for c in clauses:
        id_para = Paragraph(f"<b>Pasal {c['clause_number']}</b><br/>" + c.get('id_text', '').replace('\n', '<br/>'), normal_id)
        en_para = Paragraph(f"<b>Clause {c['clause_number']}</b><br/>" + c.get('en_text', '').replace('\n', '<br/>'), normal_en)
        table_data.append([id_para, en_para])
        
    t = Table(table_data, colWidths=['50%', '50%'])
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 12),
        ('LINEBELOW', (0,0), (-1,-1), 0.5, colors.lightgrey),
        ('LINEBELOW', (0,0), (-1,0), 1, colors.black),
    ]))
    
    elements.append(t)
    elements.append(Spacer(1, 30))
    
    sig_data = [
        [Paragraph(f"<b>{party_a}</b>", normal_id), Paragraph(f"<b>{party_b}</b>", normal_id)],
        [Spacer(1, 60), Spacer(1, 60)],
        [Paragraph("[Title]<br/>Date: _________________", normal_id), Paragraph("[Title]<br/>Date: _________________", normal_id)]
    ]
    sig_table = Table(sig_data, colWidths=['50%', '50%'])
    sig_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
    ]))
    
    elements.append(sig_table)
    
    doc.build(elements)
    buffer.seek(0)
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=\"{contract_title}.pdf\""}
    )
