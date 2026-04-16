from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from anthropic import AsyncAnthropic

from app.config import ANTHROPIC_API_KEY
from app.debate_prompts import (
    CLIENT_ADVOCATE_SYSTEM,
    COUNTERPARTY_ADVOCATE_SYSTEM,
    JSON_RESPONSE_RULE,
    NEUTRAL_ARBITER_SYSTEM,
    build_client_advocate_user_prompt,
    build_counterparty_advocate_user_prompt,
    build_neutral_arbiter_user_prompt,
    infer_contract_language,
    language_instruction,
)
from app.event_bus import SSEEvent
from app.review_schemas import (
    DebateArgument,
    DebateModelVersions,
    DebatePerspective,
    DebateProtocolResult,
    DebateVerdict,
    DeviationDebateResult,
)


logger = logging.getLogger(__name__)

CLIENT_ADVOCATE_MODEL = "claude-sonnet-4-6"
COUNTERPARTY_ADVOCATE_MODEL = "claude-sonnet-4-6"
NEUTRAL_ARBITER_MODEL = "claude-opus-4-6"

_anthropic_client: AsyncAnthropic | None = None


def _get_anthropic_client() -> AsyncAnthropic:
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
        _anthropic_client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


def _severity_rank(severity: str) -> int:
    return {
        "critical": 3,
        "warning": 2,
        "info": 1,
    }.get((severity or "").lower(), 0)


def _extract_contract_excerpt(v2_raw_text: str, deviation: dict[str, Any], radius: int = 700) -> str:
    source_text = (deviation.get("v2_text") or deviation.get("v1_text") or "").strip()
    if source_text and v2_raw_text:
        idx = v2_raw_text.find(source_text)
        if idx != -1:
            start = max(0, idx - radius)
            end = min(len(v2_raw_text), idx + len(source_text) + radius)
            return v2_raw_text[start:end]
    return (v2_raw_text or "")[: min(len(v2_raw_text or ""), 1800)]


def _normalize_system_prompt(template: str, contract_language: str) -> str:
    return (
        template
        .replace("{language_instruction}", language_instruction(contract_language))
        .replace("{json_rule}", JSON_RESPONSE_RULE)
    )


def _extract_text_from_response(response: Any) -> str:
    content_parts: list[str] = []
    for block in getattr(response, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            content_parts.append(text)
    return "\n".join(content_parts).strip()


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    cleaned = (raw_text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace == -1 or last_brace == -1 or last_brace <= first_brace:
        raise ValueError("No JSON object found in Anthropic response.")

    candidate = cleaned[first_brace:last_brace + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        candidate = re.sub(r",\s*([}\]])", r"\1", candidate)
        return json.loads(candidate)


async def _publish_event(
    event_bus: Any,
    *,
    event_type: str,
    tenant_id: str,
    contract_id: str,
    data: dict[str, Any],
) -> None:
    if event_bus is None or not hasattr(event_bus, "publish"):
        return
    try:
        await event_bus.publish(SSEEvent(
            event_type=event_type,
            tenant_id=tenant_id,
            contract_id=contract_id,
            data=data,
        ))
    except Exception:
        logger.exception("Failed to publish debate SSE event %s", event_type)


async def _call_json_completion(
    *,
    system_prompt: str,
    user_prompt: str,
    model: str,
) -> tuple[dict[str, Any], int]:
    client = _get_anthropic_client()
    total_tokens = 0
    last_raw_text = ""
    prompts = [
        (system_prompt, user_prompt),
        (
            f"{system_prompt}\n\nCRITICAL RETRY INSTRUCTION:\n"
            "Your previous answer was invalid because it did not contain a valid JSON object. "
            "Respond with JSON only. No prose. No markdown fences. No explanation.",
            f"{user_prompt}\n\nReturn only the JSON object.",
        ),
    ]

    last_error: Exception | None = None
    for prompt_system, prompt_user in prompts:
        response = await client.messages.create(
            model=model,
            max_tokens=2500,
            temperature=0.2,
            system=prompt_system,
            messages=[{"role": "user", "content": prompt_user}],
        )
        usage = getattr(response, "usage", None)
        total_tokens += int(getattr(usage, "input_tokens", 0) or 0) + int(getattr(usage, "output_tokens", 0) or 0)

        raw_text = _extract_text_from_response(response)
        last_raw_text = raw_text
        try:
            return _extract_json_object(raw_text), total_tokens
        except Exception as exc:
            last_error = exc
            logger.warning("Anthropic JSON parse failed for model %s: %s; raw preview=%r", model, exc, raw_text[:300])

    if last_raw_text:
        repair_response = await client.messages.create(
            model=model,
            max_tokens=1800,
            temperature=0.0,
            system=(
                "You repair malformed or truncated JSON outputs.\n"
                "Return ONLY one valid JSON object.\n"
                "Do not add markdown fences.\n"
                "Do not add commentary.\n"
                "If a field is incomplete, complete it conservatively from context and use null for missing optional values."
            ),
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Convert the malformed or truncated response below into a valid JSON object "
                        "that satisfies the original task.\n\n"
                        f"Original system instructions:\n{system_prompt}\n\n"
                        f"Original user task:\n{user_prompt}\n\n"
                        f"Malformed response:\n{last_raw_text}"
                    ),
                }
            ],
        )
        usage = getattr(repair_response, "usage", None)
        total_tokens += int(getattr(usage, "input_tokens", 0) or 0) + int(getattr(usage, "output_tokens", 0) or 0)
        repaired_text = _extract_text_from_response(repair_response)
        try:
            return _extract_json_object(repaired_text), total_tokens
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Anthropic JSON repair failed for model %s: %s; raw preview=%r",
                model,
                exc,
                repaired_text[:300],
            )

    if last_error is not None:
        raise last_error
    raise RuntimeError("Anthropic JSON completion failed without a captured error.")


async def _debate_single_deviation(
    *,
    semaphore: asyncio.Semaphore,
    deviation_index: int,
    total_to_debate: int,
    deviation: dict[str, Any],
    v2_raw_text: str,
    contract_language: str,
    tenant_id: str,
    contract_id: str,
    event_bus: Any,
) -> DeviationDebateResult:
    deviation_id = str(deviation.get("deviation_id") or f"deb_{deviation_index}")
    started_at = time.perf_counter()
    total_tokens = 0
    contract_excerpt = _extract_contract_excerpt(v2_raw_text, deviation)

    async with semaphore:
        try:
            await _publish_event(
                event_bus,
                event_type="debate.perspective_started",
                tenant_id=tenant_id,
                contract_id=contract_id,
                data={
                    "deviation_index": deviation_index,
                    "total": total_to_debate,
                    "perspective": DebatePerspective.CLIENT_ADVOCATE.value,
                    "deviation_id": deviation_id,
                },
            )
            client_payload, client_tokens = await _call_json_completion(
                system_prompt=_normalize_system_prompt(CLIENT_ADVOCATE_SYSTEM, contract_language),
                user_prompt=build_client_advocate_user_prompt(
                    deviation=deviation,
                    contract_excerpt=contract_excerpt,
                ),
                model=CLIENT_ADVOCATE_MODEL,
            )
            total_tokens += client_tokens
            client_argument = DebateArgument(
                perspective=DebatePerspective.CLIENT_ADVOCATE,
                **client_payload,
            )
            await _publish_event(
                event_bus,
                event_type="debate.perspective_completed",
                tenant_id=tenant_id,
                contract_id=contract_id,
                data={
                    "deviation_index": deviation_index,
                    "perspective": DebatePerspective.CLIENT_ADVOCATE.value,
                    "deviation_id": deviation_id,
                    "recommended_severity": client_argument.recommended_severity,
                },
            )

            await _publish_event(
                event_bus,
                event_type="debate.perspective_started",
                tenant_id=tenant_id,
                contract_id=contract_id,
                data={
                    "deviation_index": deviation_index,
                    "total": total_to_debate,
                    "perspective": DebatePerspective.COUNTERPARTY_ADVOCATE.value,
                    "deviation_id": deviation_id,
                },
            )
            counterparty_payload, counterparty_tokens = await _call_json_completion(
                system_prompt=_normalize_system_prompt(COUNTERPARTY_ADVOCATE_SYSTEM, contract_language),
                user_prompt=build_counterparty_advocate_user_prompt(
                    deviation=deviation,
                    contract_excerpt=contract_excerpt,
                    client_argument=client_argument.model_dump(),
                ),
                model=COUNTERPARTY_ADVOCATE_MODEL,
            )
            total_tokens += counterparty_tokens
            counterparty_argument = DebateArgument(
                perspective=DebatePerspective.COUNTERPARTY_ADVOCATE,
                **counterparty_payload,
            )
            await _publish_event(
                event_bus,
                event_type="debate.perspective_completed",
                tenant_id=tenant_id,
                contract_id=contract_id,
                data={
                    "deviation_index": deviation_index,
                    "perspective": DebatePerspective.COUNTERPARTY_ADVOCATE.value,
                    "deviation_id": deviation_id,
                    "recommended_severity": counterparty_argument.recommended_severity,
                },
            )

            await _publish_event(
                event_bus,
                event_type="debate.perspective_started",
                tenant_id=tenant_id,
                contract_id=contract_id,
                data={
                    "deviation_index": deviation_index,
                    "total": total_to_debate,
                    "perspective": DebatePerspective.NEUTRAL_ARBITER.value,
                    "deviation_id": deviation_id,
                },
            )
            arbiter_payload, arbiter_tokens = await _call_json_completion(
                system_prompt=_normalize_system_prompt(NEUTRAL_ARBITER_SYSTEM, contract_language),
                user_prompt=build_neutral_arbiter_user_prompt(
                    deviation=deviation,
                    contract_excerpt=contract_excerpt,
                    client_argument=client_argument.model_dump(),
                    counterparty_argument=counterparty_argument.model_dump(),
                ),
                model=NEUTRAL_ARBITER_MODEL,
            )
            total_tokens += arbiter_tokens
            verdict_payload = dict(arbiter_payload)
            original_severity = str(deviation.get("severity", verdict_payload.get("original_severity", "warning")))
            verdict_payload["original_severity"] = original_severity
            verdict_payload["final_severity"] = str(
                verdict_payload.get("final_severity", original_severity)
            )
            verdict_payload["severity_changed"] = (
                verdict_payload["final_severity"] != original_severity
            )
            verdict = DebateVerdict(**verdict_payload)
            neutral_argument = DebateArgument(
                perspective=DebatePerspective.NEUTRAL_ARBITER,
                position="maintain_severity" if not verdict.severity_changed else (
                    "upgrade_severity" if _severity_rank(verdict.final_severity) > _severity_rank(verdict.original_severity)
                    else "downgrade_severity"
                ),
                recommended_severity=verdict.final_severity,
                reasoning=verdict.verdict_reasoning,
                key_points=[
                    verdict.adjusted_impact_analysis,
                    f"Consensus: {verdict.consensus_level}",
                    f"Confidence: {round(verdict.confidence_score * 100)}%",
                ],
                legal_basis=None,
                risk_quantification=None,
                confidence=verdict.confidence_score,
            )
            await _publish_event(
                event_bus,
                event_type="debate.perspective_completed",
                tenant_id=tenant_id,
                contract_id=contract_id,
                data={
                    "deviation_index": deviation_index,
                    "perspective": DebatePerspective.NEUTRAL_ARBITER.value,
                    "deviation_id": deviation_id,
                    "recommended_severity": neutral_argument.recommended_severity,
                },
            )

            return DeviationDebateResult(
                deviation_id=deviation_id,
                debate_triggered=True,
                arguments=[client_argument, counterparty_argument, neutral_argument],
                verdict=verdict,
                debate_duration_ms=int((time.perf_counter() - started_at) * 1000),
                tokens_used=total_tokens,
            )
        except Exception as exc:
            logger.exception("Debate failed for deviation %s: %s", deviation_id, exc)
            return DeviationDebateResult(
                deviation_id=deviation_id,
                debate_triggered=True,
                arguments=[],
                verdict=None,
                debate_duration_ms=int((time.perf_counter() - started_at) * 1000),
                tokens_used=total_tokens,
            )


async def run_debate_protocol(
    diff_result: dict,
    v2_raw_text: str,
    tenant_id: str,
    contract_id: str,
    event_bus: Any = None,
    max_concurrent_deviations: int = 3,
    max_deviations_to_debate: int = 10,
) -> DebateProtocolResult:
    deviations = list(diff_result.get("deviations") or [])
    contract_language = infer_contract_language(v2_raw_text)

    eligible = [
        (index, deviation)
        for index, deviation in enumerate(deviations)
        if deviation.get("severity") in {"critical", "warning"}
    ]
    eligible.sort(
        key=lambda item: (-_severity_rank(item[1].get("severity", "info")), item[0])
    )

    debate_targets = eligible[:max_deviations_to_debate]
    debate_target_ids = {str(deviation.get("deviation_id")) for _, deviation in debate_targets}
    skipped_count = len(deviations) - len(debate_targets)

    await _publish_event(
        event_bus,
        event_type="debate.started",
        tenant_id=tenant_id,
        contract_id=contract_id,
        data={
            "total_deviations": len(deviations),
            "to_debate": len(debate_targets),
            "to_skip": skipped_count,
        },
    )

    results_by_id: dict[str, DeviationDebateResult] = {}
    for deviation in deviations:
        deviation_id = str(deviation.get("deviation_id"))
        if deviation_id not in debate_target_ids:
            results_by_id[deviation_id] = DeviationDebateResult(
                deviation_id=deviation_id,
                debate_triggered=False,
                arguments=[],
                verdict=None,
                debate_duration_ms=0,
                tokens_used=0,
            )

    semaphore = asyncio.Semaphore(max_concurrent_deviations)
    tasks = [
        _debate_single_deviation(
            semaphore=semaphore,
            deviation_index=debate_order,
            total_to_debate=len(debate_targets),
            deviation=deviation,
            v2_raw_text=v2_raw_text,
            contract_language=contract_language,
            tenant_id=tenant_id,
            contract_id=contract_id,
            event_bus=event_bus,
        )
        for debate_order, (_index, deviation) in enumerate(debate_targets, start=1)
    ]

    debated_results = await asyncio.gather(*tasks) if tasks else []
    for result in debated_results:
        results_by_id[result.deviation_id] = result

    ordered_results = [
        results_by_id.get(
            str(deviation.get("deviation_id")),
            DeviationDebateResult(
                deviation_id=str(deviation.get("deviation_id")),
                debate_triggered=False,
                arguments=[],
                verdict=None,
                debate_duration_ms=0,
                tokens_used=0,
            ),
        )
        for deviation in deviations
    ]

    severity_changes = sum(
        1
        for result in debated_results
        if result.verdict and result.verdict.severity_changed
    )
    total_duration_ms = sum(result.debate_duration_ms for result in debated_results)
    total_tokens_used = sum(result.tokens_used for result in debated_results)

    protocol_result = DebateProtocolResult(
        debate_results=ordered_results,
        total_deviations=len(deviations),
        debated_count=len(debated_results),
        skipped_count=skipped_count,
        severity_changes=severity_changes,
        total_duration_ms=total_duration_ms,
        total_tokens_used=total_tokens_used,
        model_versions=DebateModelVersions(
            client_advocate=CLIENT_ADVOCATE_MODEL,
            counterparty_advocate=COUNTERPARTY_ADVOCATE_MODEL,
            neutral_arbiter=NEUTRAL_ARBITER_MODEL,
        ),
    )

    await _publish_event(
        event_bus,
        event_type="debate.completed",
        tenant_id=tenant_id,
        contract_id=contract_id,
        data={
            "debated_count": protocol_result.debated_count,
            "severity_changes": protocol_result.severity_changes,
            "total_tokens": protocol_result.total_tokens_used,
            "duration_ms": protocol_result.total_duration_ms,
        },
    )
    return protocol_result
