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

from app.config import admin_supabase, qdrant
from app.dependencies import verify_clerk_token, get_tenant_supabase
from app.schemas import EscalateIssueRequest, DiffRequest
from app.review_schemas import SmartDiffResult
from graph import run_smart_diff_agent
import asyncio
from datetime import datetime
from qdrant_client.http.models import Filter, FieldCondition, MatchValue
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


class UpdateIssueStatusRequest(BaseModel):
    status: str  # 'open', 'under_review', 'accepted', 'rejected', 'countered'
    reason: str = ""
    actor: str = "System"


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
            .select("id, contract_id, version_number, risk_score, risk_level, uploaded_filename, created_at, raw_text") \
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

# =====================================================================
# GET /diff — Fetch Cached Smart Diff Result
# =====================================================================
@router.get("/{contract_id}/diff", response_model=SmartDiffResult)
async def get_smart_diff(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Returns the cached Diff Result if it has already been generated.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        res = admin_supabase.table("contract_versions") \
            .select("pipeline_output") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("version_number", desc=True) \
            .limit(1) \
            .execute()
        
        versions = res.data or []
        if len(versions) == 0:
            raise HTTPException(status_code=404, detail="No versions found.")

        v2 = versions[0]
        pipeline_output = v2.get("pipeline_output", {}) or {}
        diff_result = pipeline_output.get("diff_result")

        if not diff_result:
            raise HTTPException(status_code=404, detail="Diff result not generated yet.")

        return diff_result

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Smart Diff GET Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# =====================================================================
# POST /diff — Smart Diff Agent Execution
# =====================================================================
@router.post("/{contract_id}/diff", response_model=SmartDiffResult)
async def generate_smart_diff(
    contract_id: str,
    payload: DiffRequest = None,
    claims: dict = Depends(verify_clerk_token),
):
    """
    On-Demand Agent: Compares V1 vs V2, evaluates Playbook compliance,
    and returns structured deviations + BATNA fallbacks.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        # 1. Get the latest 2 versions
        res = admin_supabase.table("contract_versions") \
            .select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("version_number", desc=True) \
            .limit(2) \
            .execute()
        
        versions = res.data or []
        if len(versions) < 2:
            raise HTTPException(status_code=400, detail="Not enough versions to perform a diff. Requires at least V1 and V2.")

        # versions[0] is V2 (latest), versions[1] is V1 (previous)
        v2 = versions[0]
        v1 = versions[1]

        v1_text = v1.get("raw_text", "")
        v2_text = v2.get("raw_text", "")
        v1_score = v1.get("risk_score", 0.0) or 0.0

        # 2. Fetch Playbook rules from Qdrant
        user_id = claims.get("sub", "")
        
        def fetch_rules():
            # Try tenant first
            hits, _ = qdrant.scroll(
                collection_name="company_rules",
                scroll_filter=Filter(must=[
                    FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))
                ]),
                limit=50
            )
            if not hits:
                # Fallback to user
                hits, _ = qdrant.scroll(
                    collection_name="company_rules",
                    scroll_filter=Filter(must=[
                        FieldCondition(key="user_id", match=MatchValue(value=user_id))
                    ]),
                    limit=50
                )
            return hits
            
        try:
            hits = await asyncio.to_thread(fetch_rules)
            playbook_rules_text = ""
            for hit in hits:
                playbook_rules_text += f"- {hit.payload.get('rule_text', '')}\n"
        except Exception as q_err:
            print(f"Warning: Failed to fetch playbook rules: {q_err}")
            playbook_rules_text = ""

        if not playbook_rules_text.strip():
            playbook_rules_text = "No custom playbook rules defined."

        # 3. Fetch prior rounds context for multi-round intelligence
        prior_rounds_context = None
        try:
            rounds_res = admin_supabase.table("negotiation_rounds") \
                .select("round_number, diff_snapshot, concession_analysis") \
                .eq("contract_id", contract_id) \
                .eq("tenant_id", tenant_id) \
                .order("round_number") \
                .execute()
            prior_rounds = rounds_res.data or []
            if prior_rounds:
                context_parts = []
                for r in prior_rounds:
                    snap = r.get("diff_snapshot", {}) or {}
                    summary = snap.get("summary", "No summary available.")
                    context_parts.append(f"Round {r['round_number']}: {summary}")
                prior_rounds_context = "\n".join(context_parts)
        except Exception as rounds_err:
            print(f"Warning: Failed to fetch prior rounds: {rounds_err}")

        # 4. Execute Smart Diff Agent
        diff_result_dict = await asyncio.to_thread(
            run_smart_diff_agent,
            v1_raw_text=v1_text,
            v2_raw_text=v2_text,
            v1_risk_score=v1_score,
            playbook_rules_text=playbook_rules_text,
            prior_rounds_context=prior_rounds_context
        )

        # 5. Pre-Sync: Insert all deviations as persistent negotiation_issues
        try:
            issues_payload = []
            deviations = diff_result_dict.get("deviations", [])
            for dev in deviations:
                issues_payload.append({
                    "tenant_id": tenant_id,
                    "contract_id": contract_id,
                    "version_id": v2.get("id"),
                    "finding_id": dev.get("deviation_id"), # Stash the AI ephemeral ID
                    "title": dev.get("title", "Untitled Deviation"),
                    "description": dev.get("impact_analysis", ""),
                    "severity": dev.get("severity", "warning"),
                    "category": dev.get("category", "Negotiation"),
                    "status": "open",
                    "playbook_reference": dev.get("playbook_violation", ""),
                })
            
            if issues_payload:
                issues_res = admin_supabase.table("negotiation_issues").insert(issues_payload).execute()
                inserted_issues = issues_res.data or []
                
                # Replace the ephemeral deviation_ids with the REAL Supabase UUIDs
                if len(inserted_issues) == len(deviations):
                    for idx, dev in enumerate(deviations):
                        dev["deviation_id"] = inserted_issues[idx]["id"]
                        
        except Exception as sync_err:
            print(f"Warning: Failed to sync deviations to DB: {sync_err}")

        # 6. Cache it inside v2's pipeline_output with REAL IDs
        pipeline_output = v2.get("pipeline_output") or {}
        pipeline_output["diff_result"] = diff_result_dict

        admin_supabase.table("contract_versions") \
            .update({"pipeline_output": pipeline_output}) \
            .eq("id", v2.get("id")) \
            .execute()

        # 7. Track this as a negotiation round with REAL IDs
        try:
            round_number = v2.get("version_number", 2) - 1
            admin_supabase.table("negotiation_rounds").upsert({
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "round_number": round_number,
                "from_version_id": v1.get("id"),
                "to_version_id": v2.get("id"),
                "diff_snapshot": diff_result_dict
            }, on_conflict="contract_id,round_number").execute()
            print(f"✅ Negotiation Round {round_number} tracked for contract {contract_id}")
        except Exception as round_err:
            print(f"Warning: Failed to track negotiation round: {round_err}")

        return diff_result_dict

    except Exception as e:
        print(f"❌ Smart Diff Error: {e}")
        traceback.print_exc()
        try:
            # Catch backend failures correctly: update document status to failed
            admin_supabase.table("contracts").update({
                "status": "Failed"
            }).eq("id", contract_id).execute()
        except Exception as update_err:
            print(f"Warning: Failed to set contract status to Failed: {update_err}")
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# PATCH /issues/{issue_id}/status — Update Issue Status with Audit Trail
# =====================================================================

@router.patch("/{contract_id}/issues/{issue_id}/status")
async def update_issue_status(
    contract_id: str,
    issue_id: str,
    payload: UpdateIssueStatusRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Updates the status of a negotiation issue and appends to the reasoning audit log.
    Valid statuses: open, under_review, accepted, rejected, countered, escalated, resolved, dismissed
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        user_id = claims.get("sub", "unknown")

        valid_statuses = {'open', 'under_review', 'accepted', 'rejected', 'countered', 'escalated', 'resolved', 'dismissed'}
        if payload.status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(sorted(valid_statuses))}")

        # Fetch current issue
        issue_res = admin_supabase.table("negotiation_issues") \
            .select("*") \
            .eq("id", issue_id) \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()

        if not issue_res.data:
            raise HTTPException(status_code=404, detail="Negotiation issue not found.")

        issue = issue_res.data[0]
        current_log = issue.get("reasoning_log") or []

        # 1. Fetch Deviation Context from rounds
        rounds_res = admin_supabase.table("negotiation_rounds") \
            .select("diff_snapshot") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("round_number", desc=True) \
            .limit(1) \
            .execute()
        
        deviation = None
        if rounds_res.data and rounds_res.data[0].get("diff_snapshot"):
            snapshot = rounds_res.data[0]["diff_snapshot"]
            for dev in snapshot.get("deviations", []):
                if dev.get("deviation_id") == issue_id:
                    deviation = dev
                    break

        # 2. Draft Accumulation (V3-Draft)
        draft_version = None
        vs_res = admin_supabase.table("contract_versions") \
            .select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("version_number", desc=True) \
            .execute()
        versions = vs_res.data or []
        
        # Look for existing Working Draft
        for v in versions:
            if "Working_Draft" in (v.get("uploaded_filename") or ""):
                draft_version = v
                break
        
        if not draft_version and versions:
            # Create a shadow draft
            latest_v = versions[0]
            new_v_number = latest_v["version_number"] + 1
            draft_payload = {
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "version_number": new_v_number,
                "uploaded_filename": f"v{new_v_number}.0.0-Working_Draft",
                "raw_text": latest_v.get("raw_text", ""),
                "risk_score": latest_v.get("risk_score", 0.0),
                "risk_level": latest_v.get("risk_level", "Unknown"),
            }
            res_insert = admin_supabase.table("contract_versions").insert(draft_payload).execute()
            if res_insert.data:
                draft_version = res_insert.data[0]

        draft_text = draft_version.get("raw_text", "") if draft_version else ""
        generated_email = None

        # 3. Active State Machine Flow
        if deviation and draft_version:
            from graph import fuzzy_find_substring, risk_agent
            from app.config import openai_client
            v1_text = deviation.get("v1_text", "")
            v2_text = deviation.get("v2_text", "")
            
            if payload.status == 'accepted' and v1_text and v2_text:
                # Merge V2 into Draft using 3-Tier anchor logic
                start_idx, end_idx = fuzzy_find_substring(draft_text, v1_text)
                if start_idx != -1:
                    draft_text = draft_text[:start_idx] + v2_text + draft_text[end_idx:]
                    # Re-trigger Risk Assessment
                    state_dict = {
                        "raw_document": draft_text,
                        "contract_value": 0,
                        "compliance_issues": [issue.get("description", "")]
                    }
                    try:
                        new_state = risk_agent(state_dict)
                        draft_version["risk_score"] = new_state.get("risk_score", draft_version["risk_score"])
                        draft_version["risk_level"] = new_state.get("risk_level", draft_version["risk_level"])
                    except Exception as e:
                        print(f"Risk re-assessment failed: {e}")

            elif payload.status == 'rejected' and v1_text and v2_text:
                # Revert - Attempt to replace V2 with V1 in the draft if it was previously accepted
                start_idx, end_idx = fuzzy_find_substring(draft_text, v2_text)
                if start_idx != -1:
                    draft_text = draft_text[:start_idx] + v1_text + draft_text[end_idx:]

                # AI Power Move: Generate email
                try:
                    prompt = f"The counterparty proposed: '{v2_text}'. Our playbook dictates: '{deviation.get('playbook_violation', 'Strict adherence to standard terms')}'. Write a firm, professional 2-sentence legal email excerpt rejecting their clause and explaining why we must retain our original clause: '{v1_text}'."
                    response = await asyncio.to_thread(openai_client.chat.completions.create,
                        model="gpt-4o-mini",
                        messages=[
                            {"role": "system", "content": "You are a professional Enterprise Legal Counsel."},
                            {"role": "user", "content": prompt}
                        ]
                    )
                    generated_email = response.choices[0].message.content
                except Exception as e:
                    generated_email = "Unable to generate email. Please review the playbook constraint manually."

            elif payload.status == 'countered' and v1_text and deviation.get("batna"):
                # Incorporate BATNA fallback clause
                batna_text = deviation["batna"].get("fallback_clause", "")
                if batna_text:
                    start_idx, end_idx = fuzzy_find_substring(draft_text, v1_text)
                    if start_idx != -1:
                        draft_text = draft_text[:start_idx] + batna_text + draft_text[end_idx:]

            elif payload.status == 'escalated':
                # Create Kanban Approval Task
                try:
                    fetch_matter_id = admin_supabase.table("contracts").select("matter_id").eq("id", contract_id).execute()
                    matter_id = fetch_matter_id.data[0].get("matter_id") if fetch_matter_id.data else None
                    task_payload = {
                        "tenant_id": tenant_id,
                        "matter_id": matter_id,
                        "title": f"Review Escalated Clause: {deviation.get('title', issue.get('title'))}",
                        "description": f"**Deviation:**\\n{v2_text}\\n\\n**Original:**\\n{v1_text}\\n\\n**Playbook Flag:**\\n{deviation.get('playbook_violation', 'None')}",
                        "status": "backlog",
                        "priority": "high",
                    }
                    task_res = admin_supabase.table("tasks").insert(task_payload).execute()
                    if task_res.data:
                        linked_task_id = task_res.data[0]["id"]
                        admin_supabase.table("negotiation_issues").update({"linked_task_id": linked_task_id}).eq("id", issue_id).execute()
                except Exception as e:
                    print(f"Failed to create escalation task: {e}")

            # Persist Draft Update State
            if draft_version:
                admin_supabase.table("contract_versions").update({
                    "raw_text": draft_text,
                    "risk_score": draft_version.get("risk_score"),
                    "risk_level": draft_version.get("risk_level")
                }).eq("id", draft_version["id"]).execute()


        # Append new audit entry
        now = datetime.utcnow().isoformat() + "Z"
        audit_entry = {
            "action": payload.status,
            "actor": payload.actor or user_id,
            "reason": payload.reason,
            "timestamp": now,
            "previous_status": issue.get("status", "open")
        }
        if generated_email:
            audit_entry["generated_response"] = generated_email

        current_log.append(audit_entry)

        # Update the issue
        update_payload = {
            "status": payload.status,
            "reasoning_log": current_log,
            "decided_by": payload.actor or user_id,
            "decided_at": now,
        }

        # Set resolved_at if moving to a terminal state
        if payload.status in ('accepted', 'rejected', 'resolved', 'dismissed'):
            update_payload["resolved_at"] = now

        admin_supabase.table("negotiation_issues") \
            .update(update_payload) \
            .eq("id", issue_id) \
            .execute()

        # Log activity
        try:
            admin_supabase.table("activity_logs").insert({

                "tenant_id": tenant_id,
                "action": f"Issue status changed to {payload.status.upper()}: {issue.get('title', '')[:60]}",
                "actor_name": payload.actor or user_id
            }).execute()
        except Exception:
            pass

        return {
            "status": "success",
            "issue_id": issue_id,
            "new_status": payload.status,
            "audit_entry": audit_entry,
            "total_log_entries": len(current_log)
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Update Issue Status Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# GET /rounds — Multi-Round Negotiation History
# =====================================================================

@router.get("/{contract_id}/rounds")
async def list_negotiation_rounds(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Returns all negotiation rounds for a contract, ordered by round number.
    Each round includes the diff snapshot and concession analysis.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        res = admin_supabase.table("negotiation_rounds") \
            .select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("round_number") \
            .execute()

        rounds = res.data or []

        return {
            "status": "success",
            "contract_id": contract_id,
            "total_rounds": len(rounds),
            "rounds": rounds
        }

    except Exception as e:
        print(f"❌ List Rounds Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
