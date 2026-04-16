from __future__ import annotations

import asyncio
import logging
import operator
import time
from datetime import datetime, timezone
from typing import Annotated, Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph
from qdrant_client.http.models import FieldCondition, Filter, MatchValue

from app.config import ANTHROPIC_API_KEY, NATIONAL_LAWS_COLLECTION, openai_client, qdrant
from app.debate.prompts import (
    DEFENDER_SYSTEM,
    JUDGE_SYSTEM,
    LANGUAGE_MIRROR_INSTRUCTION,
    PROSECUTOR_SYSTEM,
    build_debate_context,
    build_turn_history,
)
from app.debate.schemas import (
    DebateRole,
    DebateTurn,
    DefenderOutput,
    JudgeOutput,
    JudgeVerdict,
    ProsecutorOutput,
)
from app.dependencies import TenantQdrantClient, get_tenant_admin_supabase
from app.event_bus import SSEEvent, event_bus

try:  # pragma: no cover - import availability depends on env
    from anthropic import Anthropic
except Exception:  # pragma: no cover
    Anthropic = None  # type: ignore[assignment]


logger = logging.getLogger(__name__)

OPENAI_DEBATE_MODEL = "gpt-4o"
ANTHROPIC_JUDGE_MODEL = "claude-3-5-sonnet-20241022"
JUDGE_TOOL_NAME = "submit_judge_verdict"

_anthropic_client: Any | None = None


class DebateState(TypedDict, total=False):
    deviation: dict
    v1_text: str
    v2_text: str
    playbook_rules: list[str]
    national_law_context: list[str]
    batna_fallback: Optional[dict]
    contract_metadata: dict
    shared_context: str

    turns: Annotated[list[dict], operator.add]
    verdict: Optional[dict]

    contract_id: str
    tenant_id: str
    debate_session_id: str
    issue_id: Optional[str]

    total_input_tokens: int
    total_output_tokens: int
    model_breakdown: dict[str, int]


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is None:
        if Anthropic is None:
            raise RuntimeError("Anthropic SDK is not installed.")
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
        _anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


async def _publish_event(
    *,
    event_type: str,
    tenant_id: str,
    contract_id: str,
    data: dict[str, Any],
) -> None:
    await event_bus.publish(SSEEvent(
        event_type=event_type,
        tenant_id=tenant_id,
        contract_id=contract_id,
        data=data,
    ))


def _increment_model_breakdown(
    current: dict[str, int] | None,
    model_name: str,
) -> dict[str, int]:
    next_counts = dict(current or {})
    next_counts[model_name] = next_counts.get(model_name, 0) + 1
    return next_counts


def _extract_anthropic_tool_input(response: Any, tool_name: str) -> dict[str, Any]:
    for block in getattr(response, "content", []) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == tool_name:
            return dict(getattr(block, "input", {}) or {})
    raise RuntimeError("Anthropic response did not return the expected tool payload.")


async def _call_openai_agent(
    *,
    system_prompt: str,
    user_message: str,
    response_model: Any,
    model: str = OPENAI_DEBATE_MODEL,
) -> tuple[dict[str, Any], int, int]:
    response = await asyncio.to_thread(
        openai_client.beta.chat.completions.parse,
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        response_format=response_model,
    )
    parsed = response.choices[0].message.parsed
    usage = getattr(response, "usage", None)
    return (
        parsed.model_dump(),
        int(getattr(usage, "prompt_tokens", 0) or 0),
        int(getattr(usage, "completion_tokens", 0) or 0),
    )


async def _call_judge_agent(
    *,
    system_prompt: str,
    user_message: str,
    model: str = ANTHROPIC_JUDGE_MODEL,
) -> tuple[dict[str, Any], int, int]:
    client = get_anthropic_client()
    response = await asyncio.to_thread(
        client.messages.create,
        model=model,
        max_tokens=2_500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
        tools=[{
            "name": JUDGE_TOOL_NAME,
            "description": "Submit the final structured judge verdict for this debate.",
            "input_schema": JudgeOutput.model_json_schema(),
        }],
        tool_choice={"type": "tool", "name": JUDGE_TOOL_NAME},
    )
    payload = _extract_anthropic_tool_input(response, JUDGE_TOOL_NAME)
    parsed = JudgeOutput(**payload)
    usage = getattr(response, "usage", None)
    return (
        parsed.model_dump(),
        int(getattr(usage, "input_tokens", 0) or 0),
        int(getattr(usage, "output_tokens", 0) or 0),
    )


async def _persist_turn_progress(
    *,
    session_id: str,
    tenant_id: str,
    turns: list[dict[str, Any]],
    current_turn: int,
    total_input_tokens: int,
    total_output_tokens: int,
    model_breakdown: dict[str, int],
    verdict: dict[str, Any] | None = None,
) -> None:
    tenant_sb = get_tenant_admin_supabase(tenant_id)
    payload: dict[str, Any] = {
        "turns": turns,
        "current_turn": current_turn,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "model_breakdown": model_breakdown,
    }
    if verdict is not None:
        payload["verdict"] = verdict
    tenant_sb.table("debate_sessions").update(payload) \
        .eq("id", session_id) \
        .eq("session_kind", "debate") \
        .execute()


def _format_playbook_rule(hit: Any) -> str:
    payload = dict(getattr(hit, "payload", {}) or {})
    text = payload.get("rule_text") or payload.get("content") or payload.get("text") or ""
    section = payload.get("section") or payload.get("rule_id") or payload.get("title") or ""
    if section:
        return f"{section}: {text}".strip(": ")
    return text or "Playbook rule"


def _format_law_hit(hit: Any) -> str:
    payload = dict(getattr(hit, "payload", {}) or {})
    source = payload.get("source_law_short") or payload.get("source") or "Regulation"
    pasal = payload.get("pasal") or payload.get("article") or ""
    text = payload.get("text") or payload.get("content") or ""
    label = f"{source} {f'Pasal {pasal}' if pasal else ''}".strip()
    return f"{label}: {text}".strip(": ")


async def _embed_text(text: str) -> list[float]:
    response = await asyncio.to_thread(
        openai_client.embeddings.create,
        input=text,
        model="text-embedding-3-small",
    )
    return response.data[0].embedding


async def _fetch_playbook_rules(tenant_id: str, query_text: str) -> list[str]:
    tenant_qdrant = TenantQdrantClient(tenant_id, qdrant)
    try:
        query_vector = await _embed_text(query_text)
        response = await asyncio.to_thread(
            tenant_qdrant.query_points,
            collection_name="company_rules",
            query=query_vector,
            limit=5,
            with_payload=True,
        )
        hits = getattr(response, "points", []) or []
        formatted = [_format_playbook_rule(hit) for hit in hits if _format_playbook_rule(hit)]
        if formatted:
            return formatted[:5]
    except Exception as exc:
        logger.warning("Debate playbook semantic retrieval failed: %s", exc)

    try:
        hits, _ = await asyncio.to_thread(
            tenant_qdrant.scroll,
            collection_name="company_rules",
            limit=5,
        )
        return [_format_playbook_rule(hit) for hit in (hits or []) if _format_playbook_rule(hit)][:5]
    except Exception as exc:
        logger.warning("Debate playbook scroll fallback failed: %s", exc)
        return []


async def _fetch_national_laws(query_text: str) -> list[str]:
    try:
        query_vector = await _embed_text(query_text)
        response = await asyncio.to_thread(
            qdrant.query_points,
            collection_name=NATIONAL_LAWS_COLLECTION,
            query=query_vector,
            query_filter=Filter(
                must=[FieldCondition(key="is_active", match=MatchValue(value=True))]
            ),
            limit=5,
            with_payload=True,
        )
        hits = getattr(response, "points", []) or []
        return [_format_law_hit(hit) for hit in hits if _format_law_hit(hit)][:5]
    except Exception as exc:
        logger.warning("Debate national-law retrieval failed: %s", exc)
        return []


async def _load_debate_context(
    *,
    contract_id: str,
    tenant_id: str,
    deviation_snapshot: dict[str, Any],
) -> dict[str, Any]:
    tenant_sb = get_tenant_admin_supabase(tenant_id)
    contract_res = tenant_sb.table("contracts").select(
        "id, title, contract_value, currency, jurisdiction, governing_law"
    ).eq("id", contract_id).limit(1).execute()
    contract_metadata = (contract_res.data or [{}])[0]

    v1_text = deviation_snapshot.get("v1_text") or ""
    v2_text = deviation_snapshot.get("v2_text") or ""
    query_text = "\n".join(filter(None, [
        deviation_snapshot.get("title"),
        deviation_snapshot.get("impact_analysis"),
        v1_text[:1500],
        v2_text[:1500],
    ]))

    playbook_rules, national_law_context = await asyncio.gather(
        _fetch_playbook_rules(tenant_id, query_text or v2_text or v1_text),
        _fetch_national_laws(query_text or v2_text or v1_text),
    )

    return {
        "deviation": deviation_snapshot,
        "v1_text": v1_text,
        "v2_text": v2_text,
        "playbook_rules": playbook_rules,
        "national_law_context": national_law_context,
        "batna_fallback": deviation_snapshot.get("batna_fallback") or deviation_snapshot.get("batna"),
        "contract_metadata": contract_metadata,
    }


async def prep_node(state: DebateState) -> dict[str, Any]:
    return {
        "shared_context": build_debate_context(
            deviation=state["deviation"],
            v1_text=state["v1_text"],
            v2_text=state["v2_text"],
            playbook_rules=state.get("playbook_rules", []),
            national_law_context=state.get("national_law_context", []),
            batna_fallback=state.get("batna_fallback"),
            contract_metadata=state.get("contract_metadata", {}),
        )
    }


async def prosecutor_turn_1(state: DebateState) -> dict[str, Any]:
    start = time.perf_counter()
    system_prompt = PROSECUTOR_SYSTEM.format(
        language_instruction=LANGUAGE_MIRROR_INSTRUCTION
    )
    user_message = (
        f"{state['shared_context']}\n\n"
        "You are making your OPENING ARGUMENT. Present the strongest case for rejecting this deviation."
    )
    result, input_tokens, output_tokens = await _call_openai_agent(
        system_prompt=system_prompt,
        user_message=user_message,
        response_model=ProsecutorOutput,
    )
    turn = DebateTurn(
        turn_number=1,
        role=DebateRole.PROSECUTOR,
        agent_name="Legal Risk Prosecutor",
        model=OPENAI_DEBATE_MODEL,
        argument=result["argument"],
        key_points=result["key_points"],
        evidence_cited=result.get("evidence_cited", []),
        confidence=result["confidence"],
        tokens_used={"input": input_tokens, "output": output_tokens},
        duration_ms=int((time.perf_counter() - start) * 1000),
    ).model_dump(mode="json")
    turns = [*state.get("turns", []), turn]
    total_input_tokens = state.get("total_input_tokens", 0) + input_tokens
    total_output_tokens = state.get("total_output_tokens", 0) + output_tokens
    model_breakdown = _increment_model_breakdown(state.get("model_breakdown"), OPENAI_DEBATE_MODEL)
    await _persist_turn_progress(
        session_id=state["debate_session_id"],
        tenant_id=state["tenant_id"],
        turns=turns,
        current_turn=1,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        model_breakdown=model_breakdown,
    )
    await _publish_event(
        event_type="debate.turn_completed",
        tenant_id=state["tenant_id"],
        contract_id=state["contract_id"],
        data={
            "debate_session_id": state["debate_session_id"],
            "turn_number": 1,
            "role": DebateRole.PROSECUTOR.value,
            "key_points_preview": result["key_points"][:2],
            "confidence": result["confidence"],
        },
    )
    return {
        "turns": [turn],
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "model_breakdown": model_breakdown,
    }


async def defender_turn_1(state: DebateState) -> dict[str, Any]:
    start = time.perf_counter()
    system_prompt = DEFENDER_SYSTEM.format(
        language_instruction=LANGUAGE_MIRROR_INSTRUCTION
    )
    user_message = (
        f"{state['shared_context']}\n\n"
        f"{build_turn_history(state.get('turns', []))}\n\n"
        "You are making your OPENING ARGUMENT in response to the Prosecutor. Address their strongest concerns directly."
    )
    result, input_tokens, output_tokens = await _call_openai_agent(
        system_prompt=system_prompt,
        user_message=user_message,
        response_model=DefenderOutput,
    )
    turn = DebateTurn(
        turn_number=2,
        role=DebateRole.DEFENDER,
        agent_name="Business Value Defender",
        model=OPENAI_DEBATE_MODEL,
        argument=result["argument"],
        key_points=result["key_points"],
        evidence_cited=result.get("evidence_cited", []),
        responding_to=result.get("responding_to"),
        concession=result.get("concession"),
        confidence=result["confidence"],
        tokens_used={"input": input_tokens, "output": output_tokens},
        duration_ms=int((time.perf_counter() - start) * 1000),
    ).model_dump(mode="json")
    turns = [*state.get("turns", []), turn]
    total_input_tokens = state.get("total_input_tokens", 0) + input_tokens
    total_output_tokens = state.get("total_output_tokens", 0) + output_tokens
    model_breakdown = _increment_model_breakdown(state.get("model_breakdown"), OPENAI_DEBATE_MODEL)
    await _persist_turn_progress(
        session_id=state["debate_session_id"],
        tenant_id=state["tenant_id"],
        turns=turns,
        current_turn=2,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        model_breakdown=model_breakdown,
    )
    await _publish_event(
        event_type="debate.turn_completed",
        tenant_id=state["tenant_id"],
        contract_id=state["contract_id"],
        data={
            "debate_session_id": state["debate_session_id"],
            "turn_number": 2,
            "role": DebateRole.DEFENDER.value,
            "key_points_preview": result["key_points"][:2],
            "confidence": result["confidence"],
        },
    )
    return {
        "turns": [turn],
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "model_breakdown": model_breakdown,
    }


async def prosecutor_rebuttal(state: DebateState) -> dict[str, Any]:
    start = time.perf_counter()
    system_prompt = PROSECUTOR_SYSTEM.format(
        language_instruction=LANGUAGE_MIRROR_INSTRUCTION
    )
    user_message = (
        f"{state['shared_context']}\n\n"
        f"{build_turn_history(state.get('turns', []))}\n\n"
        "You are making your REBUTTAL. Acknowledge valid business points, then explain why the remaining legal and compliance risks still dominate."
    )
    result, input_tokens, output_tokens = await _call_openai_agent(
        system_prompt=system_prompt,
        user_message=user_message,
        response_model=ProsecutorOutput,
    )
    turn = DebateTurn(
        turn_number=3,
        role=DebateRole.PROSECUTOR,
        agent_name="Legal Risk Prosecutor",
        model=OPENAI_DEBATE_MODEL,
        argument=result["argument"],
        key_points=result["key_points"],
        evidence_cited=result.get("evidence_cited", []),
        responding_to=result.get("responding_to"),
        concession=result.get("concession"),
        confidence=result["confidence"],
        tokens_used={"input": input_tokens, "output": output_tokens},
        duration_ms=int((time.perf_counter() - start) * 1000),
    ).model_dump(mode="json")
    turns = [*state.get("turns", []), turn]
    total_input_tokens = state.get("total_input_tokens", 0) + input_tokens
    total_output_tokens = state.get("total_output_tokens", 0) + output_tokens
    model_breakdown = _increment_model_breakdown(state.get("model_breakdown"), OPENAI_DEBATE_MODEL)
    await _persist_turn_progress(
        session_id=state["debate_session_id"],
        tenant_id=state["tenant_id"],
        turns=turns,
        current_turn=3,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        model_breakdown=model_breakdown,
    )
    await _publish_event(
        event_type="debate.turn_completed",
        tenant_id=state["tenant_id"],
        contract_id=state["contract_id"],
        data={
            "debate_session_id": state["debate_session_id"],
            "turn_number": 3,
            "role": DebateRole.PROSECUTOR.value,
            "key_points_preview": result["key_points"][:2],
            "confidence": result["confidence"],
        },
    )
    return {
        "turns": [turn],
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "model_breakdown": model_breakdown,
    }


async def defender_rebuttal(state: DebateState) -> dict[str, Any]:
    start = time.perf_counter()
    system_prompt = DEFENDER_SYSTEM.format(
        language_instruction=LANGUAGE_MIRROR_INSTRUCTION
    )
    user_message = (
        f"{state['shared_context']}\n\n"
        f"{build_turn_history(state.get('turns', []))}\n\n"
        "You are making your FINAL REBUTTAL. Focus on the most practical path forward and answer the Prosecutor's strongest remaining concern."
    )
    result, input_tokens, output_tokens = await _call_openai_agent(
        system_prompt=system_prompt,
        user_message=user_message,
        response_model=DefenderOutput,
    )
    turn = DebateTurn(
        turn_number=4,
        role=DebateRole.DEFENDER,
        agent_name="Business Value Defender",
        model=OPENAI_DEBATE_MODEL,
        argument=result["argument"],
        key_points=result["key_points"],
        evidence_cited=result.get("evidence_cited", []),
        responding_to=result.get("responding_to"),
        concession=result.get("concession"),
        confidence=result["confidence"],
        tokens_used={"input": input_tokens, "output": output_tokens},
        duration_ms=int((time.perf_counter() - start) * 1000),
    ).model_dump(mode="json")
    turns = [*state.get("turns", []), turn]
    total_input_tokens = state.get("total_input_tokens", 0) + input_tokens
    total_output_tokens = state.get("total_output_tokens", 0) + output_tokens
    model_breakdown = _increment_model_breakdown(state.get("model_breakdown"), OPENAI_DEBATE_MODEL)
    await _persist_turn_progress(
        session_id=state["debate_session_id"],
        tenant_id=state["tenant_id"],
        turns=turns,
        current_turn=4,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        model_breakdown=model_breakdown,
    )
    await _publish_event(
        event_type="debate.turn_completed",
        tenant_id=state["tenant_id"],
        contract_id=state["contract_id"],
        data={
            "debate_session_id": state["debate_session_id"],
            "turn_number": 4,
            "role": DebateRole.DEFENDER.value,
            "key_points_preview": result["key_points"][:2],
            "confidence": result["confidence"],
        },
    )
    return {
        "turns": [turn],
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "model_breakdown": model_breakdown,
    }


async def judge_verdict(state: DebateState) -> dict[str, Any]:
    system_prompt = JUDGE_SYSTEM.format(
        language_instruction=LANGUAGE_MIRROR_INSTRUCTION
    )
    user_message = (
        f"{state['shared_context']}\n\n"
        f"{build_turn_history(state.get('turns', []))}\n\n"
        "Deliver the final verdict. Use the structured output tool and provide the best recommendation for the business."
    )
    result, input_tokens, output_tokens = await _call_judge_agent(
        system_prompt=system_prompt,
        user_message=user_message,
    )
    verdict = JudgeVerdict(**result).model_dump(mode="json")
    total_input_tokens = state.get("total_input_tokens", 0) + input_tokens
    total_output_tokens = state.get("total_output_tokens", 0) + output_tokens
    model_breakdown = _increment_model_breakdown(state.get("model_breakdown"), ANTHROPIC_JUDGE_MODEL)
    await _persist_turn_progress(
        session_id=state["debate_session_id"],
        tenant_id=state["tenant_id"],
        turns=state.get("turns", []),
        current_turn=5,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        model_breakdown=model_breakdown,
        verdict=verdict,
    )
    await _publish_event(
        event_type="debate.verdict_ready",
        tenant_id=state["tenant_id"],
        contract_id=state["contract_id"],
        data={
            "debate_session_id": state["debate_session_id"],
            "recommendation": verdict["recommendation"],
            "confidence": verdict["confidence"],
            "suggested_action": verdict["suggested_action"],
        },
    )
    return {
        "verdict": verdict,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "model_breakdown": model_breakdown,
    }


def build_debate_graph():
    workflow = StateGraph(DebateState)
    workflow.add_node("prep", prep_node)
    workflow.add_node("prosecutor_1", prosecutor_turn_1)
    workflow.add_node("defender_1", defender_turn_1)
    workflow.add_node("prosecutor_2", prosecutor_rebuttal)
    workflow.add_node("defender_2", defender_rebuttal)
    workflow.add_node("judge", judge_verdict)
    workflow.add_edge(START, "prep")
    workflow.add_edge("prep", "prosecutor_1")
    workflow.add_edge("prosecutor_1", "defender_1")
    workflow.add_edge("defender_1", "prosecutor_2")
    workflow.add_edge("prosecutor_2", "defender_2")
    workflow.add_edge("defender_2", "judge")
    workflow.add_edge("judge", END)
    return workflow.compile()


debate_graph = build_debate_graph()


async def _append_issue_reasoning_log(
    *,
    tenant_id: str,
    issue_id: str | None,
    recommendation: str,
    confidence: float,
) -> None:
    if not issue_id:
        return

    tenant_sb = get_tenant_admin_supabase(tenant_id)
    issue_res = tenant_sb.table("negotiation_issues").select("reasoning_log").eq("id", issue_id).limit(1).execute()
    if not issue_res.data:
        return
    current_log = list(issue_res.data[0].get("reasoning_log") or [])
    current_log.append({
        "action": "debate_completed",
        "actor": "AI Debate Judge",
        "reason": f"AI Debate completed. Verdict: {recommendation} (confidence: {round(confidence * 100)}%).",
        "timestamp": _utcnow_iso(),
    })
    tenant_sb.table("negotiation_issues").update({
        "reasoning_log": current_log,
    }).eq("id", issue_id).execute()


async def run_debate_and_persist(
    *,
    debate_session_id: str,
    contract_id: str,
    tenant_id: str,
    issue_id: str | None,
    deviation_snapshot: dict[str, Any],
) -> dict[str, Any]:
    started_at = time.perf_counter()
    tenant_sb = get_tenant_admin_supabase(tenant_id)
    tenant_sb.table("debate_sessions").update({
        "status": "running",
        "current_turn": 0,
    }).eq("id", debate_session_id).eq("session_kind", "debate").execute()

    await _publish_event(
        event_type="debate.started",
        tenant_id=tenant_id,
        contract_id=contract_id,
        data={
            "debate_session_id": debate_session_id,
            "deviation_id": deviation_snapshot.get("deviation_id"),
            "total_turns": 5,
        },
    )

    context = await _load_debate_context(
        contract_id=contract_id,
        tenant_id=tenant_id,
        deviation_snapshot=deviation_snapshot,
    )

    try:
        final_state = await debate_graph.ainvoke({
            **context,
            "turns": [],
            "verdict": None,
            "contract_id": contract_id,
            "tenant_id": tenant_id,
            "debate_session_id": debate_session_id,
            "issue_id": issue_id,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "model_breakdown": {},
        })
        duration_ms = int((time.perf_counter() - started_at) * 1000)
        tenant_sb.table("debate_sessions").update({
            "status": "completed",
            "current_turn": 5,
            "turns": final_state.get("turns", []),
            "verdict": final_state.get("verdict"),
            "total_input_tokens": final_state.get("total_input_tokens", 0),
            "total_output_tokens": final_state.get("total_output_tokens", 0),
            "model_breakdown": final_state.get("model_breakdown", {}),
            "completed_at": _utcnow_iso(),
            "duration_ms": duration_ms,
            "error_message": None,
        }).eq("id", debate_session_id).eq("session_kind", "debate").execute()

        verdict = final_state.get("verdict") or {}
        await _append_issue_reasoning_log(
            tenant_id=tenant_id,
            issue_id=issue_id,
            recommendation=str(verdict.get("recommendation", "unknown")),
            confidence=float(verdict.get("confidence", 0.0) or 0.0),
        )
        await _publish_event(
            event_type="debate.completed",
            tenant_id=tenant_id,
            contract_id=contract_id,
            data={
                "debate_session_id": debate_session_id,
                "recommendation": verdict.get("recommendation"),
                "confidence": verdict.get("confidence"),
                "total_input_tokens": final_state.get("total_input_tokens", 0),
                "total_output_tokens": final_state.get("total_output_tokens", 0),
            },
        )
        return {
            "debate_session_id": debate_session_id,
            "status": "completed",
            "current_turn": 5,
            "duration_ms": duration_ms,
            "total_input_tokens": final_state.get("total_input_tokens", 0),
            "total_output_tokens": final_state.get("total_output_tokens", 0),
            "recommendation": verdict.get("recommendation"),
            "confidence": verdict.get("confidence"),
        }
    except Exception as exc:
        tenant_sb.table("debate_sessions").update({
            "status": "failed",
            "completed_at": _utcnow_iso(),
            "error_message": str(exc)[:2000],
        }).eq("id", debate_session_id).eq("session_kind", "debate").execute()
        await _publish_event(
            event_type="debate.failed",
            tenant_id=tenant_id,
            contract_id=contract_id,
            data={
                "debate_session_id": debate_session_id,
                "error": str(exc)[:500],
            },
        )
        raise
