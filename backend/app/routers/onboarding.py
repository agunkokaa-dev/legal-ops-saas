from __future__ import annotations

import traceback
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from supabase import Client

from app.dependencies import get_tenant_supabase, verify_clerk_token
from app.onboarding_samples import (
    SAMPLE_CONTRACTS,
    SampleContract,
    build_sample_payload,
    generate_sample_pdf_data_url,
    new_uuid,
    now_iso,
)
from app.pipeline_output_schema import parse_pipeline_output, serialize_pipeline_output
from app.rate_limiter import limiter

router = APIRouter()


def _rows(result: Any) -> list[dict[str, Any]]:
    data = getattr(result, "data", None)
    return data if isinstance(data, list) else []


def _count(result: Any) -> int:
    value = getattr(result, "count", None)
    if isinstance(value, int):
        return value
    return len(_rows(result))


def _extract_ids(result: Any) -> list[str]:
    return [str(row["id"]) for row in _rows(result) if row.get("id")]


def _build_contract_insert(
    *,
    sample: SampleContract,
    tenant_id: str,
    contract_id: str,
    file_url: str,
    file_size: int,
) -> dict[str, Any]:
    draft_revisions = {
        "latest_text": sample.raw_text,
        "findings": [
            item.payload
            for item in sample.draft_revisions
        ],
        "generated_at": now_iso(),
        "sample_source": sample.slug,
    }
    return {
        "id": contract_id,
        "tenant_id": tenant_id,
        "matter_id": None,
        "title": sample.title,
        "file_url": file_url,
        "file_type": "application/pdf",
        "file_size": file_size,
        "document_category": sample.category,
        "status": "Reviewed",
        "version_count": 1,
        "latest_version_id": None,
        "contract_value": sample.contract_value,
        "currency": sample.currency,
        "end_date": sample.end_date,
        "effective_date": sample.effective_date,
        "jurisdiction": sample.jurisdiction,
        "governing_law": sample.governing_law,
        "risk_level": sample.risk_level,
        "draft_revisions": draft_revisions,
        "is_sample": True,
    }


def _build_issue_rows(
    *,
    tenant_id: str,
    contract_id: str,
    version_id: str,
    findings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for finding in findings:
        rows.append({
            "id": new_uuid(),
            "tenant_id": tenant_id,
            "contract_id": contract_id,
            "version_id": version_id,
            "finding_id": finding.get("finding_id"),
            "title": finding.get("title", "Sample finding"),
            "description": finding.get("description", ""),
            "severity": finding.get("severity", "warning"),
            "category": finding.get("category"),
            "status": "open",
            "coordinates": finding.get("coordinates", {}),
            "suggested_revision": finding.get("suggested_revision"),
            "playbook_reference": finding.get("playbook_reference"),
        })
    return rows


@router.get("/onboarding/status")
@limiter.limit("60/minute")
async def onboarding_status(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    try:
        sample_res = supabase.table("contracts") \
            .select("id", count="exact") \
            .eq("tenant_id", tenant_id) \
            .eq("is_sample", True) \
            .neq("status", "ARCHIVED") \
            .execute()

        total_res = supabase.table("contracts") \
            .select("id", count="exact") \
            .eq("tenant_id", tenant_id) \
            .neq("status", "ARCHIVED") \
            .execute()

        sample_count = _count(sample_res)
        total_contracts = _count(total_res)
        return {
            "has_samples": sample_count > 0,
            "sample_count": sample_count,
            "total_contracts": total_contracts,
        }
    except Exception as exc:
        print(f"[GET /onboarding/status] Error: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/onboarding/load-samples")
@limiter.limit("10/minute")
async def load_sample_contracts(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    try:
        existing_samples = supabase.table("contracts") \
            .select("id") \
            .eq("tenant_id", tenant_id) \
            .eq("is_sample", True) \
            .neq("status", "ARCHIVED") \
            .execute()
        existing_sample_ids = _extract_ids(existing_samples)
        if existing_sample_ids:
            return {
                "loaded_count": 0,
                "contract_ids": existing_sample_ids,
                "already_loaded": True,
                "skipped": True,
            }

        existing_real = supabase.table("contracts") \
            .select("id") \
            .eq("tenant_id", tenant_id) \
            .neq("status", "ARCHIVED") \
            .neq("is_sample", True) \
            .limit(1) \
            .execute()
        if _rows(existing_real):
            return {
                "loaded_count": 0,
                "contract_ids": [],
                "already_loaded": False,
                "skipped": True,
                "detail": "Tenant already has contracts. Sample loading skipped.",
            }

        created_ids: list[str] = []
        for sample in SAMPLE_CONTRACTS:
            contract_id = new_uuid()
            version_id = new_uuid()
            fixture_payload = build_sample_payload(sample)
            pdf_data_url, file_size = generate_sample_pdf_data_url(sample.title, sample.raw_text)
            pipeline_output = serialize_pipeline_output(
                parse_pipeline_output(fixture_payload["pipeline_output"])
            )

            contract_insert = _build_contract_insert(
                sample=sample,
                tenant_id=tenant_id,
                contract_id=contract_id,
                file_url=pdf_data_url,
                file_size=file_size,
            )
            supabase.table("contracts").insert({**contract_insert, "tenant_id": tenant_id}).execute()

            supabase.table("contract_versions").insert({
                "id": version_id,
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "version_number": 1,
                "raw_text": sample.raw_text[:500000],
                "pipeline_output": pipeline_output,
                "risk_score": sample.risk_score,
                "risk_level": sample.risk_level,
                "uploaded_filename": sample.filename,
            }).execute()

            supabase.table("contracts").update({
                "latest_version_id": version_id,
            }).eq("tenant_id", tenant_id).eq("id", contract_id).execute()

            supabase.table("contract_reviews").insert({
                "id": new_uuid(),
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "banner": fixture_payload["banner"],
                "quick_insights": sample.quick_insights,
                "findings": fixture_payload["findings"],
                "raw_document": sample.raw_text[:500000],
                "created_at": now_iso(),
            }).execute()

            obligation_rows = [
                {
                    "id": new_uuid(),
                    "tenant_id": tenant_id,
                    "contract_id": contract_id,
                    "description": item["description"],
                    "due_date": item.get("due_date"),
                    "status": "pending",
                }
                for item in fixture_payload["obligations_v2"]
                if item.get("description")
            ]
            if obligation_rows:
                supabase.table("contract_obligations").insert([
                    {**row, "tenant_id": tenant_id}
                    for row in obligation_rows
                ]).execute()

            clause_rows = [
                {
                    "id": new_uuid(),
                    "tenant_id": tenant_id,
                    "contract_id": contract_id,
                    "clause_type": item.get("clause_type", "Other"),
                    "original_text": item.get("original_text", ""),
                    "ai_summary": item.get("ai_summary", ""),
                }
                for item in fixture_payload["classified_clauses_v2"]
                if item.get("original_text")
            ]
            if clause_rows:
                supabase.table("contract_clauses").insert([
                    {**row, "tenant_id": tenant_id}
                    for row in clause_rows
                ]).execute()

            issue_rows = _build_issue_rows(
                tenant_id=tenant_id,
                contract_id=contract_id,
                version_id=version_id,
                findings=fixture_payload["findings"],
            )
            if issue_rows:
                supabase.table("negotiation_issues").insert([
                    {**row, "tenant_id": tenant_id}
                    for row in issue_rows
                ]).execute()

            created_ids.append(contract_id)

        return {
            "loaded_count": len(created_ids),
            "contract_ids": created_ids,
            "already_loaded": False,
            "skipped": False,
        }
    except Exception as exc:
        print(f"[POST /onboarding/load-samples] Error: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/onboarding/clear-samples")
@limiter.limit("10/minute")
async def clear_sample_contracts(
    request: Request,
    claims: dict = Depends(verify_clerk_token),
    supabase: Client = Depends(get_tenant_supabase),
):
    tenant_id = claims["verified_tenant_id"]

    try:
        sample_res = supabase.table("contracts") \
            .select("id") \
            .eq("tenant_id", tenant_id) \
            .eq("is_sample", True) \
            .execute()
        sample_ids = _extract_ids(sample_res)
        if not sample_ids:
            return {"status": "ok", "deleted_count": 0}

        supabase.table("contract_reviews").delete() \
            .eq("tenant_id", tenant_id) \
            .in_("contract_id", sample_ids) \
            .execute()
        supabase.table("contract_obligations").delete() \
            .eq("tenant_id", tenant_id) \
            .in_("contract_id", sample_ids) \
            .execute()
        supabase.table("contract_clauses").delete() \
            .eq("tenant_id", tenant_id) \
            .in_("contract_id", sample_ids) \
            .execute()
        supabase.table("negotiation_issues").delete() \
            .eq("tenant_id", tenant_id) \
            .in_("contract_id", sample_ids) \
            .execute()
        supabase.table("contract_versions").delete() \
            .eq("tenant_id", tenant_id) \
            .in_("contract_id", sample_ids) \
            .execute()
        supabase.table("contracts").delete() \
            .eq("tenant_id", tenant_id) \
            .eq("is_sample", True) \
            .execute()

        return {"status": "ok", "deleted_count": len(sample_ids)}
    except Exception as exc:
        print(f"[DELETE /onboarding/clear-samples] Error: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
