"""
Pariana Backend — Negotiation War Room Router (Phase 1)

Handles:
  - GET  /api/v1/negotiation/{contract_id}/versions  → List version history with risk progression
  - GET  /api/v1/negotiation/{contract_id}/issues     → List negotiation issues across versions
  - POST /api/v1/negotiation/{contract_id}/escalate   → Escalate an issue to a Kanban task
"""
import uuid
import traceback
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from supabase import Client

from app.config import openai_client, COLLECTION_NAME, qdrant
from app.dependencies import (
    TenantQdrantClient,
    TenantSupabaseClient,
    get_tenant_admin_supabase,  # TenantSupabaseClient factory
    get_tenant_qdrant,
    verify_clerk_token,
    get_tenant_supabase,
)
from app.schemas import EscalateIssueRequest, DiffRequest
from app.review_schemas import SmartDiffResult
from app.task_logger import TaskLogger
from app.rate_limiter import limiter
from app.token_budget import allocate_budget
from app.event_bus import SSEEvent, event_bus
from graph import run_smart_diff_agent
import asyncio
from qdrant_client.http.models import Filter, FieldCondition, MatchValue
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


async def publish_negotiation_event(
    event_type: str,
    tenant_id: str,
    *,
    contract_id: str | None = None,
    data: dict | None = None,
):
    await event_bus.publish(SSEEvent(
        event_type=event_type,
        tenant_id=tenant_id,
        contract_id=contract_id,
        data=data or {},
    ))


def handle_diff_task_result(task: asyncio.Task, contract_id: str):
    try:
        exc = task.exception()
        if exc:
            print(f"🚨 [SMART DIFF TASK FAILED] Contract {contract_id}: {exc}")
    except asyncio.CancelledError:
        print(f"⚠️ [SMART DIFF TASK CANCELLED] Contract {contract_id}")


class UpdateIssueStatusRequest(BaseModel):
    status: str  # 'open', 'under_review', 'accepted', 'rejected', 'countered'
    reason: str = ""
    actor: str = "System"


# =====================================================================
# GET /versions — Version History for a Contract
# =====================================================================

@router.get("/{contract_id}/versions")
@limiter.limit("60/minute")
async def list_contract_versions(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Returns all versions of a contract, ordered by version number.
    Includes risk score progression for the War Room delta view.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        res = supabase.table("contract_versions") \
            .select("id, contract_id, version_number, risk_score, risk_level, uploaded_filename, created_at, raw_text") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .gt("version_number", 0) \
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
@limiter.limit("60/minute")
async def list_negotiation_issues(
    request: Request,
    contract_id: str,
    status: str = None,
    version_id: str = None,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Returns all negotiation issues for a contract, optionally filtered
    by status ('open', 'escalated', 'resolved', 'dismissed') or version.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        query = supabase.table("negotiation_issues") \
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

        task_ids = [issue.get("linked_task_id") for issue in issues if issue.get("linked_task_id")]
        task_status_map = {}
        if task_ids:
            task_res = supabase.table("tasks").select("id, status") \
                .eq("tenant_id", tenant_id).in_("id", task_ids).execute()
            task_status_map = {task["id"]: task.get("status") for task in (task_res.data or [])}

        for issue in issues:
            if issue.get("linked_task_id"):
                issue["linked_task_status"] = task_status_map.get(issue["linked_task_id"])

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
@limiter.limit("10/minute")
async def escalate_issue(
    request: Request,
    contract_id: str,
    payload: EscalateIssueRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Escalates a negotiation issue to a Kanban task.
    Creates a task in the `tasks` table and links it back via `linked_task_id`.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        # Fetch the issue
        issue_res = supabase.table("negotiation_issues") \
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

        task_res = supabase.table("tasks").insert({**task_payload, "tenant_id": tenant_id}).execute()

        if not task_res.data:
            raise HTTPException(status_code=500, detail="Failed to create task.")

        # Link task back to the issue and update status
        supabase.table("negotiation_issues") \
            .update({
                "status": "escalated",
                "linked_task_id": task_id
            }) \
            .eq("id", payload.issue_id) \
            .eq("tenant_id", tenant_id) \
            .execute()

        # Log activity
        try:
            supabase.table("activity_logs").insert({
                "tenant_id": tenant_id,
                "matter_id": payload.matter_id,
                "task_id": task_id,
                "action": f"Issue escalated from War Room: {issue.get('title', '')[:60]}",
                "actor_name": "Negotiation System"
            }).execute()
        except Exception:
            pass

        await publish_negotiation_event(
            "task.created",
            tenant_id,
            contract_id=contract_id,
            data={
                "task_id": task_id,
                "task_title": task_payload["title"],
                "source": "negotiation.escalate",
            },
        )

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
@limiter.limit("60/minute")
async def get_smart_diff(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Returns the cached Diff Result if it has already been generated.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        res = supabase.table("contract_versions") \
            .select("pipeline_output") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .gt("version_number", 0) \
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


def _get_active_diff_task(
    *,
    supabase_client: Client,
    tenant_id: str,
    contract_id: str,
) -> dict | None:
    result = supabase_client.table("task_execution_logs") \
        .select("id, arq_job_id, status") \
        .eq("tenant_id", tenant_id) \
        .eq("contract_id", contract_id) \
        .eq("task_type", "smart_diff") \
        .in_("status", ["queued", "running", "retrying"]) \
        .order("created_at", desc=True) \
        .limit(1) \
        .execute()
    return (result.data or [None])[0]


async def _execute_diff_and_persist(
    *,
    contract_id: str,
    tenant_id: str,
    v1_version_id: str | None = None,
    v2_version_id: str | None = None,
    supabase_client: TenantSupabaseClient | None = None,
) -> dict:
    tenant_sb = supabase_client or get_tenant_admin_supabase(tenant_id)  # TenantSupabaseClient

    if v1_version_id and v2_version_id:
        v2_res = tenant_sb.table("contract_versions").select("*") \
            .eq("id", v2_version_id) \
            .eq("contract_id", contract_id) \
            .limit(1) \
            .execute()
        v1_res = tenant_sb.table("contract_versions").select("*") \
            .eq("id", v1_version_id) \
            .eq("contract_id", contract_id) \
            .limit(1) \
            .execute()
        versions = [item for item in [*(v2_res.data or []), *(v1_res.data or [])] if item]
        versions.sort(key=lambda version: version.get("version_number", 0), reverse=True)
    else:
        res = tenant_sb.table("contract_versions") \
            .select("*") \
            .eq("contract_id", contract_id) \
            .gt("version_number", 0) \
            .order("version_number", desc=True) \
            .limit(2) \
            .execute()
        versions = res.data or []

    if len(versions) < 2:
        raise ValueError("Not enough versions to perform a diff. Requires at least V1 and V2.")

    v2 = versions[0]
    v1 = versions[1]
    v1_text = v1.get("raw_text", "")
    v2_text = v2.get("raw_text", "")
    v1_score = v1.get("risk_score", 0.0) or 0.0

    def fetch_rules():
        hits, _ = qdrant.scroll(
            collection_name="company_rules",
            scroll_filter=Filter(must=[
                FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
            ]),
            limit=50,
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

    prior_rounds_context = None
    try:
        rounds_res = tenant_sb.table("negotiation_rounds") \
            .select("round_number, diff_snapshot, concession_analysis") \
            .eq("contract_id", contract_id) \
            .order("round_number") \
            .execute()
        prior_rounds = rounds_res.data or []
        if prior_rounds:
            context_parts = []
            for round_row in prior_rounds:
                snap = round_row.get("diff_snapshot", {}) or {}
                summary = snap.get("summary", "No summary available.")
                context_parts.append(f"Round {round_row['round_number']}: {summary}")
            prior_rounds_context = "\n".join(context_parts)
    except Exception as rounds_err:
        print(f"Warning: Failed to fetch prior rounds: {rounds_err}")

    budget_allocation = allocate_budget(
        inputs={
            "v1_text": v1_text,
            "v2_text": v2_text,
            "playbook_rules": playbook_rules_text,
            "prior_rounds": prior_rounds_context or "",
        },
        priorities={
            "v1_text": 3,
            "v2_text": 3,
            "playbook_rules": 2,
            "prior_rounds": 1,
        },
        total_budget=102_400,
        model="gpt-4o",
        system_prompt_tokens=3_000,
    )
    safe_v1, v1_tokens = budget_allocation["v1_text"]
    safe_v2, v2_tokens = budget_allocation["v2_text"]
    safe_playbook, playbook_tokens = budget_allocation["playbook_rules"]
    safe_rounds, rounds_tokens = budget_allocation["prior_rounds"]

    print(
        f"[SMART DIFF] Token allocation: V1={v1_tokens:,} V2={v2_tokens:,} "
        f"Playbook={playbook_tokens:,} Rounds={rounds_tokens:,} "
        f"Total={v1_tokens + v2_tokens + playbook_tokens + rounds_tokens:,}"
    )

    diff_result_dict = await asyncio.to_thread(
        run_smart_diff_agent,
        v1_raw_text=safe_v1,
        v2_raw_text=safe_v2,
        v1_risk_score=v1_score,
        playbook_rules_text=safe_playbook,
        prior_rounds_context=safe_rounds,
    )

    try:
        issues_payload = []
        deviations = diff_result_dict.get("deviations", [])
        for dev in deviations:
            issues_payload.append({
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "version_id": v2.get("id"),
                "finding_id": dev.get("deviation_id"),
                "title": dev.get("title", "Untitled Deviation"),
                "description": dev.get("impact_analysis", ""),
                "severity": dev.get("severity", "warning"),
                "category": dev.get("category", "Negotiation"),
                "status": "open",
                "playbook_reference": dev.get("playbook_violation", ""),
            })

        if issues_payload:
            issues_res = tenant_sb.table("negotiation_issues").insert(issues_payload).execute()
            inserted_issues = issues_res.data or []
            if len(inserted_issues) == len(deviations):
                for idx, dev in enumerate(deviations):
                    dev["deviation_id"] = inserted_issues[idx]["id"]
    except Exception as sync_err:
        print(f"Warning: Failed to sync deviations to DB: {sync_err}")

    pipeline_output = v2.get("pipeline_output") or {}
    pipeline_output["diff_result"] = diff_result_dict

    tenant_sb.table("contract_versions") \
        .update({
            "pipeline_output": pipeline_output,
            "is_truncated": safe_v2 != v2_text,
        }) \
        .eq("id", v2.get("id")) \
        .execute()

    round_number = v2.get("version_number", 2) - 1
    try:
        tenant_sb.table("negotiation_rounds").upsert({
            "tenant_id": tenant_id,
            "contract_id": contract_id,
            "round_number": round_number,
            "from_version_id": v1.get("id"),
            "to_version_id": v2.get("id"),
            "diff_snapshot": diff_result_dict,
        }, on_conflict="contract_id,round_number").execute()
        print(f"✅ Negotiation Round {round_number} tracked for contract {contract_id}")
    except Exception as round_err:
        print(f"Warning: Failed to track negotiation round: {round_err}")

    deviations = diff_result_dict.get("deviations", [])
    return {
        "deviations_count": len(deviations),
        "critical_count": sum(1 for deviation in deviations if deviation.get("severity") == "critical"),
        "risk_delta": diff_result_dict.get("risk_delta", 0),
        "round_number": round_number,
        "v1_version_id": v1.get("id"),
        "v2_version_id": v2.get("id"),
        "v1_version_number": v1.get("version_number"),
        "v2_version_number": v2.get("version_number"),
        "v1_tokens": v1_tokens,
        "v2_tokens": v2_tokens,
        "playbook_tokens": playbook_tokens,
        "prior_rounds_tokens": rounds_tokens,
        "budget_total": v1_tokens + v2_tokens + playbook_tokens + rounds_tokens,
        "v1_truncated": safe_v1 != v1_text,
        "v2_truncated": safe_v2 != v2_text,
        "playbook_truncated": safe_playbook != playbook_rules_text,
        "prior_rounds_truncated": safe_rounds != (prior_rounds_context or ""),
    }


async def process_smart_diff_background(
    *,
    contract_id: str,
    tenant_id: str,
    v1_version_id: str | None = None,
    v2_version_id: str | None = None,
    existing_log_id: str | None = None,
    task_input_metadata: dict | None = None,
) -> dict:
    diff_logger = TaskLogger(
        tenant_id=tenant_id,
        task_type="smart_diff",
        contract_id=contract_id,
        version_id=v2_version_id,
        input_metadata={
            "requested_v1_version_id": v1_version_id,
            "requested_v2_version_id": v2_version_id,
            **(task_input_metadata or {}),
        },
        existing_log_id=existing_log_id,
    )
    diff_logger.log_agent_start("smart_diff")

    try:
        tenant_sb = get_tenant_admin_supabase(tenant_id)  # TenantSupabaseClient
        await publish_negotiation_event(
            "diff.started",
            tenant_id,
            contract_id=contract_id,
            data={
                "v1_version_id": v1_version_id,
                "v2_version_id": v2_version_id,
                "message": "Starting Smart Diff analysis with GPT-4o...",
            },
        )

        result_summary = await _execute_diff_and_persist(
            contract_id=contract_id,
            tenant_id=tenant_id,
            v1_version_id=v1_version_id,
            v2_version_id=v2_version_id,
            supabase_client=tenant_sb,
        )

        diff_logger.update_input_metadata({
            "v1_tokens": result_summary["v1_tokens"],
            "v2_tokens": result_summary["v2_tokens"],
            "playbook_tokens": result_summary["playbook_tokens"],
            "prior_rounds_tokens": result_summary["prior_rounds_tokens"],
            "budget_total": result_summary["budget_total"],
            "v1_truncated": result_summary["v1_truncated"],
            "v2_truncated": result_summary["v2_truncated"],
            "playbook_truncated": result_summary["playbook_truncated"],
            "prior_rounds_truncated": result_summary["prior_rounds_truncated"],
        })
        diff_logger.log_agent_complete("smart_diff", {
            "deviations_count": result_summary["deviations_count"],
            "critical_count": result_summary["critical_count"],
        })
        diff_logger.complete(result_summary=result_summary)

        await publish_negotiation_event(
            "negotiation.round_created",
            tenant_id,
            contract_id=contract_id,
            data={
                "round_number": result_summary["round_number"],
                "from_version_id": result_summary["v1_version_id"],
                "to_version_id": result_summary["v2_version_id"],
            },
        )
        await publish_negotiation_event(
            "diff.completed",
            tenant_id,
            contract_id=contract_id,
            data={
                "deviations_count": result_summary["deviations_count"],
                "critical_count": result_summary["critical_count"],
                "risk_delta": result_summary["risk_delta"],
                "message": "Smart Diff analysis complete",
            },
        )
        return result_summary
    except Exception as exc:
        diff_logger.log_agent_failed("smart_diff", exc, used_fallback=False)
        diff_logger.fail(exc)
        await publish_negotiation_event(
            "diff.failed",
            tenant_id,
            contract_id=contract_id,
            data={
                "error": str(exc)[:500],
                "message": "Smart Diff analysis failed",
            },
        )
        raise

# =====================================================================
# POST /diff — Smart Diff Agent Execution
# =====================================================================
@router.post("/{contract_id}/diff")
@limiter.limit("3/minute")
@limiter.limit("15/hour")
async def generate_smart_diff(
    request: Request,
    contract_id: str,
    payload: DiffRequest = None,
    claims: dict = Depends(verify_clerk_token),
    qdrant_client: TenantQdrantClient = Depends(get_tenant_qdrant),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    On-Demand Agent: Compares V1 vs V2, evaluates Playbook compliance,
    and returns structured deviations + BATNA fallbacks.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        version_query = supabase.table("contract_versions") \
            .select("id") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .gt("version_number", 0) \
            .order("version_number", desc=True) \
            .limit(2) \
            .execute()
        versions = version_query.data or []
        if payload and payload.v1_version_id and payload.v2_version_id:
            explicit_versions = supabase.table("contract_versions").select("id") \
                .eq("contract_id", contract_id) \
                .eq("tenant_id", tenant_id) \
                .in_("id", [payload.v1_version_id, payload.v2_version_id]) \
                .execute()
            if len(explicit_versions.data or []) < 2:
                raise HTTPException(status_code=404, detail="Requested versions were not found for this contract.")
        elif len(versions) < 2:
            raise HTTPException(status_code=400, detail="Not enough versions to perform a diff. Requires at least V1 and V2.")

        active_task = _get_active_diff_task(
            supabase_client=supabase,
            tenant_id=tenant_id,
            contract_id=contract_id,
        )
        if active_task:
            return JSONResponse(
                status_code=202,
                content={
                    "status": "queued",
                    "message": "Smart Diff is already queued or running.",
                    "job_id": active_task.get("arq_job_id"),
                    "log_id": active_task.get("id"),
                },
            )

        try:
            from app.job_queue import enqueue_smart_diff

            enqueue_result = await enqueue_smart_diff(
                contract_id=contract_id,
                tenant_id=tenant_id,
                v1_version_id=payload.v1_version_id if payload else None,
                v2_version_id=payload.v2_version_id if payload else None,
            )
            return JSONResponse(
                status_code=202,
                content={
                    "status": "queued",
                    "message": "Smart Diff queued for background analysis.",
                    "job_id": enqueue_result["job_id"],
                    "log_id": enqueue_result["log_id"],
                },
            )
        except Exception as exc:
            log_id = getattr(exc, "log_id", None)
            if log_id is None:
                fallback_logger = TaskLogger(
                    tenant_id=tenant_id,
                    task_type="smart_diff",
                    contract_id=contract_id,
                    input_metadata={
                        "requested_v1_version_id": payload.v1_version_id if payload else None,
                        "requested_v2_version_id": payload.v2_version_id if payload else None,
                        "queue_fallback": True,
                        "queue_error": str(exc),
                    },
                )
                log_id = fallback_logger.log_id
            task = asyncio.create_task(
                process_smart_diff_background(
                    contract_id=contract_id,
                    tenant_id=tenant_id,
                    v1_version_id=payload.v1_version_id if payload else None,
                    v2_version_id=payload.v2_version_id if payload else None,
                    existing_log_id=log_id,
                    task_input_metadata={
                        "queue_fallback": True,
                        "queue_error": str(exc),
                    },
                )
            )
            task.add_done_callback(lambda current_task: handle_diff_task_result(current_task, contract_id))
            return JSONResponse(
                status_code=202,
                content={
                    "status": "queued",
                    "message": "Smart Diff queued via in-process fallback.",
                    "job_id": None,
                    "log_id": log_id,
                    "fallback": True,
                },
            )

    except Exception as e:
        print(f"❌ Smart Diff Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# =====================================================================
# PATCH /issues/{issue_id}/status — Update Issue Status with Audit Trail
# =====================================================================

@router.patch("/{contract_id}/issues/{issue_id}/status")
@limiter.limit("30/minute")
async def update_issue_status(
    request: Request,
    contract_id: str,
    issue_id: str,
    payload: UpdateIssueStatusRequest,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
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
        issue_res = supabase.table("negotiation_issues") \
            .select("*") \
            .eq("id", issue_id) \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()

        if not issue_res.data:
            raise HTTPException(status_code=404, detail="Negotiation issue not found.")

        issue = issue_res.data[0]
        previous_status = issue.get("status", "open")
        current_log = issue.get("reasoning_log") or []

        # 1. Fetch Deviation Context from rounds
        rounds_res = supabase.table("negotiation_rounds") \
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
        vs_res = supabase.table("contract_versions") \
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
            res_insert = supabase.table("contract_versions").insert({**draft_payload, "tenant_id": tenant_id}).execute()
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
                    fetch_matter_id = supabase.table("contracts").select("matter_id").eq("id", contract_id).eq("tenant_id", tenant_id).execute()
                    matter_id = fetch_matter_id.data[0].get("matter_id") if fetch_matter_id.data else None
                    task_payload = {
                        "tenant_id": tenant_id,
                        "matter_id": matter_id,
                        "title": f"Review Escalated Clause: {deviation.get('title', issue.get('title'))}",
                        "description": f"**Deviation:**\\n{v2_text}\\n\\n**Original:**\\n{v1_text}\\n\\n**Playbook Flag:**\\n{deviation.get('playbook_violation', 'None')}",
                        "status": "backlog",
                        "priority": "high",
                    }
                    task_res = supabase.table("tasks").insert({**task_payload, "tenant_id": tenant_id}).execute()
                    if task_res.data:
                        linked_task_id = task_res.data[0]["id"]
                        supabase.table("negotiation_issues").update({"linked_task_id": linked_task_id}).eq("id", issue_id).eq("tenant_id", tenant_id).execute()
                except Exception as e:
                    print(f"Failed to create escalation task: {e}")

            # Persist Draft Update State
            if draft_version:
                supabase.table("contract_versions").update({
                    "raw_text": draft_text,
                    "risk_score": draft_version.get("risk_score"),
                    "risk_level": draft_version.get("risk_level")
                }).eq("id", draft_version["id"]).eq("tenant_id", tenant_id).execute()


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

        supabase.table("negotiation_issues") \
            .update(update_payload) \
            .eq("id", issue_id) \
            .eq("tenant_id", tenant_id) \
            .execute()

        # Log activity
        try:
            supabase.table("activity_logs").insert({

                "tenant_id": tenant_id,
                "action": f"Issue status changed to {payload.status.upper()}: {issue.get('title', '')[:60]}",
                "actor_name": payload.actor or user_id
            }).execute()
        except Exception:
            pass

        await publish_negotiation_event(
            "negotiation.issue_updated",
            tenant_id,
            contract_id=contract_id,
            data={
                "issue_id": issue_id,
                "issue_title": issue.get("title", "Untitled Issue"),
                "old_status": previous_status,
                "new_status": payload.status,
                "actor": payload.actor or user_id,
                "message": f"Issue '{issue.get('title', 'Untitled Issue')}' changed to {payload.status}",
            },
        )

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
@limiter.limit("60/minute")
async def list_negotiation_rounds(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Returns all negotiation rounds for a contract, ordered by round number.
    Each round includes the diff snapshot and concession analysis.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        res = supabase.table("negotiation_rounds") \
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


# =====================================================================
# POST /finalize-for-signing — Transition Contract to "Pending Approval"
# =====================================================================

@router.post("/{contract_id}/finalize")
@router.post("/{contract_id}/finalize-for-signing")
@limiter.limit("60/minute")
async def finalize_for_signing(
    request: Request,
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    """
    Bridge War Room → Signing Center.

    A contract can move to signing once no unresolved critical negotiation
    issues remain. Non-critical unresolved items are returned as warnings.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        contract_res = supabase.table("contracts").select("*") \
            .eq("id", contract_id).eq("tenant_id", tenant_id).single().execute()
        if not contract_res.data:
            raise HTTPException(status_code=404, detail="Contract not found")
        contract = contract_res.data

        allowed_statuses = {"Reviewed", "Negotiating"}
        if contract.get("status") not in allowed_statuses:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Contract status is '{contract.get('status')}'. "
                    f"Finalization requires one of: {', '.join(sorted(allowed_statuses))}"
                ),
            )

        issues_res = supabase.table("negotiation_issues").select(
            "id, title, status, severity, linked_task_id"
        ).eq("contract_id", contract_id).eq("tenant_id", tenant_id).execute()
        issues = issues_res.data or []

        task_ids = [issue.get("linked_task_id") for issue in issues if issue.get("linked_task_id")]
        task_status_map = {}
        if task_ids:
            task_res = supabase.table("tasks").select("id, status") \
                .eq("tenant_id", tenant_id).in_("id", task_ids).execute()
            task_status_map = {task["id"]: task.get("status") for task in (task_res.data or [])}

        unresolved_issues = []
        for issue in issues:
            status = (issue.get("status") or "").lower()
            if status in {"accepted", "rejected", "countered", "resolved", "dismissed"}:
                continue
            if status == "escalated" and issue.get("linked_task_id") and task_status_map.get(issue["linked_task_id"]) == "done":
                continue
            unresolved_issues.append(issue)

        unresolved_critical = [issue for issue in unresolved_issues if issue.get("severity") == "critical"]
        if unresolved_critical:
            return {
                "ready": False,
                "blocked": True,
                "reason": f"{len(unresolved_critical)} critical issue(s) still unresolved",
                "unresolved_critical": [
                    {"id": issue["id"], "title": issue["title"], "status": issue["status"]}
                    for issue in unresolved_critical
                ],
                "unresolved_total": len(unresolved_issues),
            }

        latest_version_res = supabase.table("contract_versions").select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("version_number", desc=True).limit(1).execute()
        if not latest_version_res.data:
            raise HTTPException(status_code=400, detail="No contract version found")
        latest_version = latest_version_res.data[0]

        draft_revisions = contract.get("draft_revisions") or {}
        final_text = draft_revisions.get("latest_text") or latest_version.get("raw_text") or ""

        bilingual_res = supabase.table("bilingual_clauses").select("id, sync_status") \
            .eq("contract_id", contract_id).eq("tenant_id", tenant_id).execute()
        bilingual_clauses = bilingual_res.data or []
        has_bilingual = bool(bilingual_clauses)
        bilingual_all_synced = all(clause.get("sync_status") == "synced" for clause in bilingual_clauses) if bilingual_clauses else True

        if has_bilingual:
            try:
                from app.routers.bilingual import assemble_bilingual_contract_texts

                id_text, en_text, _ = assemble_bilingual_contract_texts(contract_id, tenant_id, supabase)
                draft_revisions["id_text"] = id_text
                draft_revisions["en_text"] = en_text
                if latest_version.get("id"):
                    supabase.table("contract_versions").update({
                        "id_raw_text": id_text,
                        "en_raw_text": en_text,
                    }).eq("id", latest_version["id"]).eq("tenant_id", tenant_id).execute()
            except Exception as exc:
                print(f"[NEGOTIATION] Bilingual finalization warning: {exc}")

        finalized_at = datetime.now(timezone.utc).isoformat()
        supabase.table("contracts").update({
            "status": "Pending Approval",
            "updated_at": finalized_at,
            "draft_revisions": {
                **draft_revisions,
                "final_text": final_text,
                "finalized_at": finalized_at,
                "finalized_by": claims.get("sub", "unknown"),
            },
        }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

        try:
            supabase.table("activity_logs").insert({
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "action": "negotiation_finalized",
                "detail": (
                    f"Contract finalized for signing. {len(issues)} issues reviewed. "
                    + (
                        "Bilingual document synced."
                        if has_bilingual and bilingual_all_synced
                        else ("Bilingual clauses still out of sync." if has_bilingual else "Monolingual final text prepared.")
                    )
                ),
                "actor": claims.get("sub", "unknown"),
                "actor_name": claims.get("sub", "unknown"),
            }).execute()
        except Exception:
            try:
                supabase.table("activity_logs").insert({
                    "tenant_id": tenant_id,
                    "contract_id": contract_id,
                    "action": "negotiation_finalized",
                    "actor_name": claims.get("sub", "unknown"),
                }).execute()
            except Exception:
                pass

        await publish_negotiation_event(
            "contract.status_changed",
            tenant_id,
            contract_id=contract_id,
            data={
                "contract_id": contract_id,
                "old_status": contract.get("status"),
                "new_status": "Pending Approval",
                "message": "Contract finalized for signing.",
            },
        )

        return {
            "ready": True,
            "blocked": False,
            "contract_id": contract_id,
            "status": "Pending Approval",
            "issues_summary": {
                "total": len(issues),
                "resolved": len(issues) - len(unresolved_issues),
                "unresolved_warnings": len([issue for issue in unresolved_issues if issue.get("severity") != "critical"]),
            },
            "bilingual": {
                "has_bilingual": has_bilingual,
                "all_synced": bilingual_all_synced,
            },
            "next_step": f"Run pre-sign compliance checklist: POST /api/v1/signing/{contract_id}/checklist",
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Finalize For Signing Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
