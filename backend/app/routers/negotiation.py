"""
Pariana Backend — Negotiation War Room Router (Phase 1)

Handles:
  - GET  /api/v1/negotiation/{contract_id}/versions  → List version history with risk progression
  - GET  /api/v1/negotiation/{contract_id}/issues     → List negotiation issues across versions
  - POST /api/v1/negotiation/{contract_id}/escalate   → Escalate an issue to a Kanban task
"""
import uuid
import traceback
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from supabase import Client

from app.config import admin_supabase
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import EscalateIssueRequest

router = APIRouter()


# =====================================================================
# GET /versions — Version History for a Contract
# =====================================================================

@router.get("/{contract_id}/versions")
async def list_contract_versions(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Returns all versions of a contract, ordered by version number.
    Includes risk score progression for the War Room delta view.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        res = admin_supabase.table("contract_versions") \
            .select("id, contract_id, version_number, risk_score, risk_level, uploaded_filename, created_at") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("version_number") \
            .execute()

        versions = res.data or []

        # Compute risk delta between consecutive versions
        enriched = []
        for i, v in enumerate(versions):
            entry = {**v}
            if i > 0:
                prev_score = versions[i - 1].get("risk_score", 0.0) or 0.0
                curr_score = v.get("risk_score", 0.0) or 0.0
                entry["risk_delta"] = round(curr_score - prev_score, 1)
            else:
                entry["risk_delta"] = 0.0
            enriched.append(entry)

        return {
            "status": "success",
            "contract_id": contract_id,
            "total_versions": len(enriched),
            "versions": enriched
        }

    except Exception as e:
        print(f"❌ List Versions Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# GET /issues — Negotiation Issues for a Contract
# =====================================================================

@router.get("/{contract_id}/issues")
async def list_negotiation_issues(
    contract_id: str,
    status: str = None,
    version_id: str = None,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Returns all negotiation issues for a contract, optionally filtered
    by status ('open', 'escalated', 'resolved', 'dismissed') or version.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        query = admin_supabase.table("negotiation_issues") \
            .select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("created_at", desc=True)

        if status:
            query = query.eq("status", status)
        if version_id:
            query = query.eq("version_id", version_id)

        res = query.execute()
        issues = res.data or []

        # Aggregate counts by severity
        severity_counts = {"critical": 0, "warning": 0, "info": 0}
        for issue in issues:
            sev = issue.get("severity", "warning")
            if sev in severity_counts:
                severity_counts[sev] += 1

        return {
            "status": "success",
            "contract_id": contract_id,
            "total_issues": len(issues),
            "severity_counts": severity_counts,
            "issues": issues
        }

    except Exception as e:
        print(f"❌ List Issues Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# POST /escalate — Escalate Issue to Kanban Task
# =====================================================================

@router.post("/{contract_id}/escalate")
async def escalate_issue(
    contract_id: str,
    payload: EscalateIssueRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Escalates a negotiation issue to a Kanban task.
    Creates a task in the `tasks` table and links it back via `linked_task_id`.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        # Fetch the issue
        issue_res = admin_supabase.table("negotiation_issues") \
            .select("*") \
            .eq("id", payload.issue_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()

        if not issue_res.data:
            raise HTTPException(status_code=404, detail="Negotiation issue not found.")

        issue = issue_res.data[0]

        if issue.get("status") == "escalated" and issue.get("linked_task_id"):
            return {
                "status": "already_escalated",
                "message": "This issue has already been escalated to a task.",
                "task_id": issue["linked_task_id"]
            }

        # Create the task
        task_id = str(uuid.uuid4())
        task_payload = {
            "id": task_id,
            "tenant_id": tenant_id,
            "matter_id": payload.matter_id,
            "title": f"[Negotiation] {issue.get('title', 'Untitled Issue')[:80]}",
            "description": (
                f"**Source:** Negotiation War Room\n\n"
                f"**Contract ID:** {contract_id}\n\n"
                f"**Severity:** {issue.get('severity', 'warning').upper()}\n\n"
                f"**Category:** {issue.get('category', 'General')}\n\n"
                f"**Finding:**\n{issue.get('description', '')}"
                + (f"\n\n**Suggested Revision:**\n{issue['suggested_revision']}" if issue.get('suggested_revision') else "")
            ),
            "status": "backlog",
            "priority": "high" if issue.get("severity") == "critical" else "medium",
            "source_document_name": contract_id,
        }

        task_res = admin_supabase.table("tasks").insert(task_payload).execute()

        if not task_res.data:
            raise HTTPException(status_code=500, detail="Failed to create task.")

        # Link task back to the issue and update status
        admin_supabase.table("negotiation_issues") \
            .update({
                "status": "escalated",
                "linked_task_id": task_id
            }) \
            .eq("id", payload.issue_id) \
            .execute()

        # Log activity
        try:
            admin_supabase.table("activity_logs").insert({
                "tenant_id": tenant_id,
                "matter_id": payload.matter_id,
                "task_id": task_id,
                "action": f"Issue escalated from War Room: {issue.get('title', '')[:60]}",
                "actor_name": "Negotiation System"
            }).execute()
        except Exception:
            pass

        return {
            "status": "success",
            "message": "Issue escalated to Kanban board.",
            "task_id": task_id,
            "issue_id": payload.issue_id
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Escalate Issue Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
