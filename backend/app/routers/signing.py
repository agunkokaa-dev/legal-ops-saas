"""
Pariana Backend — E-Signature & E-Meterai Router
"""

import io
import logging
import os
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from supabase import Client

from app.config import CLERK_PEM_KEY, admin_supabase
from app.dependencies import _create_rls_supabase_client, _extract_tenant_id, get_tenant_supabase, verify_clerk_token
from app.event_bus import SSEEvent, event_bus
from app.rate_limiter import limiter
from app.signing_providers import get_signing_provider
from app.signing_providers.base import SignerConfig, SignatureType

logger = logging.getLogger("pariana.signing")

router = APIRouter()

EMETERAI_THRESHOLD_IDR = 5_000_000
SIGNING_WEBHOOK_BASE_URL = os.getenv(
    "SIGNING_WEBHOOK_BASE_URL",
    "http://localhost:8000/api/v1/signing/webhook",
)

RESOLVED_NEGOTIATION_STATUSES = {"accepted", "rejected", "countered", "resolved", "dismissed"}
ACTIVE_SIGNING_SESSION_STATUSES = {"pending_signatures", "partially_signed"}


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
    signing_position_x: Optional[float] = 0.3
    signing_position_y: Optional[float] = 0.8


class InitiateSigningInput(BaseModel):
    signers: list[SignerInput]
    signing_order: str = "parallel"
    signature_type: str = "certified"
    require_emeterai: bool = False
    emeterai_page: Optional[int] = None
    expires_in_days: int = Field(default=7, ge=1, le=30)
    message_to_signers: Optional[str] = None


class CancelSigningInput(BaseModel):
    reason: str = ""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _utc_now().isoformat()


def _clean_filename_part(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in (value or "contract"))
    return safe.strip("_") or "contract"


def _log_signing_event(
    supabase_client: Client,
    session_id: str,
    tenant_id: str,
    event_type: str,
    actor: str,
    detail: str,
    metadata: Optional[dict] = None,
) -> None:
    try:
        supabase_client.table("signing_audit_log").insert({
            "session_id": session_id,
            "tenant_id": tenant_id,
            "event_type": event_type,
            "event_actor": actor,
            "event_detail": detail,
            "event_metadata": metadata or {},
        }).execute()
    except Exception as exc:
        logger.error("signing_audit_insert_failed | session=%s | event=%s | err=%s", session_id, event_type, exc)


def _log_activity_event(
    supabase_client: Optional[Client] = None,
    *,
    tenant_id: str,
    action: str,
    detail: str,
    actor: str,
    contract_id: Optional[str] = None,
    matter_id: Optional[str] = None,
    task_id: Optional[str] = None,
) -> None:
    if supabase_client is None:
        # AUDITED: Requires service-role only for background/webhook callers without a user request context.
        supabase_client = admin_supabase
    rich_payload = {
        "tenant_id": tenant_id,
        "contract_id": contract_id,
        "matter_id": matter_id,
        "task_id": task_id,
        "action": action,
        "detail": detail,
        "actor": actor,
        "actor_name": actor,
    }
    fallback_payload = {
        "tenant_id": tenant_id,
        "contract_id": contract_id,
        "matter_id": matter_id,
        "task_id": task_id,
        "action": f"{action}: {detail}"[:240],
        "actor_name": actor,
    }
    try:
        supabase_client.table("activity_logs").insert(rich_payload).execute()
    except Exception:
        try:
            supabase_client.table("activity_logs").insert(fallback_payload).execute()
        except Exception as exc:
            logger.warning("activity_log_insert_failed | action=%s | err=%s", action, exc)


async def _publish_signing_event(
    event_type: str,
    tenant_id: str,
    *,
    contract_id: Optional[str] = None,
    data: Optional[dict] = None,
) -> None:
    await event_bus.publish(SSEEvent(
        event_type=event_type,
        tenant_id=tenant_id,
        contract_id=contract_id,
        data=data or {},
    ))


def _get_issue_signer_status_counts(signers: list[dict]) -> dict[str, int]:
    total = len(signers)
    signed = sum(1 for signer in signers if signer.get("status") == "signed")
    pending = sum(1 for signer in signers if signer.get("status") in ("pending", "notified", "viewed"))
    rejected = sum(1 for signer in signers if signer.get("status") == "rejected")
    percentage = round((signed / total) * 100) if total else 0
    return {
        "total_signers": total,
        "signed": signed,
        "pending": pending,
        "rejected": rejected,
        "percentage": percentage,
        "percent_complete": percentage,
        "is_complete": total > 0 and signed == total,
    }


def _is_expired(expires_at: Optional[str]) -> bool:
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(expires_at.replace("Z", "+00:00")) < _utc_now()
    except Exception:
        return False


def _is_issue_resolved_for_signing(issue: dict, task_status_map: dict[str, str]) -> bool:
    status = (issue.get("status") or "").lower()
    if status in RESOLVED_NEGOTIATION_STATUSES:
        return True
    if status == "escalated":
        linked_task_id = issue.get("linked_task_id")
        return bool(linked_task_id and task_status_map.get(linked_task_id) == "done")
    return False


def _verify_query_token(token: str) -> dict:
    if not CLERK_PEM_KEY:
        raise HTTPException(status_code=500, detail="Server authentication configuration error.")
    try:
        claims = jwt.decode(token, CLERK_PEM_KEY, algorithms=["RS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")

    tenant_id = _extract_tenant_id(claims)
    if not tenant_id:
        raise HTTPException(status_code=401, detail="No valid tenant identity found in token")
    claims["verified_tenant_id"] = tenant_id
    return claims


def _verify_authorization_header(authorization: Optional[str]) -> Optional[dict]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return _verify_query_token(authorization.split(" ", 1)[1])


def _document_preview_url(contract_id: str, session: dict) -> Optional[str]:
    if session.get("status") == "completed":
        return None
    return session.get("provider_document_url")


async def _generate_final_pdf(
    contract_id: str,
    tenant_id: str,
    contract: dict,
    supabase_client: Client,
) -> Optional[bytes]:
    bilingual_clauses = supabase_client.table("bilingual_clauses").select("id") \
        .eq("contract_id", contract_id).eq("tenant_id", tenant_id).limit(1).execute()
    if bilingual_clauses.data:
        try:
            from app.routers.bilingual import generate_bilingual_pdf_bytes

            pdf_bytes = generate_bilingual_pdf_bytes(contract_id, tenant_id, supabase_client)
            if pdf_bytes:
                return pdf_bytes
        except Exception as exc:
            logger.warning("bilingual_pdf_generation_failed | contract=%s | err=%s", contract_id, exc)

    final_text = (
        (contract.get("draft_revisions") or {}).get("final_text")
        or (contract.get("draft_revisions") or {}).get("latest_text")
    )
    if not final_text:
        latest_version = supabase_client.table("contract_versions").select("raw_text") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .order("version_number", desc=True).limit(1).execute()
        if latest_version.data:
            final_text = latest_version.data[0].get("raw_text") or ""

    if not final_text or len(final_text.strip()) < 10:
        return None

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
        from xml.sax.saxutils import escape
    except ImportError as exc:
        raise HTTPException(status_code=500, detail=f"ReportLab is not installed correctly: {exc}")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []

    for raw_line in final_text.splitlines():
        line = escape(raw_line.strip())
        if not line:
            story.append(Spacer(1, 8))
        elif line.startswith("### "):
            story.append(Paragraph(line[4:], styles["Heading3"]))
        elif line.startswith("## "):
            story.append(Paragraph(line[3:], styles["Heading2"]))
        elif line.startswith("# "):
            story.append(Paragraph(line[2:], styles["Heading1"]))
        else:
            story.append(Paragraph(line, styles["BodyText"]))

    doc.build(story)
    return buffer.getvalue()


def _store_pdf_to_storage(
    storage_path: str,
    pdf_bytes: bytes,
) -> Optional[str]:
    try:
        # AUDITED: Requires service-role for storage upload in provider/background flows.
        admin_supabase.storage.from_("matter-files").upload(
            path=storage_path,
            file=pdf_bytes,
            file_options={"content-type": "application/pdf"},
        )
        return storage_path
    except Exception as exc:
        logger.warning("storage_upload_failed | path=%s | err=%s", storage_path, exc)
        return None


def _build_task_status_map(tenant_id: str, issues: list[dict], supabase_client: Client) -> dict[str, str]:
    task_ids = [issue.get("linked_task_id") for issue in issues if issue.get("linked_task_id")]
    if not task_ids:
        return {}
    task_res = supabase_client.table("tasks").select("id, status") \
        .eq("tenant_id", tenant_id).in_("id", task_ids).execute()
    return {task["id"]: task.get("status") for task in (task_res.data or [])}


def _extract_ai_presign_guidance(
    contract: dict,
    matter: Optional[dict],
    issues: list[dict],
    bilingual_clauses: list[dict],
) -> dict:
    try:
        from graph import run_presign_checklist_agent

        return run_presign_checklist_agent(
            contract=contract,
            matter=matter,
            issues=issues,
            bilingual_clauses=bilingual_clauses,
        )
    except Exception as exc:
        logger.warning("presign_ai_guidance_failed | contract=%s | err=%s", contract.get("id"), exc)
        return {
            "bilingual_required": False,
            "recommended_signature_type": None,
            "notes": [],
            "rationale": "AI presign guidance unavailable.",
        }


def _build_presign_checklist(
    contract_id: str,
    tenant_id: str,
    supabase_client: Client,
    contract: Optional[dict] = None,
) -> dict:
    contract = contract or (
        supabase_client.table("contracts").select("*")
        .eq("id", contract_id).eq("tenant_id", tenant_id).single().execute().data
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    matter = None
    if contract.get("matter_id"):
        matter_res = supabase_client.table("matters").select("*") \
            .eq("id", contract["matter_id"]).eq("tenant_id", tenant_id).single().execute()
        matter = matter_res.data if matter_res.data else None

    issues_res = supabase_client.table("negotiation_issues").select(
        "id, title, status, severity, linked_task_id"
    ).eq("contract_id", contract_id).eq("tenant_id", tenant_id).execute()
    issues = issues_res.data or []
    task_status_map = _build_task_status_map(tenant_id, issues, supabase_client)

    bilingual_res = supabase_client.table("bilingual_clauses").select("id, sync_status") \
        .eq("contract_id", contract_id).eq("tenant_id", tenant_id).execute()
    bilingual_clauses = bilingual_res.data or []

    ai_guidance = _extract_ai_presign_guidance(contract, matter, issues, bilingual_clauses)

    unresolved_issues = [issue for issue in issues if not _is_issue_resolved_for_signing(issue, task_status_map)]
    open_critical = [issue for issue in unresolved_issues if issue.get("severity") == "critical"]
    open_any = [issue for issue in unresolved_issues if (issue.get("status") or "").lower() in ("open", "under_review")]

    checklist = [{
        "check_id": "negotiation_resolved",
        "check_name": "Negotiation Issues Resolved",
        "passed": len(open_critical) == 0,
        "blocking": len(open_critical) > 0,
        "severity": "critical" if open_critical else ("warning" if unresolved_issues else "passed"),
        "detail": (
            f"{len(issues) - len(unresolved_issues)}/{len(issues)} issues resolved."
            + (f" {len(open_critical)} critical issues still unresolved." if open_critical else "")
            + (
                f" {len(unresolved_issues) - len(open_critical)} non-critical item(s) still pending."
                if unresolved_issues and not open_critical
                else ""
            )
        ).strip(),
    }]

    has_bilingual = bool(contract.get("id_raw_text") and contract.get("en_raw_text")) or bool(bilingual_clauses)
    bilingual_synced = all(clause.get("sync_status") == "synced" for clause in bilingual_clauses) if bilingual_clauses else True
    bilingual_required = bool(ai_guidance.get("bilingual_required"))
    bilingual_warning = (
        "Bilingual structure exists but some clauses are out of sync."
        if has_bilingual and not bilingual_synced
        else None
    )
    if not has_bilingual and bilingual_required:
        bilingual_detail = (
            "No bilingual version detected. AI review recommends a Bahasa Indonesia version before execution."
        )
    elif has_bilingual:
        bilingual_detail = "Dokumen bilingual tersedia." + (" Semua klausul sinkron." if bilingual_synced else " Sebagian klausul belum sinkron.")
    else:
        bilingual_detail = (
            "No bilingual version detected. UU 24/2009 may require Bahasa Indonesia where an Indonesian party is involved."
        )
    checklist.append({
        "check_id": "bilingual_compliance",
        "check_name": "Bilingual Compliance (UU 24/2009 Pasal 31)",
        "passed": has_bilingual,
        "blocking": False,
        "severity": "passed" if has_bilingual and bilingual_synced else "warning",
        "detail": bilingual_detail + (f" {bilingual_warning}" if bilingual_warning else ""),
        "action": None if has_bilingual else "Create or finalize the bilingual version in the Bilingual Editor before signing.",
    })

    contract_value = float(contract.get("contract_value", 0) or 0)
    currency = contract.get("currency", "IDR")
    needs_emeterai = (currency == "IDR" and contract_value > EMETERAI_THRESHOLD_IDR) or (
        currency != "IDR" and contract_value > 0
    )
    checklist.append({
        "check_id": "emeterai_requirement",
        "check_name": "e-Meterai (Bea Meterai Elektronik)",
        "passed": True,
        "blocking": False,
        "severity": "info",
        "detail": (
            f"Nilai kontrak: {currency} {contract_value:,.0f}. e-Meterai WAJIB."
            if needs_emeterai
            else f"Nilai kontrak: {currency} {contract_value:,.0f}. e-Meterai tidak wajib."
        ),
        "emeterai_required": needs_emeterai,
    })

    matter_industry = ((matter or {}).get("industry") or "").lower()
    jurisdiction = (contract.get("jurisdiction") or "").lower()
    regulated_keywords = [
        "banking", "finance", "insurance", "bfsi", "government",
        "perbankan", "keuangan", "asuransi", "pemerintah", "ojk", "bi",
    ]
    is_regulated = any(keyword in matter_industry for keyword in regulated_keywords) or any(
        keyword in jurisdiction for keyword in regulated_keywords
    )
    recommended_type = ai_guidance.get("recommended_signature_type") or ("certified" if is_regulated else "simple")
    checklist.append({
        "check_id": "signature_type",
        "check_name": "Tipe Tanda Tangan Digital",
        "passed": True,
        "blocking": False,
        "severity": "warning" if recommended_type == "certified" else "info",
        "detail": (
            "Sektor terregulasi terdeteksi. Tanda tangan tersertifikasi/PSrE direkomendasikan."
            if recommended_type == "certified"
            else "Tanda tangan elektronik sederhana dinilai cukup untuk kontrak ini."
        ),
        "recommended_type": recommended_type,
    })

    draft_revisions = contract.get("draft_revisions") or {}
    final_text = draft_revisions.get("final_text") or draft_revisions.get("latest_text")
    latest_version = supabase_client.table("contract_versions").select("id, raw_text") \
        .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
        .order("version_number", desc=True).limit(1).execute()
    has_version_text = bool(latest_version.data and latest_version.data[0].get("raw_text"))
    has_content = bool(final_text and len(final_text.strip()) > 100)
    checklist.append({
        "check_id": "document_completeness",
        "check_name": "Kelengkapan Dokumen",
        "passed": has_content or has_version_text,
        "blocking": not (has_content or has_version_text),
        "severity": "critical" if not (has_content or has_version_text) else "passed",
        "detail": (
            "Dokumen final tersedia dan siap untuk ditandatangani."
            if has_content or has_version_text
            else "Tidak ada teks dokumen final yang dapat dipakai untuk membuat PDF penandatanganan."
        ),
    })

    risk_score = float(contract.get("risk_score", 0) or 0)
    risk_level = contract.get("risk_level", "Unknown")
    checklist.append({
        "check_id": "risk_assessment",
        "check_name": "Penilaian Risiko",
        "passed": risk_level not in ("High", "Critical"),
        "blocking": False,
        "severity": "warning" if risk_level in ("High", "Critical") else ("info" if risk_level == "Medium" else "passed"),
        "detail": (
            f"Risk Score: {risk_score:.1f}/100 ({risk_level}). "
            + (
                "Kontrak berisiko tinggi. Pastikan temuan risiko sudah ditinjau sebelum tanda tangan."
                if risk_level in ("High", "Critical")
                else ""
            )
        ).strip(),
    })

    has_blockers = any(item.get("blocking") for item in checklist)
    all_passed = all(item.get("passed") for item in checklist)
    warnings_count = sum(1 for item in checklist if item.get("severity") == "warning")

    return {
        "contract_id": contract_id,
        "checklist": checklist,
        "ready_to_sign": not has_blockers,
        "all_checks_passed": all_passed,
        "warnings_count": warnings_count,
        "summary": {
            "emeterai_required": needs_emeterai,
            "recommended_signature_type": recommended_type,
            "is_regulated_industry": is_regulated,
            "has_bilingual": has_bilingual,
            "risk_level": risk_level,
            "ai_guidance": ai_guidance,
        },
        "emeterai_required": needs_emeterai,
        "recommended_signature_type": recommended_type,
        "next_step": (
            f"POST /api/v1/signing/{contract_id}/initiate"
            if not has_blockers
            else "Resolve the blocking checklist items before initiating signing."
        ),
    }


async def _run_checklist_internal(
    contract_id: str,
    tenant_id: str,
    supabase_client: Client,
    contract: Optional[dict] = None,
) -> dict:
    return _build_presign_checklist(contract_id, tenant_id, supabase_client, contract)


async def _handle_signing_complete(
    session: dict,
    contract_id: str,
    tenant_id: str,
    signing_provider,
) -> dict:
    # AUDITED: Requires service-role due to webhook/background completion outside a browser request context.
    session_id = session["id"]
    current_session = admin_supabase.table("signing_sessions").select("status") \
        .eq("id", session_id).single().execute()
    if current_session.data and current_session.data.get("status") == "completed":
        return {"status": "already_completed"}

    contract_res = admin_supabase.table("contracts").select("status, matter_id, title, contract_value") \
        .eq("id", contract_id).eq("tenant_id", tenant_id).single().execute()
    contract = contract_res.data or {}
    previous_contract_status = contract.get("status")

    signed_pdf = None
    try:
        signed_pdf = await signing_provider.download_signed_document(session["provider_document_id"])
    except Exception as exc:
        logger.warning("signed_pdf_download_failed | session=%s | err=%s", session_id, exc)

    signed_document_path = None
    if signed_pdf:
        timestamp = _utc_now().strftime("%Y%m%d_%H%M%S")
        signed_document_path = _store_pdf_to_storage(
            f"signed-contracts/{tenant_id}/{contract_id}/signed_{timestamp}.pdf",
            signed_pdf,
        )

    completion_time = _iso_now()
    admin_supabase.table("signing_signers").update({
        "status": "signed",
        "signed_at": completion_time,
    }).eq("session_id", session_id).in_("status", ["pending", "notified", "viewed"]).execute()
    admin_supabase.table("signing_sessions").update({
        "status": "completed",
        "completed_at": completion_time,
        "signed_document_path": signed_document_path,
    }).eq("id", session_id).execute()

    admin_supabase.table("contracts").update({
        "status": "Executed",
        "updated_at": completion_time,
    }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

    obligations_res = admin_supabase.table("contract_obligations").select("*") \
        .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
        .eq("status", "pending").execute()
    obligations = obligations_res.data or []
    activated_count = 0
    if obligations:
        admin_supabase.table("contract_obligations").update({
            "status": "active",
            "updated_at": completion_time,
        }).eq("contract_id", contract_id).eq("tenant_id", tenant_id).eq("status", "pending").execute()
        activated_count = len(obligations)

    tasks_created = 0
    matter_id = contract.get("matter_id")
    contract_title = contract.get("title", "Contract")
    for obligation in obligations:
        if not obligation.get("due_date"):
            continue
        admin_supabase.table("tasks").insert({
            "tenant_id": tenant_id,
            "matter_id": matter_id,
            "title": f"Kewajiban: {(obligation.get('description') or 'Contract obligation')[:80]}",
            "description": (
                f"Kewajiban kontraktual dari '{contract_title}'.\n\n"
                f"{obligation.get('description', '')}\n\n"
                f"Tenggat: {obligation.get('due_date')}\n"
                f"Contract ID: {contract_id}"
            ),
            "due_date": obligation.get("due_date"),
            "priority": "high",
            "status": "todo",
        }).execute()
        tasks_created += 1

    contract_value = float(contract.get("contract_value", 0) or 0)
    if matter_id and contract_value > 0 and previous_contract_status != "Executed":
        matter_res = admin_supabase.table("matters").select("total_contract_value") \
            .eq("id", matter_id).eq("tenant_id", tenant_id).single().execute()
        if matter_res.data:
            current_total = float(matter_res.data.get("total_contract_value", 0) or 0)
            admin_supabase.table("matters").update({
                "total_contract_value": current_total + contract_value,
            }).eq("id", matter_id).eq("tenant_id", tenant_id).execute()

    _log_signing_event(
        admin_supabase,
        session_id,
        tenant_id,
        "session_completed",
        "system",
        (
            f"Semua pihak telah menandatangani. Kontrak dieksekusi. "
            f"{activated_count} kewajiban diaktifkan. {tasks_created} tugas dibuat."
        ),
        {
            "signed_document_path": signed_document_path,
            "obligations_activated": activated_count,
            "tasks_created": tasks_created,
        },
    )
    _log_activity_event(
        supabase_client=admin_supabase,
        tenant_id=tenant_id,
        contract_id=contract_id,
        matter_id=matter_id,
        action="contract_executed",
        detail=(
            f"Kontrak '{contract_title}' telah dieksekusi. "
            f"{activated_count} kewajiban aktif. {tasks_created} tugas pengingat dibuat."
        ),
        actor="system",
    )

    await _publish_signing_event(
        "signing.completed",
        tenant_id,
        contract_id=contract_id,
        data={
            "session_id": session_id,
            "signed_document_path": signed_document_path,
            "message": "All parties have signed. Contract is executed.",
        },
    )
    await _publish_signing_event(
        "contract.status_changed",
        tenant_id,
        contract_id=contract_id,
        data={
            "contract_id": contract_id,
            "old_status": previous_contract_status,
            "new_status": "Executed",
            "message": "Contract executed.",
        },
    )
    await _publish_signing_event(
        "contract.executed",
        tenant_id,
        contract_id=contract_id,
        data={
            "contract_id": contract_id,
            "signed_document_path": signed_document_path,
            "obligations_activated": activated_count,
            "tasks_created": tasks_created,
        },
    )
    if activated_count:
        await _publish_signing_event(
            "obligation.activated",
            tenant_id,
            contract_id=contract_id,
            data={"count": activated_count, "message": "Contract obligations are now active."},
        )
    for _ in range(tasks_created):
        await _publish_signing_event(
            "task.created",
            tenant_id,
            contract_id=contract_id,
            data={"source": "signing.obligation_activation"},
        )

    return {
        "status": "completed",
        "signed_document_path": signed_document_path,
        "obligations_activated": activated_count,
        "tasks_created": tasks_created,
    }


@router.post("/{contract_id}/checklist")
@limiter.limit("30/minute")
async def run_presign_checklist(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        return await _run_checklist_internal(contract_id, tenant_id, supabase)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("presign_checklist_failed | contract=%s | err=%s", contract_id, exc)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{contract_id}/initiate")
@limiter.limit("10/minute")
async def initiate_signing(
    request: Request,
    contract_id: str,
    payload: InitiateSigningInput,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        user_id = claims.get("sub", "unknown")

        contract_res = supabase.table("contracts").select("*") \
            .eq("id", contract_id).eq("tenant_id", tenant_id).single().execute()
        contract = contract_res.data
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        if contract.get("status") not in ("Pending Approval", "Ready to Sign"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Contract status is '{contract.get('status')}'. "
                    "Signing requires 'Pending Approval' or 'Ready to Sign'."
                ),
            )

        if not payload.signers:
            raise HTTPException(status_code=400, detail="At least one signer is required")

        checklist_result = await _run_checklist_internal(contract_id, tenant_id, supabase, contract)
        if not checklist_result["ready_to_sign"]:
            raise HTTPException(
                status_code=400,
                detail="Pre-sign checklist has blocking issues. Resolve them before initiating signing.",
            )

        pdf_bytes = await _generate_final_pdf(contract_id, tenant_id, contract, supabase)
        if not pdf_bytes:
            raise HTTPException(status_code=500, detail="Failed to generate final PDF document")

        provider = get_signing_provider()
        emeterai_result = None
        if payload.require_emeterai:
            emeterai_result = await provider.affix_emeterai(
                pdf_bytes=pdf_bytes,
                page_number=payload.emeterai_page or -1,
            )

        timestamp = _utc_now().strftime("%Y%m%d_%H%M%S")
        storage_filename = f"{_clean_filename_part(contract.get('title', 'contract'))}_{timestamp}_final.pdf"
        storage_path = _store_pdf_to_storage(
            f"signing-documents/{tenant_id}/{contract_id}/{storage_filename}",
            pdf_bytes,
        )

        provider_name = os.getenv("SIGNING_PROVIDER", "mock")
        callback_url = f"{SIGNING_WEBHOOK_BASE_URL}/{provider_name}"
        signer_configs = [
            SignerConfig(
                full_name=signer.full_name,
                email=signer.email,
                phone=signer.phone,
                privy_id=signer.privy_id,
                organization=signer.organization,
                role=signer.role,
                title=signer.title,
                signing_order_index=signer.signing_order_index,
                signing_page=signer.signing_page,
                signing_position_x=signer.signing_position_x,
                signing_position_y=signer.signing_position_y,
            )
            for signer in payload.signers
        ]
        signature_type = SignatureType.CERTIFIED if payload.signature_type == "certified" else SignatureType.SIMPLE
        upload_result = await provider.upload_document(
            pdf_bytes=pdf_bytes,
            filename=storage_filename,
            signers=signer_configs,
            signing_order=payload.signing_order,
            signature_type=signature_type,
            callback_url=callback_url,
        )

        latest_version = supabase.table("contract_versions").select("id") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .order("version_number", desc=True).limit(1).execute()
        version_id = latest_version.data[0]["id"] if latest_version.data else None

        expires_at = (_utc_now() + timedelta(days=payload.expires_in_days)).isoformat()
        session_payload = {
            "tenant_id": tenant_id,
            "contract_id": contract_id,
            "version_id": version_id,
            "provider": provider_name,
            "provider_document_id": upload_result.provider_document_id,
            "provider_document_url": upload_result.provider_document_url,
            "document_filename": storage_filename,
            "document_storage_path": storage_path,
            "signing_order": payload.signing_order,
            "signature_type": payload.signature_type,
            "require_emeterai": payload.require_emeterai,
            "emeterai_page": payload.emeterai_page,
            "emeterai_provider_id": emeterai_result.serial_number if emeterai_result else None,
            "status": "pending_signatures",
            "initiated_by": user_id,
            "initiated_at": _iso_now(),
            "expires_at": expires_at,
            "pre_sign_checklist": checklist_result["checklist"],
            "provider_metadata": {
                **(upload_result.metadata or {}),
                "message_to_signers": payload.message_to_signers,
                "summary": checklist_result.get("summary") or {},
            },
        }
        session_res = supabase.table("signing_sessions").insert(session_payload).execute()
        if not session_res.data:
            raise HTTPException(status_code=500, detail="Failed to create signing session")
        session = session_res.data[0]
        session_id = session["id"]

        for signer in payload.signers:
            supabase.table("signing_signers").insert({
                "session_id": session_id,
                "tenant_id": tenant_id,
                "full_name": signer.full_name,
                "email": signer.email,
                "phone": signer.phone,
                "privy_id": signer.privy_id,
                "organization": signer.organization,
                "role": signer.role,
                "title": signer.title,
                "signing_order_index": signer.signing_order_index,
                "signing_url": upload_result.signer_urls.get(signer.email, ""),
                "signing_page": signer.signing_page,
                "signing_position_x": signer.signing_position_x,
                "signing_position_y": signer.signing_position_y,
                "status": "notified",
                "notified_at": _iso_now(),
                "provider_signer_id": upload_result.signer_ids.get(signer.email, ""),
            }).execute()

        supabase.table("contracts").update({
            "status": "Signing in Progress",
            "updated_at": _iso_now(),
        }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

        _log_signing_event(
            supabase,
            session_id,
            tenant_id,
            "session_created",
            user_id,
            f"Signing ceremony initiated with {len(payload.signers)} signer(s). Provider: {provider_name}.",
            {"signers": [signer.email for signer in payload.signers], "signing_order": payload.signing_order},
        )
        if emeterai_result:
            _log_signing_event(
                supabase,
                session_id,
                tenant_id,
                "emeterai_affixed",
                "system",
                f"e-Meterai affixed. Serial: {emeterai_result.serial_number}.",
                {
                    "serial": emeterai_result.serial_number,
                    "verification_url": emeterai_result.verification_url,
                },
            )
        for signer in payload.signers:
            _log_signing_event(
                supabase,
                session_id,
                tenant_id,
                "signer_notified",
                "system",
                f"Signing invitation sent to {signer.full_name} ({signer.email})",
                {"email": signer.email, "role": signer.role},
            )

        _log_activity_event(
            supabase_client=supabase,
            tenant_id=tenant_id,
            contract_id=contract_id,
            matter_id=contract.get("matter_id"),
            action="signing_initiated",
            detail=f"Signing ceremony started with {len(payload.signers)} signer(s). Provider: {provider_name}.",
            actor=user_id,
        )

        await _publish_signing_event(
            "signing.initiated",
            tenant_id,
            contract_id=contract_id,
            data={
                "session_id": session_id,
                "provider": provider_name,
                "signers_count": len(payload.signers),
                "message": "Signing ceremony started.",
            },
        )
        await _publish_signing_event(
            "contract.status_changed",
            tenant_id,
            contract_id=contract_id,
            data={
                "contract_id": contract_id,
                "old_status": contract.get("status"),
                "new_status": "Signing in Progress",
                "message": "Contract moved to signing.",
            },
        )
        for signer in payload.signers:
            await _publish_signing_event(
                "signing.signer_notified",
                tenant_id,
                contract_id=contract_id,
                data={
                    "signer_email": signer.email,
                    "signer_name": signer.full_name,
                    "message": f"{signer.full_name} has been notified to sign.",
                },
            )

        return {
            "status": "success",
            "session_id": session_id,
            "contract_id": contract_id,
            "contract_status": "Signing in Progress",
            "provider": provider_name,
            "provider_document_id": upload_result.provider_document_id,
            "expires_at": expires_at,
            "emeterai": {
                "applied": bool(emeterai_result),
                "serial": emeterai_result.serial_number if emeterai_result else None,
            },
            "signers": [{
                "full_name": signer.full_name,
                "email": signer.email,
                "role": signer.role,
                "signing_url": upload_result.signer_urls.get(signer.email, ""),
                "status": "notified",
            } for signer in payload.signers],
            "message": f"Dokumen telah diunggah ke {provider_name}. Undangan penandatanganan telah dikirim.",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("initiate_signing_failed | contract=%s | err=%s", contract_id, exc)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{contract_id}/status")
@limiter.limit("60/minute")
async def get_signing_status(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        session_res = supabase.table("signing_sessions").select("*") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .order("created_at", desc=True).limit(1).execute()
        if not session_res.data:
            return {"has_signing_session": False}

        session = session_res.data[0]
        signers_res = supabase.table("signing_signers").select("*") \
            .eq("session_id", session["id"]).eq("tenant_id", tenant_id) \
            .order("signing_order_index").execute()
        audit_res = supabase.table("signing_audit_log").select("*") \
            .eq("session_id", session["id"]).eq("tenant_id", tenant_id) \
            .order("created_at", desc=True).limit(50).execute()
        signers = signers_res.data or []
        progress = _get_issue_signer_status_counts(signers)

        return {
            "has_signing_session": True,
            "session": {
                **session,
                "is_expired": _is_expired(session.get("expires_at")),
                "preview_url": _document_preview_url(contract_id, session),
            },
            "signers": signers,
            "audit_trail": audit_res.data or [],
            "progress": progress,
        }
    except Exception as exc:
        logger.error("get_signing_status_failed | contract=%s | err=%s", contract_id, exc)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/webhook/{provider}")
async def handle_signing_webhook(provider: str, request: Request):
    body = await request.body()
    headers = dict(request.headers)

    try:
        signing_provider = get_signing_provider()
        event = signing_provider.parse_webhook(headers, body)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid webhook signature: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse webhook: {exc}")

    provider_document_id = event.get("document_id") or event.get("document_token") or event.get("id")
    if not provider_document_id:
        raise HTTPException(status_code=400, detail="Missing document identifier in webhook payload")

    session_res = admin_supabase.table("signing_sessions").select("*") \
        .eq("provider_document_id", provider_document_id).single().execute()
    if not session_res.data:
        logger.warning("signing_webhook_unknown_document | provider=%s | doc_id=%s", provider, provider_document_id)
        return {"status": "ignored", "reason": "Unknown document"}

    session = session_res.data
    session_id = session["id"]
    tenant_id = session["tenant_id"]
    contract_id = session["contract_id"]
    event_type = event.get("event_type") or event.get("type") or ""
    signer_email = event.get("signer_email") or event.get("email") or ""

    try:
        # AUDITED: Requires service-role because webhook requests are provider-originated and do not carry a user Clerk JWT.
        if event_type in ("signer_viewed", "document_viewed"):
            if signer_email:
                admin_supabase.table("signing_signers").update({
                    "status": "viewed",
                    "viewed_at": _iso_now(),
                }).eq("session_id", session_id).eq("email", signer_email).execute()
                _log_signing_event(
                    admin_supabase,
                    session_id,
                    tenant_id,
                    "signer_viewed",
                    signer_email,
                    f"{signer_email} membuka dokumen untuk ditinjau.",
                )
                await _publish_signing_event(
                    "signing.signer_viewed",
                    tenant_id,
                    contract_id=contract_id,
                    data={"signer_email": signer_email, "message": f"{signer_email} viewed the document."},
                )

        elif event_type in ("signer_signed", "document_signed"):
            update_payload = {
                "status": "signed",
                "signed_at": event.get("signed_at", _iso_now()),
                "certificate_serial": event.get("certificate_serial", ""),
                "certificate_issuer": event.get("certificate_issuer", ""),
                "signature_algorithm": event.get("signature_algorithm", ""),
                "signature_hash": event.get("signature_hash", ""),
            }
            if signer_email:
                admin_supabase.table("signing_signers").update(update_payload) \
                    .eq("session_id", session_id).eq("email", signer_email).execute()
                _log_signing_event(
                    admin_supabase,
                    session_id,
                    tenant_id,
                    "signer_signed",
                    signer_email,
                    f"{signer_email} telah menandatangani dokumen.",
                    {"certificate_serial": event.get("certificate_serial", "")},
                )

            signers_res = admin_supabase.table("signing_signers").select("*") \
                .eq("session_id", session_id).execute()
            signers = signers_res.data or []
            progress = _get_issue_signer_status_counts(signers)

            if progress["is_complete"]:
                await _handle_signing_complete(session, contract_id, tenant_id, signing_provider)
            else:
                admin_supabase.table("signing_sessions").update({
                    "status": "partially_signed",
                }).eq("id", session_id).execute()
                admin_supabase.table("contracts").update({
                    "status": "Partially Signed",
                    "updated_at": _iso_now(),
                }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
                await _publish_signing_event(
                    "contract.status_changed",
                    tenant_id,
                    contract_id=contract_id,
                    data={
                        "contract_id": contract_id,
                        "old_status": "Signing in Progress",
                        "new_status": "Partially Signed",
                        "message": "Contract is partially signed.",
                    },
                )
                await _publish_signing_event(
                    "signing.signer_signed",
                    tenant_id,
                    contract_id=contract_id,
                    data={
                        "signer_email": signer_email,
                        "progress": progress,
                        "message": f"{signer_email} has signed the contract.",
                    },
                )

        elif event_type in ("signer_rejected", "document_rejected"):
            rejection_reason = event.get("reason", "No reason provided")
            if signer_email:
                admin_supabase.table("signing_signers").update({
                    "status": "rejected",
                    "rejected_at": _iso_now(),
                    "rejection_reason": rejection_reason,
                }).eq("session_id", session_id).eq("email", signer_email).execute()
            admin_supabase.table("signing_sessions").update({
                "status": "rejected",
            }).eq("id", session_id).execute()
            admin_supabase.table("contracts").update({
                "status": "Pending Approval",
                "updated_at": _iso_now(),
            }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
            _log_signing_event(
                admin_supabase,
                session_id,
                tenant_id,
                "signer_rejected",
                signer_email or "unknown",
                f"{signer_email or 'A signer'} menolak menandatangani. Alasan: {rejection_reason}",
                {"reason": rejection_reason},
            )
            await _publish_signing_event(
                "signing.signer_rejected",
                tenant_id,
                contract_id=contract_id,
                data={"signer_email": signer_email, "reason": rejection_reason, "message": "A signer rejected signing."},
            )
            await _publish_signing_event(
                "contract.status_changed",
                tenant_id,
                contract_id=contract_id,
                data={
                    "contract_id": contract_id,
                    "old_status": session.get("status"),
                    "new_status": "Pending Approval",
                    "message": "Signing was rejected and returned to pending approval.",
                },
            )

        elif event_type in ("document_completed", "completed"):
            await _handle_signing_complete(session, contract_id, tenant_id, signing_provider)

        elif event_type in ("document_expired", "expired"):
            admin_supabase.table("signing_sessions").update({
                "status": "expired",
            }).eq("id", session_id).execute()
            admin_supabase.table("contracts").update({
                "status": "Pending Approval",
                "updated_at": _iso_now(),
            }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()
            _log_signing_event(
                admin_supabase,
                session_id,
                tenant_id,
                "session_expired",
                "system",
                "Batas waktu penandatanganan telah berakhir.",
            )
            await _publish_signing_event(
                "signing.expired",
                tenant_id,
                contract_id=contract_id,
                data={"message": "Signing deadline expired."},
            )
            await _publish_signing_event(
                "contract.status_changed",
                tenant_id,
                contract_id=contract_id,
                data={
                    "contract_id": contract_id,
                    "old_status": session.get("status"),
                    "new_status": "Pending Approval",
                    "message": "Signing session expired and contract returned to pending approval.",
                },
            )

        _log_signing_event(
            admin_supabase,
            session_id,
            tenant_id,
            "webhook_received",
            "system",
            f"Webhook received: {event_type}",
            {"raw_payload": event},
        )
        return {"status": "processed", "event_type": event_type}
    except Exception as exc:
        logger.error("signing_webhook_processing_failed | session=%s | event=%s | err=%s", session_id, event_type, exc)
        traceback.print_exc()
        return {"status": "error", "detail": str(exc)}


@router.post("/{contract_id}/cancel")
@limiter.limit("10/minute")
async def cancel_signing(
    request: Request,
    contract_id: str,
    payload: CancelSigningInput = CancelSigningInput(),
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        user_id = claims.get("sub", "unknown")

        session_res = supabase.table("signing_sessions").select("*") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
            .in_("status", list(ACTIVE_SIGNING_SESSION_STATUSES)) \
            .order("created_at", desc=True).limit(1).execute()
        if not session_res.data:
            raise HTTPException(status_code=404, detail="No active signing session found")
        session = session_res.data[0]

        provider = get_signing_provider()
        try:
            await provider.cancel_signing(session["provider_document_id"], payload.reason)
        except Exception as exc:
            logger.warning("provider_cancel_failed | session=%s | err=%s", session["id"], exc)

        supabase.table("signing_sessions").update({
            "status": "cancelled",
            "cancelled_at": _iso_now(),
            "cancellation_reason": payload.reason,
        }).eq("id", session["id"]).execute()
        supabase.table("contracts").update({
            "status": "Pending Approval",
            "updated_at": _iso_now(),
        }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

        _log_signing_event(
            supabase,
            session["id"],
            tenant_id,
            "session_cancelled",
            user_id,
            f"Penandatanganan dibatalkan. Alasan: {payload.reason or 'Tidak ada alasan'}",
            {"reason": payload.reason},
        )
        await _publish_signing_event(
            "contract.status_changed",
            tenant_id,
            contract_id=contract_id,
            data={
                "contract_id": contract_id,
                "old_status": session.get("status"),
                "new_status": "Pending Approval",
                "message": "Signing session cancelled.",
            },
        )
        return {"status": "cancelled", "contract_id": contract_id, "contract_status": "Pending Approval"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("cancel_signing_failed | contract=%s | err=%s", contract_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{contract_id}/remind/{signer_id}")
@limiter.limit("20/minute")
async def send_reminder(
    request: Request,
    contract_id: str,
    signer_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    try:
        tenant_id = claims["verified_tenant_id"]
        signer_res = supabase.table("signing_signers").select("*") \
            .eq("id", signer_id).eq("tenant_id", tenant_id).single().execute()
        signer = signer_res.data
        if not signer:
            raise HTTPException(status_code=404, detail="Signer not found")
        if signer.get("status") == "signed":
            return {"status": "already_signed", "message": f"{signer.get('full_name')} sudah menandatangani."}

        session_res = supabase.table("signing_sessions").select("id, provider_document_id") \
            .eq("id", signer["session_id"]).single().execute()
        session = session_res.data
        if not session:
            raise HTTPException(status_code=404, detail="Signing session not found")

        provider = get_signing_provider()
        await provider.send_reminder(session["provider_document_id"], signer["email"])
        _log_signing_event(
            supabase,
            signer["session_id"],
            tenant_id,
            "reminder_sent",
            claims.get("sub", "unknown"),
            f"Pengingat dikirim ke {signer.get('full_name')} ({signer.get('email')})",
        )
        return {"status": "sent", "message": f"Pengingat dikirim ke {signer.get('full_name')}", "email": signer["email"]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("send_reminder_failed | signer=%s | err=%s", signer_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{contract_id}/download")
@limiter.limit("20/minute")
async def download_signed_document(
    request: Request,
    contract_id: str,
    token: Optional[str] = Query(default=None),
    authorization: Optional[str] = Header(default=None),
):
    effective_claims = _verify_authorization_header(authorization)
    if not effective_claims and token:
        effective_claims = _verify_query_token(token)
    if not effective_claims:
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    tenant_id = effective_claims["verified_tenant_id"]
    raw_jwt = authorization.split(" ", 1)[1] if authorization and authorization.startswith("Bearer ") else token
    if not raw_jwt:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    supabase = _create_rls_supabase_client(raw_jwt)
    session_res = supabase.table("signing_sessions").select("signed_document_path, document_filename, provider_document_id, id, status") \
        .eq("contract_id", contract_id).eq("tenant_id", tenant_id) \
        .eq("status", "completed").order("created_at", desc=True).limit(1).execute()
    if not session_res.data:
        raise HTTPException(status_code=404, detail="Signed document not available")

    session = session_res.data[0]
    if session.get("signed_document_path"):
        try:
            # AUDITED: Requires service-role for storage download in signed-document retrieval.
            file_bytes = admin_supabase.storage.from_("matter-files").download(session["signed_document_path"])
            filename = f"signed_{session.get('document_filename') or 'contract.pdf'}"
            return Response(
                content=file_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        except Exception as exc:
            logger.warning("signed_storage_download_failed | session=%s | err=%s", session["id"], exc)

    if session.get("provider_document_id"):
        provider = get_signing_provider()
        file_bytes = await provider.download_signed_document(session["provider_document_id"])
        filename = f"signed_{session.get('document_filename') or 'contract.pdf'}"
        return Response(
            content=file_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    raise HTTPException(status_code=404, detail="Signed document not available")
