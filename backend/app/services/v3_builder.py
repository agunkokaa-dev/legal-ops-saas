from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from app.pipeline_output_schema import parse_pipeline_output


WORKING_DRAFT_PATTERN = re.compile(r"working[_ -]?draft", re.IGNORECASE)
DEFAULT_DECISION_COUNTS = {
    "open": 0,
    "under_review": 0,
    "accepted": 0,
    "rejected": 0,
    "countered": 0,
    "escalated": 0,
    "resolved": 0,
    "dismissed": 0,
}


@dataclass
class RoundBuildContext:
    contract_id: str
    tenant_id: str
    versions: list[dict[str, Any]]
    source_version: dict[str, Any]
    baseline_version: dict[str, Any] | None
    diff_result: dict[str, Any]
    deviations: list[dict[str, Any]]
    batna_fallbacks: list[dict[str, Any]]
    issues: list[dict[str, Any]]


def is_working_draft_version(version: dict[str, Any]) -> bool:
    filename = str(version.get("uploaded_filename") or "")
    return bool(WORKING_DRAFT_PATTERN.search(filename))


def _normalize_reference_key(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.isdigit():
        return str(int(text))
    return text.lower()


def _normalize_title_key(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text.lower()


def _sorted_versions(versions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        versions,
        key=lambda version: version.get("version_number") or 0,
        reverse=True,
    )


def _normalize_issue_status(issue: dict[str, Any] | None) -> str:
    status = str((issue or {}).get("status") or "open").strip().lower()
    return status or "open"


def _resolve_issue_for_deviation(
    deviation: dict[str, Any],
    *,
    issue_by_id: dict[str, dict[str, Any]],
    issue_by_finding_id: dict[str, dict[str, Any]],
    issue_by_title: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    deviation_id = _normalize_reference_key(deviation.get("deviation_id"))
    if deviation_id:
        matched_issue = issue_by_id.get(deviation_id) or issue_by_finding_id.get(deviation_id)
        if matched_issue is not None:
            return matched_issue

    finding_id = _normalize_reference_key(deviation.get("finding_id"))
    if finding_id:
        matched_issue = issue_by_id.get(finding_id) or issue_by_finding_id.get(finding_id)
        if matched_issue is not None:
            return matched_issue

    title_key = _normalize_title_key(deviation.get("title"))
    if title_key:
        return issue_by_title.get(title_key)

    return None


def _build_issue_indexes(
    issues: list[dict[str, Any]]
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    issue_by_id: dict[str, dict[str, Any]] = {}
    issue_by_finding_id: dict[str, dict[str, Any]] = {}
    issue_by_title: dict[str, dict[str, Any]] = {}

    for issue in issues:
        issue_id = _normalize_reference_key(issue.get("id"))
        finding_id = _normalize_reference_key(issue.get("finding_id"))
        title_key = _normalize_title_key(issue.get("title"))
        if issue_id:
            issue_by_id[issue_id] = issue
        if finding_id and finding_id not in issue_by_finding_id:
            issue_by_finding_id[finding_id] = issue
        if title_key and title_key not in issue_by_title:
            issue_by_title[title_key] = issue

    return issue_by_id, issue_by_finding_id, issue_by_title


def _filter_issues_for_active_deviations(
    *,
    deviations: list[dict[str, Any]],
    issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not deviations or not issues:
        return issues

    issue_by_id, issue_by_finding_id, issue_by_title = _build_issue_indexes(issues)
    matched_issues: list[dict[str, Any]] = []
    seen_issue_keys: set[str] = set()

    for deviation in deviations:
        issue = _resolve_issue_for_deviation(
            deviation,
            issue_by_id=issue_by_id,
            issue_by_finding_id=issue_by_finding_id,
            issue_by_title=issue_by_title,
        )
        if issue is None:
            continue

        issue_key = (
            _normalize_reference_key(issue.get("id"))
            or _normalize_reference_key(issue.get("finding_id"))
            or f"title:{_normalize_title_key(issue.get('title'))}"
        )
        if issue_key in seen_issue_keys:
            continue
        seen_issue_keys.add(issue_key)
        matched_issues.append(issue)

    return matched_issues or issues


def summarize_decisions(
    *,
    deviations: list[dict[str, Any]],
    issues: list[dict[str, Any]],
) -> dict[str, int]:
    counts = dict(DEFAULT_DECISION_COUNTS)
    issue_by_id, issue_by_finding_id, issue_by_title = _build_issue_indexes(issues)

    for deviation in deviations:
        issue = _resolve_issue_for_deviation(
            deviation,
            issue_by_id=issue_by_id,
            issue_by_finding_id=issue_by_finding_id,
            issue_by_title=issue_by_title,
        )
        status = _normalize_issue_status(issue)
        counts[status] = counts.get(status, 0) + 1

    counts["total"] = len(deviations)
    counts["resolved_total"] = sum(
        counts.get(status, 0)
        for status in ("accepted", "rejected", "countered", "escalated", "resolved", "dismissed")
    )
    counts["blocking_total"] = counts.get("open", 0) + counts.get("under_review", 0)
    return counts


def resolve_active_round_context(
    *,
    contract_id: str,
    tenant_id: str,
    supabase,
) -> RoundBuildContext:
    try:
        versions_res = supabase.table("contract_versions") \
            .select(
                "id, contract_id, version_number, raw_text, uploaded_filename, "
                "pipeline_output, created_at, source, parent_version_id, finalized_at, finalized_by, "
                "risk_score, risk_level"
            ) \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .gt("version_number", 0) \
            .order("version_number", desc=True) \
            .execute()
    except Exception as exc:
        error_text = str(exc)
        if "contract_versions.source" not in error_text and "contract_versions.finalized_at" not in error_text:
            raise
        versions_res = supabase.table("contract_versions") \
            .select(
                "id, contract_id, version_number, raw_text, uploaded_filename, "
                "pipeline_output, created_at, risk_score, risk_level"
            ) \
            .eq("contract_id", contract_id) \
            .eq("tenant_id", tenant_id) \
            .gt("version_number", 0) \
            .order("version_number", desc=True) \
            .execute()
    versions = _sorted_versions(versions_res.data or [])
    if not versions:
        raise HTTPException(status_code=404, detail="No contract versions found.")

    material_versions = [version for version in versions if not is_working_draft_version(version)]
    if not material_versions:
        raise HTTPException(status_code=400, detail="No material contract versions found.")

    source_version = next(
        (
            version for version in material_versions
            if parse_pipeline_output(version.get("pipeline_output")).diff_result
            and parse_pipeline_output(version.get("pipeline_output")).diff_result.deviations
        ),
        None,
    )
    if source_version is None:
        raise HTTPException(status_code=400, detail="No active negotiation diff found for this contract.")

    source_index = material_versions.index(source_version)
    baseline_version = material_versions[source_index + 1] if source_index + 1 < len(material_versions) else None

    source_po = parse_pipeline_output(source_version.get("pipeline_output"))
    diff_result = source_po.diff_result.model_dump() if source_po.diff_result else {}
    deviations = diff_result.get("deviations") or []
    if not deviations:
        raise HTTPException(status_code=400, detail="No deviations found for the active negotiation round.")

    issues_res = supabase.table("negotiation_issues") \
        .select("id, finding_id, title, severity, status, linked_task_id, version_id, suggested_revision") \
        .eq("contract_id", contract_id) \
        .eq("tenant_id", tenant_id) \
        .eq("version_id", source_version["id"]) \
        .order("created_at") \
        .execute()
    issues = _filter_issues_for_active_deviations(
        deviations=deviations,
        issues=issues_res.data or [],
    )

    return RoundBuildContext(
        contract_id=contract_id,
        tenant_id=tenant_id,
        versions=material_versions,
        source_version=source_version,
        baseline_version=baseline_version,
        diff_result=diff_result,
        deviations=deviations,
        batna_fallbacks=diff_result.get("batna_fallbacks") or [],
        issues=issues,
    )


async def build_v3_merged_text(
    contract_id: str,
    tenant_id: str,
    supabase,
) -> tuple[str, dict[str, int]]:
    """
    Build V3 raw text by applying negotiation decisions to the active round V2.
    """
    context = resolve_active_round_context(
        contract_id=contract_id,
        tenant_id=tenant_id,
        supabase=supabase,
    )
    v2_text = str(context.source_version.get("raw_text") or "")
    merged_text = v2_text

    decision_counts = summarize_decisions(
        deviations=context.deviations,
        issues=context.issues,
    )
    issue_by_id, issue_by_finding_id, issue_by_title = _build_issue_indexes(context.issues)

    fallback_by_deviation_id: dict[str, dict[str, Any]] = {}
    for fallback in context.batna_fallbacks:
        deviation_id = str(fallback.get("deviation_id") or "").strip()
        if deviation_id:
            fallback_by_deviation_id[deviation_id] = fallback

    applied_changes = 0
    skipped_missing_coordinates = 0
    skipped_invalid_coordinates = 0
    rejected_replacements = 0
    countered_replacements = 0

    sorted_deviations = sorted(
        context.deviations,
        key=lambda deviation: ((deviation.get("v2_coordinates") or {}).get("start_char") or -1),
        reverse=True,
    )

    for deviation in sorted_deviations:
        issue = _resolve_issue_for_deviation(
            deviation,
            issue_by_id=issue_by_id,
            issue_by_finding_id=issue_by_finding_id,
            issue_by_title=issue_by_title,
        )
        status = _normalize_issue_status(issue)
        coords = deviation.get("v2_coordinates") or {}

        start = coords.get("start_char")
        end = coords.get("end_char")
        if not isinstance(start, int) or not isinstance(end, int):
            skipped_missing_coordinates += 1
            continue
        if start < 0 or end < start or end > len(merged_text):
            skipped_invalid_coordinates += 1
            continue

        replacement: str | None = None
        if status == "rejected":
            replacement = str(deviation.get("v1_text") or "")
            rejected_replacements += 1
        elif status == "countered":
            candidate_ids = [
                str(deviation.get("deviation_id") or "").strip(),
                str((issue or {}).get("id") or "").strip(),
                str((issue or {}).get("finding_id") or "").strip(),
            ]
            fallback = next(
                (
                    fallback_by_deviation_id[candidate_id]
                    for candidate_id in candidate_ids
                    if candidate_id and candidate_id in fallback_by_deviation_id
                ),
                None,
            )
            replacement = (
                str((fallback or {}).get("fallback_clause") or "")
                or str((issue or {}).get("suggested_revision") or "")
                or str(deviation.get("v1_text") or "")
            )
            if replacement:
                countered_replacements += 1
            else:
                replacement = None

        if replacement is None:
            continue

        merged_text = f"{merged_text[:start]}{replacement}{merged_text[end:]}"
        applied_changes += 1

    decision_counts["applied_changes"] = applied_changes
    decision_counts["skipped_missing_coordinates"] = skipped_missing_coordinates
    decision_counts["skipped_invalid_coordinates"] = skipped_invalid_coordinates
    decision_counts["rejected_replacements"] = rejected_replacements
    decision_counts["countered_replacements"] = countered_replacements
    return merged_text, decision_counts
