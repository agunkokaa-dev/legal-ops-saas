"""
Interactive War Room counsel chat engine.

Provides on-demand AI negotiation counsel with full contract, deviation, playbook,
law, and conversation context injected into each turn.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Iterable

try:  # pragma: no cover - availability depends on environment
    from anthropic import AsyncAnthropic
except Exception:  # pragma: no cover
    AsyncAnthropic = None  # type: ignore[assignment]

from qdrant_client.http.models import FieldCondition, Filter, MatchValue

from app.config import ANTHROPIC_API_KEY, NATIONAL_LAWS_COLLECTION, openai_client, qdrant
from app.counsel_prompts import (
    DEVIATION_COUNSEL_SYSTEM,
    GENERAL_STRATEGY_COUNSEL_SYSTEM,
    build_all_deviations_summary,
    build_contract_context,
    build_deviation_context,
    build_law_context,
    build_playbook_context,
    build_prior_rounds_summary,
)
from app.dependencies import TenantQdrantClient
from app.llm_output_sanitizer import sanitize_llm_text
from app.review_schemas import CounselSessionType
from app.pipeline_output_schema import parse_pipeline_output
from app.token_budget import allocate_budget

logger = logging.getLogger(__name__)

COUNSEL_MODEL = "claude-sonnet-4-6"
MAX_HISTORY_MESSAGES = 20
MAX_CONTEXT_TOKENS = 50_000

_anthropic_client: AsyncAnthropic | None = None


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _format_sse_event(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _format_session_started(session: dict[str, Any]) -> str:
    return _format_sse_event({
        "type": "session_started",
        "session_id": session["id"],
        "session_type": session.get("session_type"),
        "deviation_id": session.get("deviation_id"),
        "version_id": session.get("version_id"),
    })


def _format_chunk(text: str) -> str:
    return _format_sse_event({"type": "chunk", "content": text})


def _format_error(message: str) -> str:
    return _format_sse_event({"type": "error", "message": message})


def _format_done() -> str:
    return _format_sse_event({"type": "done"})


def _extract_text_from_response(response: Any) -> str:
    content_parts: list[str] = []
    for block in getattr(response, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            content_parts.append(text)
    return "".join(content_parts).strip()


def _session_type_value(value: Any) -> str:
    if isinstance(value, CounselSessionType):
        return value.value
    if hasattr(value, "value"):
        return str(getattr(value, "value"))
    return str(value)


def _get_anthropic_client() -> AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        if AsyncAnthropic is None:
            raise RuntimeError("Anthropic SDK is not installed.")
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
        _anthropic_client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


async def _embed_text(text: str) -> list[float]:
    response = await asyncio.to_thread(
        openai_client.embeddings.create,
        input=text,
        model="text-embedding-3-small",
    )
    return response.data[0].embedding


async def _query_points(client: Any, **kwargs) -> list[Any]:
    response = await asyncio.to_thread(client.query_points, **kwargs)
    return getattr(response, "points", []) or []


async def _load_session(
    *,
    supabase: Any,
    contract_id: str,
    session_id: str,
) -> dict[str, Any] | None:
    result = supabase.table("debate_sessions") \
        .select("*") \
        .eq("id", session_id) \
        .eq("contract_id", contract_id) \
        .eq("session_kind", "counsel") \
        .limit(1) \
        .execute()
    rows = result.data or []
    return rows[0] if rows else None


async def _load_latest_diff_version(
    *,
    supabase: Any,
    contract_id: str,
) -> dict[str, Any] | None:
    result = supabase.table("contract_versions") \
        .select("id, contract_id, version_number, raw_text, risk_score, risk_level, pipeline_output") \
        .eq("contract_id", contract_id) \
        .gt("version_number", 0) \
        .order("version_number", desc=True) \
        .limit(10) \
        .execute()
    for version in result.data or []:
        po = parse_pipeline_output(version.get("pipeline_output"))
        if po.diff_result:
            return version
    return None


async def _load_version_bundle(
    *,
    supabase: Any,
    contract_id: str,
    version_id: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    version_res = supabase.table("contract_versions") \
        .select("id, contract_id, version_number, raw_text, risk_score, risk_level, pipeline_output") \
        .eq("contract_id", contract_id) \
        .eq("id", version_id) \
        .limit(1) \
        .execute()
    current_rows = version_res.data or []
    if not current_rows:
        return None, None

    current_version = current_rows[0]
    previous_res = supabase.table("contract_versions") \
        .select("id, contract_id, version_number, raw_text, risk_score, risk_level, pipeline_output") \
        .eq("contract_id", contract_id) \
        .lt("version_number", current_version.get("version_number", 0)) \
        .gt("version_number", 0) \
        .order("version_number", desc=True) \
        .limit(1) \
        .execute()
    previous_rows = previous_res.data or []
    previous_version = previous_rows[0] if previous_rows else None
    return current_version, previous_version


async def _load_contract(
    *,
    supabase: Any,
    contract_id: str,
) -> dict[str, Any] | None:
    contract_res = supabase.table("contracts") \
        .select("id, title, contract_value, currency, jurisdiction, governing_law, status") \
        .eq("id", contract_id) \
        .limit(1) \
        .execute()
    rows = contract_res.data or []
    return rows[0] if rows else None


async def _load_prior_rounds(
    *,
    supabase: Any,
    contract_id: str,
) -> list[dict[str, Any]]:
    rounds_res = supabase.table("negotiation_rounds") \
        .select("round_number, diff_snapshot, concession_analysis, created_at") \
        .eq("contract_id", contract_id) \
        .order("round_number", desc=True) \
        .limit(5) \
        .execute()
    return rounds_res.data or []


def _find_deviation(diff_result: dict[str, Any], deviation_id: str | None) -> dict[str, Any] | None:
    if not deviation_id:
        return None
    deviations = diff_result.get("deviations") or []
    return next((item for item in deviations if str(item.get("deviation_id")) == str(deviation_id)), None)


def _find_batna(diff_result: dict[str, Any], deviation_id: str | None) -> dict[str, Any] | None:
    if not deviation_id:
        return None
    batnas = diff_result.get("batna_fallbacks") or []
    return next((item for item in batnas if str(item.get("deviation_id")) == str(deviation_id)), None)


async def _archive_active_scope_sessions(
    *,
    supabase: Any,
    contract_id: str,
    session_type: str,
    deviation_id: str | None,
) -> None:
    query = supabase.table("debate_sessions") \
        .update({
            "is_active": False,
            "updated_at": _utcnow_iso(),
        }) \
        .eq("contract_id", contract_id) \
        .eq("session_kind", "counsel") \
        .eq("session_type", session_type) \
        .eq("is_active", True)

    if deviation_id:
        query = query.eq("deviation_id", deviation_id)
    else:
        query = query.is_("deviation_id", "null")

    query.execute()


async def _create_session(
    *,
    supabase: Any,
    contract_id: str,
    tenant_id: str,
    version_id: str,
    session_type: str,
    deviation_id: str | None,
    deviation_snapshot: dict[str, Any] | None,
    issue_id: str | None,
) -> dict[str, Any]:
    await _archive_active_scope_sessions(
        supabase=supabase,
        contract_id=contract_id,
        session_type=session_type,
        deviation_id=deviation_id,
    )

    now = _utcnow_iso()
    session = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "contract_id": contract_id,
        "version_id": version_id,
        "issue_id": issue_id,
        "deviation_id": deviation_id,
        "deviation_snapshot": deviation_snapshot,
        "turns": [],
        "verdict": None,
        "status": "queued",
        "current_turn": 0,
        "total_turns": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "model_breakdown": {},
        "session_kind": "counsel",
        "session_type": session_type,
        "messages": [],
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "completed_at": None,
        "duration_ms": None,
        "error_message": None,
    }
    result = supabase.table("debate_sessions").insert(session).execute()
    rows = result.data or []
    return rows[0] if rows else session


async def _append_messages(
    *,
    supabase: Any,
    session: dict[str, Any],
    messages: Iterable[dict[str, Any]],
    status: str | None = None,
    duration_ms: int | None = None,
    error_message: str | None = None,
) -> dict[str, Any]:
    existing_messages = list(session.get("messages") or [])
    existing_messages.extend(messages)

    update_payload: dict[str, Any] = {
        "messages": existing_messages,
        "updated_at": _utcnow_iso(),
    }
    if status is not None:
        update_payload["status"] = status
    if duration_ms is not None:
        update_payload["duration_ms"] = duration_ms
    if error_message is not None or status == "completed":
        update_payload["error_message"] = error_message
    if status in {"completed", "failed"}:
        update_payload["completed_at"] = _utcnow_iso()

    supabase.table("debate_sessions").update(update_payload) \
        .eq("id", session["id"]) \
        .eq("session_kind", "counsel") \
        .execute()
    session = dict(session)
    session.update(update_payload)
    return session


async def _mark_session_status(
    *,
    supabase: Any,
    session: dict[str, Any],
    status: str,
) -> dict[str, Any]:
    payload = {
        "status": status,
        "updated_at": _utcnow_iso(),
    }
    if status == "running":
        payload["completed_at"] = None
        payload["error_message"] = None
    if status in {"completed", "failed"}:
        payload["completed_at"] = _utcnow_iso()
    supabase.table("debate_sessions").update(payload) \
        .eq("id", session["id"]) \
        .eq("session_kind", "counsel") \
        .execute()
    session = dict(session)
    session.update(payload)
    return session


def _build_history_messages(session: dict[str, Any]) -> list[dict[str, str]]:
    messages = []
    for message in (session.get("messages") or [])[-MAX_HISTORY_MESSAGES:]:
        role = message.get("role")
        if role in {"user", "assistant"}:
            messages.append({
                "role": role,
                "content": str(message.get("content") or ""),
            })
    return messages


def _build_query_text(
    *,
    message: str,
    deviation: dict[str, Any] | None,
    diff_result: dict[str, Any],
    prior_rounds_summary: str,
) -> str:
    parts = [
        message,
        (deviation or {}).get("title"),
        (deviation or {}).get("impact_analysis"),
        (deviation or {}).get("v1_text"),
        (deviation or {}).get("v2_text"),
        diff_result.get("summary"),
        prior_rounds_summary,
    ]
    return "\n".join(part for part in parts if part)


async def _load_reference_context(
    *,
    qdrant_client: TenantQdrantClient,
    query_text: str,
) -> tuple[str, str]:
    if not query_text.strip():
        return "Playbook rules unavailable.", "National law provisions unavailable."

    try:
        query_vector = await _embed_text(query_text[:4000])
    except Exception as exc:
        logger.warning("[COUNSEL] Embedding retrieval failed: %s", exc)
        return "Playbook rules unavailable.", "National law provisions unavailable."

    playbook_task = _query_points(
        qdrant_client,
        collection_name="company_rules",
        query=query_vector,
        limit=10,
        with_payload=True,
    )
    law_task = _query_points(
        qdrant,
        collection_name=NATIONAL_LAWS_COLLECTION,
        query=query_vector,
        query_filter=Filter(
            must=[FieldCondition(key="is_active", match=MatchValue(value=True))]
        ),
        limit=10,
        with_payload=True,
    )

    playbook_results, law_results = await asyncio.gather(playbook_task, law_task, return_exceptions=True)

    if isinstance(playbook_results, BaseException):
        logger.warning("[COUNSEL] Playbook retrieval failed: %s", playbook_results)
        playbook_context = "Playbook rules unavailable."
    else:
        playbook_context = build_playbook_context(playbook_results)

    if isinstance(law_results, BaseException):
        logger.warning("[COUNSEL] National law retrieval failed: %s", law_results)
        law_context = "National law provisions unavailable."
    else:
        law_context = build_law_context(law_results)

    return playbook_context, law_context


def _build_budgeted_context(
    *,
    contract: dict[str, Any] | None,
    current_version: dict[str, Any],
    previous_version: dict[str, Any] | None,
    diff_result: dict[str, Any],
    deviation: dict[str, Any] | None,
    batna: dict[str, Any] | None,
    playbook_context: str,
    law_context: str,
    prior_rounds_summary: str,
    session_type: Any,
) -> tuple[tuple[str, str, str, str, str], str]:
    deviations_summary = build_all_deviations_summary(diff_result.get("deviations") or [])
    deviation_context = build_deviation_context(deviation or {}, batna) if deviation else "No deviation context selected."

    raw_budget = allocate_budget(
        inputs={
            "v1_text": (previous_version or {}).get("raw_text") or "",
            "v2_text": current_version.get("raw_text") or "",
            "all_deviations": deviations_summary,
            "playbook_context": playbook_context,
            "law_context": law_context,
            "prior_rounds": prior_rounds_summary,
        },
        priorities={
            "v1_text": 2,
            "v2_text": 3,
            "all_deviations": 2 if _session_type_value(session_type) == CounselSessionType.GENERAL_STRATEGY.value else 1,
            "playbook_context": 2,
            "law_context": 2,
            "prior_rounds": 1,
        },
        total_budget=MAX_CONTEXT_TOKENS,
        model="gpt-4o",
        system_prompt_tokens=5_000,
    )

    contract_context = build_contract_context(
        contract or {},
        current_version,
        previous_version,
        diff_result,
        v1_excerpt=raw_budget["v1_text"][0],
        v2_excerpt=raw_budget["v2_text"][0],
    )

    return (
        deviation_context,
        contract_context,
        raw_budget["all_deviations"][0],
        raw_budget["playbook_context"][0],
        raw_budget["law_context"][0],
    ), raw_budget["prior_rounds"][0]


async def _stream_counsel_completion(
    *,
    system_prompt: str,
    messages: list[dict[str, str]],
) -> AsyncGenerator[str, None]:
    client = _get_anthropic_client()

    if hasattr(client.messages, "stream"):
        async with client.messages.stream(
            model=COUNSEL_MODEL,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield text
        return

    response = await client.messages.create(
        model=COUNSEL_MODEL,
        max_tokens=4096,
        system=system_prompt,
        messages=messages,
    )
    fallback_text = _extract_text_from_response(response)
    if fallback_text:
        yield fallback_text


async def handle_counsel_message(
    *,
    message: str,
    contract_id: str,
    tenant_id: str,
    session_id: str | None,
    session_type: str,
    deviation_id: str | None,
    supabase: Any,
    qdrant_client: TenantQdrantClient,
) -> AsyncGenerator[str, None]:
    """
    Handle a single counsel chat turn and stream the response as SSE chunks.
    """
    started_at = time.perf_counter()
    session_type_value = _session_type_value(session_type)

    session = await _load_session(
        supabase=supabase,
        contract_id=contract_id,
        session_id=session_id,
    ) if session_id else None

    if session:
        effective_session_type = _session_type_value(session.get("session_type") or session_type_value)
        effective_deviation_id = session.get("deviation_id") or deviation_id
        version_id = session.get("version_id")
        if not version_id:
            logger.warning("[COUNSEL] Session %s missing version_id", session["id"])
            yield _format_error("Counsel session is missing its pinned contract version.")
            yield _format_done()
            return
        current_version, previous_version = await _load_version_bundle(
            supabase=supabase,
            contract_id=contract_id,
            version_id=version_id,
        )
    else:
        effective_session_type = session_type_value
        effective_deviation_id = deviation_id
        current_version = await _load_latest_diff_version(
            supabase=supabase,
            contract_id=contract_id,
        )
        previous_version = None
        if current_version:
            current_version, previous_version = await _load_version_bundle(
                supabase=supabase,
                contract_id=contract_id,
                version_id=current_version["id"],
            )

    if not current_version:
        yield _format_error("Diff result belum tersedia untuk kontrak ini. Jalankan Smart Diff terlebih dahulu.")
        yield _format_done()
        return

    po = parse_pipeline_output(current_version.get("pipeline_output"))
    diff_result = po.diff_result.model_dump() if po.diff_result else None
    if not diff_result:
        yield _format_error("Diff result belum tersedia untuk kontrak ini. Jalankan Smart Diff terlebih dahulu.")
        yield _format_done()
        return

    deviation = _find_deviation(diff_result, effective_deviation_id)
    batna = _find_batna(diff_result, effective_deviation_id)

    if effective_session_type == CounselSessionType.DEVIATION.value and not deviation:
        yield _format_error("Deviation yang dipilih tidak ditemukan pada hasil Smart Diff yang dipin.")
        yield _format_done()
        return

    contract, prior_rounds = await asyncio.gather(
        _load_contract(supabase=supabase, contract_id=contract_id),
        _load_prior_rounds(supabase=supabase, contract_id=contract_id),
    )
    prior_rounds_summary = build_prior_rounds_summary(prior_rounds)

    if not session:
        session = await _create_session(
            supabase=supabase,
            contract_id=contract_id,
            tenant_id=tenant_id,
            version_id=current_version["id"],
            session_type=effective_session_type,
            deviation_id=effective_deviation_id,
            deviation_snapshot=deviation if effective_session_type == CounselSessionType.DEVIATION.value else None,
            issue_id=effective_deviation_id if effective_session_type == CounselSessionType.DEVIATION.value else None,
        )

    yield _format_session_started(session)

    user_message = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": message,
        "timestamp": _utcnow_iso(),
        "deviation_id": effective_deviation_id,
        "metadata": {
            "session_type": effective_session_type,
            "version_id": current_version["id"],
        },
    }

    session = await _mark_session_status(
        supabase=supabase,
        session=session,
        status="running",
    )
    session = await _append_messages(
        supabase=supabase,
        session=session,
        messages=[user_message],
    )

    query_text = _build_query_text(
        message=message,
        deviation=deviation,
        diff_result=diff_result,
        prior_rounds_summary=prior_rounds_summary,
    )
    playbook_context, law_context = await _load_reference_context(
        qdrant_client=qdrant_client,
        query_text=query_text,
    )
    (deviation_context, contract_context, all_deviations_context, playbook_context, law_context), prior_rounds_context = _build_budgeted_context(
        contract=contract,
        current_version=current_version,
        previous_version=previous_version,
        diff_result=diff_result,
        deviation=deviation,
        batna=batna,
        playbook_context=playbook_context,
        law_context=law_context,
        prior_rounds_summary=prior_rounds_summary,
        session_type=effective_session_type,
    )

    if effective_session_type == CounselSessionType.DEVIATION.value:
        system_prompt = DEVIATION_COUNSEL_SYSTEM.format(
            deviation_context=deviation_context,
            contract_context=contract_context,
            prior_rounds_context=prior_rounds_context,
            playbook_context=playbook_context,
            law_context=law_context,
        )
    else:
        system_prompt = GENERAL_STRATEGY_COUNSEL_SYSTEM.format(
            diff_summary_context=contract_context,
            contract_context=contract_context,
            prior_rounds_context=prior_rounds_context,
            all_deviations_context=all_deviations_context,
            playbook_context=playbook_context,
            law_context=law_context,
        )

    messages = _build_history_messages(session)
    full_response = ""

    try:
        async for text in _stream_counsel_completion(
            system_prompt=system_prompt,
            messages=messages,
        ):
            if not text:
                continue
            full_response += text
            yield _format_chunk(text)
    except Exception as exc:
        logger.exception("[COUNSEL] Streaming failed for contract=%s session=%s", contract_id, session["id"])
        error_text = "Maaf, terjadi kesalahan saat memproses pesan Anda. Silakan coba lagi."
        assistant_message = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": error_text,
            "timestamp": _utcnow_iso(),
            "deviation_id": effective_deviation_id,
            "metadata": {
                "model": COUNSEL_MODEL,
                "version_id": current_version["id"],
            },
        }
        await _append_messages(
            supabase=supabase,
            session=session,
            messages=[assistant_message],
            status="failed",
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            error_message=str(exc)[:2000],
        )
        yield _format_error(error_text)
        yield _format_done()
        return

    safe_response = sanitize_llm_text(
        full_response,
        field_name="counsel_response",
        strict=False,
    )

    assistant_message = {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "content": safe_response,
        "timestamp": _utcnow_iso(),
        "deviation_id": effective_deviation_id,
        "metadata": {
            "model": COUNSEL_MODEL,
            "duration_ms": int((time.perf_counter() - started_at) * 1000),
            "version_id": current_version["id"],
        },
    }
    await _append_messages(
        supabase=supabase,
        session=session,
        messages=[assistant_message],
        status="completed",
        duration_ms=int((time.perf_counter() - started_at) * 1000),
        error_message=None,
    )
    yield _format_done()
