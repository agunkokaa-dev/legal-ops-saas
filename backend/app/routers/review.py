"""
Pariana Backend — Contract Review Router

Handles the immersive Review workflow (separate from the Drafting/Audit flow):
  - POST /api/v1/review/analyze      → Run full review pipeline, return structured results
  - GET  /api/v1/review/{contract_id} → Fetch cached review results
  - POST /api/v1/review/{contract_id}/accept → Accept a finding's suggested revision
  - POST /api/v1/review/from-finding  → Create a task from a review finding
"""
import asyncio
import json
import uuid
import traceback
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from supabase import Client

from app.config import openai_client, admin_supabase
from app.dependencies import verify_clerk_token
from app.review_schemas import ReviewResponse, ReviewFinding, BannerData, QuickInsight
from app.routers.contracts import process_contract_background

from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter()


# ──────────────────────────────────────────────
# Request / Response Models
# ──────────────────────────────────────────────

class ReviewAnalyzeRequest(BaseModel):
    contract_id: str
    raw_text: Optional[str] = None  # If provided, re-runs the pipeline


class AcceptFindingRequest(BaseModel):
    finding_id: str
    suggested_revision: str  # The redline text to apply


class CreateTaskFromFindingRequest(BaseModel):
    matter_id: str
    contract_id: str
    finding_title: str
    finding_description: str


# ──────────────────────────────────────────────
# POST /analyze — Run or retrieve review analysis
# ──────────────────────────────────────────────

@router.post("/analyze")
async def analyze_contract(
    payload: ReviewAnalyzeRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """
    If review data exists in the contract_reviews table, returns it.
    If raw_text is provided or no review exists, triggers a fresh LangGraph run
    and stores the results.
    """
    try:
        tenant_id = claims["verified_tenant_id"]
        if not tenant_id:
            raise HTTPException(status_code=401, detail="Invalid token claims")

        # Check for existing review
        existing = admin_supabase.table("contract_reviews") \
            .select("*") \
            .eq("contract_id", payload.contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()

        if existing.data and not payload.raw_text:
            # Return cached review
            review = existing.data[0]
            return {
                "status": "success",
                "source": "cached",
                "review": {
                    "contract_id": payload.contract_id,
                    "banner": review.get("banner", {}),
                    "quick_insights": review.get("quick_insights", []),
                    "findings": review.get("findings", []),
                    "raw_document": review.get("raw_document", "")
                }
            }

        # Need to run fresh analysis
        raw_text = payload.raw_text
        if not raw_text:
            # Fetch raw text from contracts table — try multiple fields
            contract_res = admin_supabase.table("contracts") \
                .select("draft_revisions, title, matter_id") \
                .eq("id", payload.contract_id) \
                .eq("tenant_id", tenant_id) \
                .limit(1) \
                .execute()

            if not contract_res.data:
                # Fallback: try without tenant filter (some contracts created before tenant enforcement)
                contract_res = admin_supabase.table("contracts") \
                    .select("draft_revisions, title, matter_id, tenant_id") \
                    .eq("id", payload.contract_id) \
                    .limit(1) \
                    .execute()

            if not contract_res.data:
                raise HTTPException(status_code=404, detail="Contract not found. Please verify the contract ID.")

            contract = contract_res.data[0]
            print(f"[Review] Contract found. Keys: {list(contract.keys())}")

            # Strategy 1: draft_revisions dict with latest_text
            revisions = contract.get("draft_revisions")
            if isinstance(revisions, dict):
                raw_text = revisions.get("latest_text", "") or revisions.get("content", "")
            elif isinstance(revisions, str) and len(revisions) > 50:
                raw_text = revisions

            # Strategy 3: parse draft_revisions if it's a JSON string
            if not raw_text and isinstance(revisions, str):
                try:
                    parsed = json.loads(revisions)
                    if isinstance(parsed, dict):
                        raw_text = parsed.get("latest_text", "") or parsed.get("content", "")
                except (json.JSONDecodeError, TypeError):
                    pass

            if not raw_text:
                raise HTTPException(
                    status_code=400,
                    detail="No document text available for analysis. The contract may still be processing. Please wait a moment and try again."
                )

        # Run the LangGraph pipeline synchronously for the review flow
        from graph import clm_graph

        if clm_graph is None:
            raise HTTPException(status_code=500, detail="LangGraph pipeline not initialized.")

        print(f"🔄 [Review] Running LangGraph pipeline for contract {payload.contract_id}...")

        final_state = await asyncio.to_thread(
            clm_graph.invoke,
            {
                "contract_id": payload.contract_id,
                "raw_document": raw_text[:150000]
            }
        )

        # Extract the aggregated review data
        findings = final_state.get("review_findings", [])
        quick_insights = final_state.get("quick_insights", [])
        banner = final_state.get("banner", {})

        # Store in contract_reviews table
        review_id = str(uuid.uuid4())
        review_record = {
            "id": review_id,
            "tenant_id": tenant_id,
            "contract_id": payload.contract_id,
            "banner": banner,
            "quick_insights": quick_insights,
            "findings": findings,
            "raw_document": raw_text[:500000],  # Cap storage
            "created_at": datetime.utcnow().isoformat()
        }

        try:
            admin_supabase.table("contract_reviews").insert(review_record).execute()
            print(f"✅ [Review] Stored review {review_id} with {len(findings)} findings.")
        except Exception as e:
            print(f"⚠️ [Review] Failed to store review: {e}")
            traceback.print_exc()

        # ── War Room: Persist findings as negotiation_issues ──
        try:
            # Find the latest version for this contract
            latest_version_id = None
            ver_res = admin_supabase.table("contract_versions") \
                .select("id") \
                .eq("contract_id", payload.contract_id) \
                .eq("tenant_id", tenant_id) \
                .order("version_number", desc=True) \
                .limit(1) \
                .execute()
            if ver_res.data:
                latest_version_id = ver_res.data[0]["id"]

            if findings:
                issue_rows = []
                for f in findings:
                    coords = f.get("coordinates", {})
                    issue_rows.append({
                        "id": str(uuid.uuid4()),
                        "tenant_id": tenant_id,
                        "contract_id": payload.contract_id,
                        "version_id": latest_version_id,
                        "finding_id": f.get("finding_id"),
                        "title": f.get("title", "Untitled Finding"),
                        "description": f.get("description", ""),
                        "severity": f.get("severity", "warning"),
                        "category": f.get("category"),
                        "status": "open",
                        "coordinates": coords,
                        "suggested_revision": f.get("suggested_revision"),
                        "playbook_reference": f.get("playbook_reference")
                    })
                if issue_rows:
                    admin_supabase.table("negotiation_issues").insert(issue_rows).execute()
                    print(f"✅ [War Room] Persisted {len(issue_rows)} negotiation issues for contract {payload.contract_id}")
        except Exception as ni_err:
            print(f"⚠️ [War Room] Failed to persist negotiation issues (non-fatal): {ni_err}")
            traceback.print_exc()

        return {
            "status": "success",
            "source": "fresh",
            "review": {
                "contract_id": payload.contract_id,
                "banner": banner,
                "quick_insights": quick_insights,
                "findings": findings,
                "raw_document": raw_text
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Review Analyze Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# GET /{contract_id} — Fetch cached review
# ──────────────────────────────────────────────

@router.get("/{contract_id}")
async def get_review(
    contract_id: str,
    claims: dict = Depends(verify_clerk_token),
):
    """Returns the most recent review for a contract."""
    try:
        tenant_id = claims["verified_tenant_id"]

        res = admin_supabase.table("contract_reviews") \
            .select("*") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()

        if not res.data:
            return {"found": False}

        review = res.data[0]

        # Fetch matter_id from contracts table for the Review-to-Draft bridge
        matter_id = None
        try:
            contract_res = admin_supabase.table("contracts") \
                .select("matter_id") \
                .eq("id", contract_id) \
                .eq("tenant_id", tenant_id) \
                .limit(1) \
                .execute()
            if contract_res.data:
                matter_id = contract_res.data[0].get("matter_id")
        except Exception:
            pass

        return {
            "found": True,
            "review": {
                "contract_id": contract_id,
                "matter_id": matter_id,
                "banner": review.get("banner", {}),
                "quick_insights": review.get("quick_insights", []),
                "findings": review.get("findings", []),
                "raw_document": review.get("raw_document", "")
            }
        }

    except Exception as e:
        print(f"❌ Get Review Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# POST /{contract_id}/accept — Accept a finding
# ──────────────────────────────────────────────

@router.post("/{contract_id}/accept")
async def accept_finding(
    contract_id: str,
    payload: AcceptFindingRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """
    Marks a finding as 'accepted' and applies the suggested revision
    to the contract's raw document text.
    """
    try:
        tenant_id = claims["verified_tenant_id"]

        # Fetch the review
        res = admin_supabase.table("contract_reviews") \
            .select("id, findings, raw_document") \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()

        if not res.data:
            raise HTTPException(status_code=404, detail="Review not found.")

        review = res.data[0]
        findings = review.get("findings", [])
        raw_document = review.get("raw_document", "")

        # Find the specific finding
        target_finding = None
        for f in findings:
            if f.get("finding_id") == payload.finding_id:
                target_finding = f
                break

        if not target_finding:
            raise HTTPException(status_code=404, detail="Finding not found.")

        # Apply the text replacement
        coords = target_finding.get("coordinates", {})
        source_text = coords.get("source_text", "")
        start = coords.get("start_char", -1)
        end = coords.get("end_char", -1)

        # Attempt exact coordinate replacement first
        actual_start = -1
        actual_end = -1
        
        if start >= 0 and end > start and end <= len(raw_document):
            existing_text = raw_document[start:end]
            if existing_text.strip() == source_text.strip():
                actual_start = start
                actual_end = end
                updated_document = raw_document[:actual_start] + payload.suggested_revision + raw_document[actual_end:]
            else:
                # Coordinate mismatch — fallback to string search
                idx = raw_document.find(source_text)
                if idx >= 0:
                    actual_start = idx
                    actual_end = idx + len(source_text)
                    updated_document = raw_document[:actual_start] + payload.suggested_revision + raw_document[actual_end:]
                else:
                    raise HTTPException(status_code=400, detail="Could not locate the clause text in the document.")
        elif source_text:
            # No coordinates — fallback to string search
            idx = raw_document.find(source_text)
            if idx >= 0:
                actual_start = idx
                actual_end = idx + len(source_text)
                updated_document = raw_document[:actual_start] + payload.suggested_revision + raw_document[actual_end:]
            else:
                raise HTTPException(status_code=400, detail="Could not locate the clause text in the document.")
        else:
            raise HTTPException(status_code=400, detail="Finding has no coordinate data.")

        # Update finding status
        target_finding["status"] = "accepted"

        # Shift coordinates for all subsequent findings to keep highlights aligned
        if actual_start >= 0 and actual_end >= 0:
            length_diff = len(payload.suggested_revision) - (actual_end - actual_start)
            target_finding["coordinates"]["start_char"] = actual_start
            target_finding["coordinates"]["end_char"] = actual_start + len(payload.suggested_revision)
            target_finding["coordinates"]["source_text"] = payload.suggested_revision
            
            for f in findings:
                if f.get("finding_id") != target_finding["finding_id"]:
                    f_start = f.get("coordinates", {}).get("start_char", -1)
                    if f_start > actual_start:
                        f["coordinates"]["start_char"] += length_diff
                        f["coordinates"]["end_char"] += length_diff

        # Save updated review
        admin_supabase.table("contract_reviews") \
            .update({
                "findings": findings,
                "raw_document": updated_document
            }) \
            .eq("id", review["id"]) \
            .execute()

        # Also update the contract's draft_revisions
        contract_res = admin_supabase.table("contracts") \
            .select("draft_revisions") \
            .eq("id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .limit(1) \
            .execute()

        if contract_res.data:
            revisions = contract_res.data[0].get("draft_revisions", {})
            if isinstance(revisions, dict):
                revisions["latest_text"] = updated_document
                history = revisions.get("history", [])
                history.append({
                    "version_id": str(int(datetime.utcnow().timestamp())),
                    "timestamp": datetime.utcnow().isoformat(),
                    "actor": "User (Review Accept)",
                    "action_type": "Accepted AI Redline",
                    "content": updated_document
                })
                revisions["history"] = history
            else:
                revisions = {"latest_text": updated_document}

            admin_supabase.table("contracts") \
                .update({"draft_revisions": revisions}) \
                .eq("id", contract_id) \
                .eq("tenant_id", tenant_id) \
                .execute()

        return {
            "status": "success",
            "message": "Finding accepted. Document updated.",
            "updated_document": updated_document,
            "updated_findings": findings
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Accept Finding Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
# POST /from-finding — Create task from finding
# ──────────────────────────────────────────────

@router.post("/from-finding")
async def create_task_from_finding(
    payload: CreateTaskFromFindingRequest,
    claims: dict = Depends(verify_clerk_token),
):
    """Creates a single task on the Kanban board from a review finding."""
    try:
        tenant_id = claims["verified_tenant_id"]

        task_payload = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "matter_id": payload.matter_id,
            "title": f"[Review] {payload.finding_title[:80]}",
            "description": (
                f"**Source:** AI Contract Review\n\n"
                f"**Contract ID:** {payload.contract_id}\n\n"
                f"**Finding:**\n{payload.finding_description}"
            ),
            "status": "backlog",
            "priority": "high",
            "source_document_name": payload.contract_id,
        }

        res = admin_supabase.table("tasks").insert(task_payload).execute()

        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to create task.")

        # Log activity
        try:
            admin_supabase.table("activity_logs").insert({
                "tenant_id": tenant_id,
                "matter_id": payload.matter_id,
                "task_id": task_payload["id"],
                "action": f"Task created from review finding: {payload.finding_title[:60]}",
                "actor_name": "Review System"
            }).execute()
        except Exception:
            pass

        # ── War Room: Link task to negotiation_issue if it exists ──
        try:
            if hasattr(payload, 'finding_id') and payload.finding_id:
                admin_supabase.table("negotiation_issues") \
                    .update({"status": "escalated", "linked_task_id": task_payload["id"]}) \
                    .eq("finding_id", payload.finding_id) \
                    .eq("contract_id", payload.contract_id) \
                    .eq("tenant_id", tenant_id) \
                    .execute()
        except Exception:
            pass

        return {
            "status": "success",
            "task_id": task_payload["id"],
            "message": "Task created and added to Backlog."
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Create Task From Finding Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
