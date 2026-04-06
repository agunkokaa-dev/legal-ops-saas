"""
Pariana Backend — E-Signature & E-Meterai Router

Handles the full PSrE (Penyelenggara Sertifikasi Elektronik) signing lifecycle:

  POST /api/v1/signing/{contract_id}/checklist   → Pre-sign compliance checklist
  POST /api/v1/signing/{contract_id}/initiate    → Start signing ceremony
  POST /api/v1/signing/webhook/{provider}        → PSrE webhook callbacks (no auth — HMAC verified)
  GET  /api/v1/signing/{contract_id}/status      → Signing session + signer status
  POST /api/v1/signing/{contract_id}/cancel      → Cancel active signing session
  POST /api/v1/signing/{contract_id}/remind/{signer_id} → Send reminder to signer
  GET  /api/v1/signing/{contract_id}/download    → Download signed PDF

Regulatory context:
  - UU ITE (UU 11/2008 jo. UU 19/2016): Legal basis for e-signatures
  - PP 71/2019: Implementing regulation for electronic systems
  - UU Bea Meterai (UU 10/2020): e-Meterai required for docs > Rp 5.000.000
  - PSrE-certified signatures required for BFSI/government contracts (QES)
"""

import os
import uuid
import traceback
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import Client

from app.config import admin_supabase
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.rate_limiter import limiter
from app.signing_providers import get_signing_provider
from app.signing_providers.base import SignerConfig, SignatureType

logger = logging.getLogger("pariana.signing")

router = APIRouter()

EMETERAI_THRESHOLD_IDR = 5_000_000  # UU Bea Meterai: e-Meterai required if value > Rp 5M
SIGNING_WEBHOOK_BASE_URL = os.getenv("SIGNING_WEBHOOK_BASE_URL", "http://localhost:8000/api/v1/signing/webhook")


# ═══════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════

def _log_audit(session_id: str, tenant_id: str, event_type: str, actor: str, detail: str, metadata: dict = None):
    """Insert a row into signing_audit_log. Fire-and-forget (errors are swallowed)."""
    try:
        admin_supabase.table("signing_audit_log").insert({
            "session_id": session_id,
            "tenant_id": tenant_id,
            "event_type": event_type,
            "event_actor": actor,
            "event_detail": detail,
            "event_metadata": metadata or {},
        }).execute()
    except Exception as e:
        logger.error("audit_log_error | session=%s | event=%s | err=%s", session_id, event_type, e)


async def _on_contract_executed(contract_id: str, tenant_id: str, session_id: str, signed_document_path: str):
    """
    Called when the last signer completes signing.

    1. Update contract status → 'Executed'
    2. Activate pending obligations → 'active'
    3. Create reminder tasks for obligations with due_dates
    4. Log to audit trail
    """
    try:
        # 1. Update contract status
        admin_supabase.table("contracts").update({
            "status": "Executed",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

        # 2. Activate pending obligations
        admin_supabase.table("contract_obligations").update({
            "status": "active",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "pending").execute()

        # 3. Fetch activated obligations with due dates to create reminder tasks
        obligations_res = admin_supabase.table("contract_obligations").select(
            "id, description, due_date"
        ).eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "active").execute()

        obligations_with_due_dates = [
            ob for ob in (obligations_res.data or [])
            if ob.get("due_date")
        ]

        # Fetch matter_id from contract for task linkage
        contract_res = admin_supabase.table("contracts").select("matter_id").eq(
            "id", contract_id
        ).eq("tenant_id", tenant_id).single().execute()
        matter_id = (contract_res.data or {}).get("matter_id")

        for ob in obligations_with_due_dates:
            task_title = f"Obligation Due: {ob['description'][:100]}"
            admin_supabase.table("tasks").insert({
                "tenant_id": tenant_id,
                "title": task_title,
                "description": ob["description"],
                "due_date": ob["due_date"],
                "priority": "high",
                "status": "todo",
                "matter_id": matter_id,
            }).execute()

        # 4. Audit log
        _log_audit(
            session_id, tenant_id,
            "contract_executed",
            "system",
            f"Contract executed. {len(obligations_with_due_dates)} obligation reminder tasks created.",
            {"contract_id": contract_id, "signed_document_path": signed_document_path},
        )

        logger.info(
            "contract_executed | contract=%s | obligations_activated=%d",
            contract_id, len(obligations_with_due_dates),
        )

    except Exception as e:
        logger.error("on_contract_executed_error | contract=%s | err=%s", contract_id, e)
        traceback.print_exc()


# ═══════════════════════════════════════════════════════════════
# ENDPOINT 1: PRE-SIGN COMPLIANCE CHECKLIST
# ═══════════════════════════════════════════════════════════════

@router.post("/{contract_id}/checklist")
@limiter.limit("30/minute")
async def run_presign_checklist(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    AI-powered pre-signing compliance checklist.

    Checks:
    1. All critical negotiation issues resolved
    2. Bilingual compliance (UU 24/2009 Pasal 31)
    3. e-Meterai requirement (UU Bea Meterai — value > Rp 5M)
    4. Signature type recommendation (Certified/QES vs Simple)
    5. Document completeness (text content exists)
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        checklist = []

        # ── Fetch contract ──
        contract_res = admin_supabase.table("contracts").select("*") \
            .eq("id", contract_id).eq("tenant_id", tenant_id).limit(1).execute()
        if not contract_res.data:
            raise HTTPException(status_code=404, detail="Contract not found")
        contract = contract_res.data[0]

        # ── Check 1: Negotiation issues resolved ──
        issues_res = admin_supabase.table("negotiation_issues").select("id, status, severity") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id).execute()
        issues = issues_res.data or []
        open_critical = [i for i in issues if i["status"] in ("open", "under_review") and i["severity"] == "critical"]
        open_any = [i for i in issues if i["status"] in ("open", "under_review")]
        resolved_count = len(issues) - len(open_any)

        checklist.append({
            "check": "all_issues_resolved",
            "passed": len(open_critical) == 0,
            "blocking": len(open_critical) > 0,
            "detail": (
                f"{resolved_count}/{len(issues)} issues resolved. "
                + (f"{len(open_critical)} critical issue(s) still open — must resolve before signing."
                   if open_critical else "All critical issues resolved.")
            ),
        })

        # ── Check 2: Bilingual compliance ──
        has_bilingual_texts = bool(contract.get("is_bilingual"))
        bilingual_res = admin_supabase.table("bilingual_clauses").select("id") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id).limit(1).execute()
        has_bilingual_clauses = bool(bilingual_res.data)

        checklist.append({
            "check": "bilingual_compliance",
            "passed": has_bilingual_texts or has_bilingual_clauses,
            "blocking": False,
            "detail": (
                "Document has bilingual version (Bahasa Indonesia + English)."
                if (has_bilingual_texts or has_bilingual_clauses)
                else "No bilingual version detected. UU 24/2009 Pasal 31 requires Bahasa Indonesia "
                     "for agreements where Indonesian parties are involved."
            ),
        })

        # ── Check 3: e-Meterai requirement ──
        contract_value = float(contract.get("contract_value") or 0)
        needs_emeterai = contract_value > EMETERAI_THRESHOLD_IDR
        currency = contract.get("currency", "IDR")

        checklist.append({
            "check": "emeterai_required",
            "passed": True,  # Informational — always passes; tells user IF e-Meterai is needed
            "blocking": False,
            "detail": (
                f"Contract value: {currency} {contract_value:,.0f}. "
                + ("e-Meterai REQUIRED (value > Rp 5.000.000, per UU Bea Meterai UU 10/2020)."
                   if needs_emeterai
                   else "e-Meterai not required (value ≤ Rp 5.000.000).")
            ),
            "emeterai_required": needs_emeterai,
        })

        # ── Check 4: Signature type recommendation ──
        matter_res = admin_supabase.table("matters").select("industry, matter_type") \
            .eq("id", contract.get("matter_id")).eq("tenant_id", tenant_id).limit(1).execute()
        matter = (matter_res.data or [{}])[0] if matter_res.data else {}
        matter_industry = (matter.get("industry") or "").lower()

        regulated_keywords = [
            "banking", "finance", "insurance", "bfsi", "government",
            "perbankan", "keuangan", "asuransi", "pemerintah", "investasi",
        ]
        is_regulated = any(kw in matter_industry for kw in regulated_keywords)
        recommended_type = "certified" if is_regulated else "simple"

        checklist.append({
            "check": "signature_type",
            "passed": True,
            "blocking": False,
            "detail": (
                f"Certified Digital Signature (QES) RECOMMENDED — regulated industry detected ({matter_industry})."
                if is_regulated
                else "Simple Electronic Signature is acceptable for this contract type."
            ),
            "recommended_type": recommended_type,
        })

        # ── Check 5: Document completeness ──
        draft_revisions = contract.get("draft_revisions")
        has_draft_text = False
        if draft_revisions:
            if isinstance(draft_revisions, dict):
                has_draft_text = bool(draft_revisions.get("latest_text"))
            elif isinstance(draft_revisions, str):
                has_draft_text = len(draft_revisions.strip()) > 0

        version_res = admin_supabase.table("contract_versions").select("id, raw_text") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .order("version_number", desc=True).limit(1).execute()
        has_version_text = bool(
            version_res.data and version_res.data[0].get("raw_text")
        )

        checklist.append({
            "check": "document_completeness",
            "passed": has_draft_text or has_version_text,
            "blocking": not (has_draft_text or has_version_text),
            "detail": (
                "Final document text found and ready for signing."
                if (has_draft_text or has_version_text)
                else "No document text found. Upload or draft the contract before initiating signing."
            ),
        })

        # ── Summary ──
        has_blockers = any(c.get("blocking", False) for c in checklist)
        all_passed = all(c["passed"] for c in checklist)

        return {
            "contract_id": contract_id,
            "checklist": checklist,
            "ready_to_sign": not has_blockers,
            "all_checks_passed": all_passed,
            "emeterai_required": needs_emeterai,
            "recommended_signature_type": recommended_type,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("checklist_error | contract=%s | err=%s", contract_id, e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ENDPOINT 2: INITIATE SIGNING CEREMONY
# ═══════════════════════════════════════════════════════════════

class SignerInput(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = None
    privy_id: Optional[str] = None
    organization: Optional[str] = None
    role: str = "pihak_pertama"
    title: Optional[str] = None
    signing_order_index: int = 0
    signing_page: Optional[int] = None
    signing_position_x: Optional[float] = None
    signing_position_y: Optional[float] = None


class InitiateSigningInput(BaseModel):
    signers: list[SignerInput]
    signing_order: str = "parallel"
    signature_type: str = "certified"
    require_emeterai: bool = False
    emeterai_page: Optional[int] = None
    expires_in_days: int = 7


@router.post("/{contract_id}/initiate")
@limiter.limit("10/minute")
async def initiate_signing(
    request: Request,
    contract_id: str,
    payload: InitiateSigningInput,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Start a signing ceremony.

    Flow:
    1. Validate contract exists and belongs to tenant
    2. Fetch the latest contract text (from draft_revisions or contract_versions)
    3. If require_emeterai: affix e-Meterai via PSrE provider
    4. Upload document to PSrE provider, configure signers
    5. Create signing_sessions + signing_signers DB records
    6. Update contract status → 'Signing in Progress'
    7. Return signing URLs for each signer
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        user_id = claims.get("sub", "unknown")

        if not payload.signers:
            raise HTTPException(status_code=400, detail="At least one signer is required")

        # ── 1. Fetch contract ──
        contract_res = admin_supabase.table("contracts").select("*") \
            .eq("id", contract_id).eq("tenant_id", tenant_id).limit(1).execute()
        if not contract_res.data:
            raise HTTPException(status_code=404, detail="Contract not found")
        contract = contract_res.data[0]

        # ── 2. Build a minimal PDF from contract text ──
        # We use the raw text from the latest version or draft_revisions.
        # In production, this should be a properly formatted PDF export.
        pdf_bytes = None
        filename = f"{contract.get('title', 'contract').replace(' ', '_')}_for_signing.pdf"

        version_res = admin_supabase.table("contract_versions").select("id, raw_text, uploaded_filename") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .order("version_number", desc=True).limit(1).execute()

        latest_version = version_res.data[0] if version_res.data else None
        version_id = latest_version["id"] if latest_version else None

        if latest_version and latest_version.get("uploaded_filename"):
            filename = latest_version["uploaded_filename"]

        # Generate a simple text-based PDF using reportlab if available, else a placeholder
        contract_text = ""
        if latest_version and latest_version.get("raw_text"):
            contract_text = latest_version["raw_text"]
        elif contract.get("draft_revisions"):
            dr = contract["draft_revisions"]
            if isinstance(dr, dict) and dr.get("latest_text"):
                contract_text = dr["latest_text"]
            elif isinstance(dr, str):
                contract_text = dr

        try:
            from reportlab.pdfgen import canvas as rl_canvas
            from reportlab.lib.pagesizes import A4
            import io as _io
            buf = _io.BytesIO()
            c = rl_canvas.Canvas(buf, pagesize=A4)
            width, height = A4
            c.setFont("Helvetica-Bold", 14)
            c.drawString(72, height - 72, contract.get("title", "Contract"))
            c.setFont("Helvetica", 10)
            y = height - 110
            for line in (contract_text or "")[:8000].split("\n"):
                if y < 72:
                    c.showPage()
                    y = height - 72
                c.drawString(72, y, line[:120])
                y -= 14
            c.save()
            pdf_bytes = buf.getvalue()
        except ImportError:
            # reportlab not installed — use a minimal PDF stub
            pdf_bytes = (
                b"%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n"
                b"2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n"
                b"3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>endobj\n"
                b"xref\n0 4\n0000000000 65535 f\ntrailer<</Size 4 /Root 1 0 R>>\n%%EOF"
            )

        # ── 3. Affix e-Meterai if required ──
        emeterai_serial = None
        emeterai_page = payload.emeterai_page
        signing_provider = get_signing_provider()

        if payload.require_emeterai:
            em_page = emeterai_page if emeterai_page is not None else -1  # -1 = last page
            emeterai_result = await signing_provider.affix_emeterai(pdf_bytes, em_page)
            emeterai_serial = emeterai_result.serial_number
            logger.info("emeterai_affixed | contract=%s | serial=%s", contract_id, emeterai_serial)

        # ── 4. Upload document to PSrE and configure signers ──
        signer_configs = [
            SignerConfig(
                full_name=s.full_name,
                email=s.email,
                phone=s.phone,
                privy_id=s.privy_id,
                organization=s.organization,
                role=s.role,
                title=s.title,
                signing_order_index=s.signing_order_index,
                signing_page=s.signing_page,
                signing_position_x=s.signing_position_x,
                signing_position_y=s.signing_position_y,
            )
            for s in payload.signers
        ]

        sig_type = SignatureType.CERTIFIED if payload.signature_type == "certified" else SignatureType.SIMPLE

        provider_name = os.getenv("SIGNING_PROVIDER", "mock")
        callback_url = f"{SIGNING_WEBHOOK_BASE_URL}/{provider_name}"

        upload_result = await signing_provider.upload_document(
            pdf_bytes=pdf_bytes,
            filename=filename,
            signers=signer_configs,
            signing_order=payload.signing_order,
            signature_type=sig_type,
            callback_url=callback_url,
        )

        # ── 5. Create DB records ──
        session_id = str(uuid.uuid4())
        expires_at = (datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days)).isoformat()

        session_data = {
            "id": session_id,
            "tenant_id": tenant_id,
            "contract_id": contract_id,
            "version_id": version_id,
            "provider": provider_name,
            "provider_document_id": upload_result.provider_document_id,
            "provider_document_url": upload_result.provider_document_url,
            "document_filename": filename,
            "signing_order": payload.signing_order,
            "signature_type": payload.signature_type,
            "require_emeterai": payload.require_emeterai,
            "emeterai_page": emeterai_page,
            "emeterai_provider_id": emeterai_serial,
            "status": "pending_signatures",
            "initiated_by": user_id,
            "initiated_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": expires_at,
            "provider_metadata": upload_result.metadata,
        }
        admin_supabase.table("signing_sessions").insert(session_data).execute()

        # Insert signer records
        for s in payload.signers:
            signer_record = {
                "session_id": session_id,
                "tenant_id": tenant_id,
                "full_name": s.full_name,
                "email": s.email,
                "phone": s.phone,
                "privy_id": s.privy_id,
                "organization": s.organization,
                "role": s.role,
                "title": s.title,
                "signing_order_index": s.signing_order_index,
                "signing_url": upload_result.signer_urls.get(s.email),
                "signing_page": s.signing_page,
                "signing_position_x": s.signing_position_x,
                "signing_position_y": s.signing_position_y,
                "status": "notified",
                "notified_at": datetime.now(timezone.utc).isoformat(),
                "provider_signer_id": upload_result.signer_ids.get(s.email),
            }
            admin_supabase.table("signing_signers").insert(signer_record).execute()

        # ── 6. Update contract status ──
        admin_supabase.table("contracts").update({
            "status": "Signing in Progress",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

        # ── 7. Audit log ──
        _log_audit(
            session_id, tenant_id,
            "session_created",
            user_id,
            f"Signing ceremony initiated with {len(payload.signers)} signer(s). "
            f"Provider: {provider_name}. Order: {payload.signing_order}.",
            {
                "provider_document_id": upload_result.provider_document_id,
                "signers": [s.email for s in payload.signers],
                "emeterai_serial": emeterai_serial,
            },
        )

        return {
            "session_id": session_id,
            "provider_document_id": upload_result.provider_document_id,
            "provider_document_url": upload_result.provider_document_url,
            "signing_urls": upload_result.signer_urls,
            "expires_at": expires_at,
            "emeterai_serial": emeterai_serial,
            "status": "pending_signatures",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("initiate_signing_error | contract=%s | err=%s", contract_id, e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ENDPOINT 3: WEBHOOK HANDLER (PUBLIC — HMAC VERIFIED)
# ═══════════════════════════════════════════════════════════════

@router.post("/webhook/{provider}")
async def handle_signing_webhook(
    provider: str,
    request: Request,
):
    """
    Receive webhook callbacks from PSrE providers.

    This endpoint is intentionally PUBLIC (no JWT auth) because PSrE
    providers cannot authenticate as our users. Security is provided
    by HMAC signature verification inside parse_webhook().

    Supported event types:
      signer_signed      — one signer has completed
      signer_rejected    — one signer rejected
      document_completed — all signers done, signed PDF available
      document_expired   — signing deadline passed
    """
    body = await request.body()
    headers = dict(request.headers)

    try:
        signing_provider = get_signing_provider()
        event = signing_provider.parse_webhook(headers, body)
    except ValueError as e:
        logger.warning("webhook_signature_invalid | provider=%s | err=%s", provider, e)
        raise HTTPException(status_code=401, detail=f"Invalid webhook signature: {e}")
    except Exception as e:
        logger.error("webhook_parse_error | provider=%s | err=%s", provider, e)
        raise HTTPException(status_code=400, detail="Failed to parse webhook")

    event_type = event.get("event_type", "")
    provider_doc_id = event.get("document_id", "")
    signer_email = event.get("signer_email", "")

    # Find the session by provider_document_id (no tenant filter — webhook has no JWT)
    session_res = admin_supabase.table("signing_sessions").select("*") \
        .eq("provider_document_id", provider_doc_id).limit(1).execute()

    if not session_res.data:
        logger.warning("webhook_session_not_found | provider_doc_id=%s", provider_doc_id)
        return {"status": "ignored", "reason": "session not found"}

    session = session_res.data[0]
    session_id = session["id"]
    tenant_id = session["tenant_id"]
    contract_id = session["contract_id"]

    _log_audit(session_id, tenant_id, "webhook_received", provider,
               f"Webhook received: {event_type}", {"payload": event})

    try:
        if event_type == "signer_signed":
            # Update the specific signer record
            now = datetime.now(timezone.utc).isoformat()
            update_data = {
                "status": "signed",
                "signed_at": event.get("signed_at", now),
                "updated_at": now,
            }
            if event.get("certificate_serial"):
                update_data["certificate_serial"] = event["certificate_serial"]
            if event.get("certificate_issuer"):
                update_data["certificate_issuer"] = event["certificate_issuer"]
            if event.get("signature_hash"):
                update_data["signature_hash"] = event["signature_hash"]
            if event.get("signer_id"):
                update_data["provider_signer_id"] = event["signer_id"]

            admin_supabase.table("signing_signers").update(update_data) \
                .eq("session_id", session_id).eq("email", signer_email).execute()

            # Check if all signers have signed
            signers_res = admin_supabase.table("signing_signers").select("status") \
                .eq("session_id", session_id).execute()
            all_signed = all(s["status"] == "signed" for s in (signers_res.data or []))
            any_signed = any(s["status"] == "signed" for s in (signers_res.data or []))

            if all_signed:
                new_session_status = "completed"
            elif any_signed:
                new_session_status = "partially_signed"
            else:
                new_session_status = "pending_signatures"

            admin_supabase.table("signing_sessions").update({
                "status": new_session_status,
                "updated_at": now,
            }).eq("id", session_id).execute()

            # Update contract status
            if new_session_status == "partially_signed":
                admin_supabase.table("contracts").update({
                    "status": "Partially Signed",
                    "updated_at": now,
                }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

            _log_audit(session_id, tenant_id, "signer_signed", signer_email,
                       f"Signer {signer_email} completed signing.", {"event": event})

        elif event_type == "signer_rejected":
            now = datetime.now(timezone.utc).isoformat()
            admin_supabase.table("signing_signers").update({
                "status": "rejected",
                "rejected_at": now,
                "rejection_reason": event.get("reason", ""),
                "updated_at": now,
            }).eq("session_id", session_id).eq("email", signer_email).execute()

            _log_audit(session_id, tenant_id, "signer_rejected", signer_email,
                       f"Signer {signer_email} rejected. Reason: {event.get('reason', '')}",
                       {"event": event})

        elif event_type == "document_completed":
            now = datetime.now(timezone.utc).isoformat()

            # Download the signed PDF from the provider
            signed_pdf_bytes = await signing_provider.download_signed_document(provider_doc_id)

            # Store in Supabase Storage
            signed_filename = f"signed/{contract_id}/{session_id}/signed_{session['document_filename']}"
            try:
                admin_supabase.storage.from_("matter-files").upload(
                    path=signed_filename,
                    file=signed_pdf_bytes,
                    file_options={"content-type": "application/pdf"},
                )
                signed_storage_path = signed_filename
            except Exception as store_err:
                logger.error("signed_doc_storage_error | session=%s | err=%s", session_id, store_err)
                signed_storage_path = None

            # Update session
            admin_supabase.table("signing_sessions").update({
                "status": "completed",
                "completed_at": now,
                "signed_document_path": signed_storage_path,
                "updated_at": now,
            }).eq("id", session_id).execute()

            # Mark all signers as signed
            admin_supabase.table("signing_signers").update({
                "status": "signed",
                "signed_at": now,
                "updated_at": now,
            }).eq("session_id", session_id).eq("status", "notified").execute()

            # Activate obligations + update contract status → Executed
            await _on_contract_executed(contract_id, tenant_id, session_id, signed_storage_path or "")

            _log_audit(session_id, tenant_id, "session_completed", "system",
                       "All signers completed. Signed PDF stored. Contract executed.",
                       {"signed_document_path": signed_storage_path})

        elif event_type == "document_expired":
            now = datetime.now(timezone.utc).isoformat()
            admin_supabase.table("signing_sessions").update({
                "status": "expired",
                "updated_at": now,
            }).eq("id", session_id).execute()

            admin_supabase.table("contracts").update({
                "status": "Reviewed",  # Revert to pre-signing state
                "updated_at": now,
            }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

            _log_audit(session_id, tenant_id, "session_expired", "system",
                       "Signing session expired before all signers completed.",
                       {"event": event})

        return {"status": "ok", "processed_event": event_type}

    except Exception as e:
        logger.error("webhook_processing_error | session=%s | event=%s | err=%s", session_id, event_type, e)
        traceback.print_exc()
        # Return 200 to prevent provider from retrying infinitely
        return {"status": "error", "detail": str(e)}


# ═══════════════════════════════════════════════════════════════
# ENDPOINT 4: GET SIGNING STATUS
# ═══════════════════════════════════════════════════════════════

@router.get("/{contract_id}/status")
@limiter.limit("60/minute")
async def get_signing_status(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Get current signing status for a contract.
    Returns the most recent session, all signers, and recent audit events.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        session_res = admin_supabase.table("signing_sessions").select("*") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .order("created_at", desc=True).limit(1).execute()

        if not session_res.data:
            return {"has_signing_session": False}

        session = session_res.data[0]

        signers_res = admin_supabase.table("signing_signers").select("*") \
            .eq("session_id", session["id"]).eq("tenant_id", tenant_id) \
            .order("signing_order_index").execute()

        audit_res = admin_supabase.table("signing_audit_log").select("*") \
            .eq("session_id", session["id"]).eq("tenant_id", tenant_id) \
            .order("created_at", desc=True).limit(20).execute()

        signers = signers_res.data or []
        signed_count = sum(1 for s in signers if s["status"] == "signed")
        pending_count = sum(1 for s in signers if s["status"] in ("pending", "notified", "viewed"))
        rejected_count = sum(1 for s in signers if s["status"] == "rejected")

        return {
            "has_signing_session": True,
            "session": session,
            "signers": signers,
            "audit_trail": audit_res.data or [],
            "progress": {
                "total_signers": len(signers),
                "signed": signed_count,
                "pending": pending_count,
                "rejected": rejected_count,
                "percent_complete": round(signed_count / len(signers) * 100) if signers else 0,
            },
        }

    except Exception as e:
        logger.error("get_signing_status_error | contract=%s | err=%s", contract_id, e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ENDPOINT 5: CANCEL SIGNING
# ═══════════════════════════════════════════════════════════════

class CancelSigningInput(BaseModel):
    reason: str = ""


@router.post("/{contract_id}/cancel")
@limiter.limit("10/minute")
async def cancel_signing(
    request: Request,
    contract_id: str,
    payload: CancelSigningInput = CancelSigningInput(),
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """Cancel an active signing session."""
    try:
        tenant_id = claims["verified_tenant_id"]
        user_id = claims.get("sub", "unknown")

        session_res = admin_supabase.table("signing_sessions").select("*") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .in_("status", ["pending_signatures", "partially_signed"]) \
            .order("created_at", desc=True).limit(1).execute()

        if not session_res.data:
            raise HTTPException(status_code=404, detail="No active signing session found")

        session = session_res.data[0]
        session_id = session["id"]

        # Cancel with provider
        signing_provider = get_signing_provider()
        if session.get("provider_document_id"):
            await signing_provider.cancel_signing(session["provider_document_id"], payload.reason)

        now = datetime.now(timezone.utc).isoformat()
        admin_supabase.table("signing_sessions").update({
            "status": "cancelled",
            "cancelled_at": now,
            "cancellation_reason": payload.reason,
            "updated_at": now,
        }).eq("id", session_id).execute()

        # Revert contract status to allow re-initiation
        admin_supabase.table("contracts").update({
            "status": "Ready to Sign",
            "updated_at": now,
        }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

        _log_audit(session_id, tenant_id, "session_cancelled", user_id,
                   f"Signing session cancelled. Reason: {payload.reason}")

        return {"status": "cancelled", "session_id": session_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("cancel_signing_error | contract=%s | err=%s", contract_id, e)
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ENDPOINT 6: SEND REMINDER
# ═══════════════════════════════════════════════════════════════

@router.post("/{contract_id}/remind/{signer_id}")
@limiter.limit("20/minute")
async def send_signer_reminder(
    request: Request,
    contract_id: str,
    signer_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """Send a reminder email to a pending signer."""
    try:
        tenant_id = claims["verified_tenant_id"]
        user_id = claims.get("sub", "unknown")

        # Fetch signer record (with tenant check via session)
        signer_res = admin_supabase.table("signing_signers").select("*, signing_sessions(*)") \
            .eq("id", signer_id).eq("tenant_id", tenant_id).limit(1).execute()

        if not signer_res.data:
            raise HTTPException(status_code=404, detail="Signer not found")

        signer = signer_res.data[0]
        session = signer.get("signing_sessions") or {}

        if signer["status"] not in ("pending", "notified", "viewed"):
            raise HTTPException(status_code=400,
                                detail=f"Cannot send reminder — signer status is '{signer['status']}'")

        signing_provider = get_signing_provider()
        provider_doc_id = session.get("provider_document_id", "")
        success = await signing_provider.send_reminder(provider_doc_id, signer["email"])

        if success:
            now = datetime.now(timezone.utc).isoformat()
            admin_supabase.table("signing_signers").update({
                "status": "notified",
                "notified_at": now,
                "updated_at": now,
            }).eq("id", signer_id).execute()

            _log_audit(
                signer["session_id"], tenant_id,
                "reminder_sent", user_id,
                f"Reminder sent to {signer['email']}.",
            )

        return {"sent": success, "email": signer["email"]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("send_reminder_error | signer=%s | err=%s", signer_id, e)
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# ENDPOINT 7: DOWNLOAD SIGNED DOCUMENT
# ═══════════════════════════════════════════════════════════════

@router.get("/{contract_id}/download")
@limiter.limit("20/minute")
async def download_signed_document(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Download the final signed PDF.
    Returns the file from Supabase Storage if available,
    or fetches it from the provider as a fallback.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        session_res = admin_supabase.table("signing_sessions").select("*") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .eq("status", "completed").order("created_at", desc=True).limit(1).execute()

        if not session_res.data:
            raise HTTPException(status_code=404, detail="No completed signing session found")

        session = session_res.data[0]

        # Try Supabase Storage first
        if session.get("signed_document_path"):
            try:
                file_data = admin_supabase.storage.from_("matter-files").download(
                    session["signed_document_path"]
                )
                filename = f"signed_{session['document_filename']}"
                return Response(
                    content=file_data,
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                )
            except Exception as storage_err:
                logger.warning("storage_download_error | session=%s | err=%s", session["id"], storage_err)

        # Fallback: fetch from provider
        if session.get("provider_document_id"):
            signing_provider = get_signing_provider()
            pdf_bytes = await signing_provider.download_signed_document(session["provider_document_id"])
            filename = f"signed_{session['document_filename']}"

            _log_audit(session["id"], tenant_id, "signed_document_downloaded",
                       claims.get("sub", "unknown"), "Signed document downloaded from provider.")

            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        raise HTTPException(status_code=404, detail="Signed document not available")

    except HTTPException:
        raise
    except Exception as e:
        logger.error("download_signed_error | contract=%s | err=%s", contract_id, e)
        raise HTTPException(status_code=500, detail=str(e))
