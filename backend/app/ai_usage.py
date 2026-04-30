from __future__ import annotations

import asyncio
import logging
from typing import Any

from supabase import Client

logger = logging.getLogger("clause.ai_usage")


# Approximate USD per token. Keep this table centralized so pricing can be
# updated without touching every call site.
PRICING: dict[str, dict[str, float]] = {
    "gpt-4o": {"input": 0.0000025, "output": 0.000010},
    "gpt-4o-mini": {"input": 0.00000015, "output": 0.0000006},
    "text-embedding-3-small": {"input": 0.00000002, "output": 0.0},
    "claude-sonnet-4-6": {"input": 0.000003, "output": 0.000015},
    "claude-opus-4-6": {"input": 0.000015, "output": 0.000075},
    "claude-sonnet-4-5-20250929": {"input": 0.000003, "output": 0.000015},
    "claude-haiku-4-5-20251001": {"input": 0.000001, "output": 0.000005},
    "claude-3-5-sonnet-20241022": {"input": 0.000003, "output": 0.000015},
    "claude-3-5-haiku-latest": {"input": 0.0000008, "output": 0.000004},
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    rates = PRICING.get(model, {"input": 0.0, "output": 0.0})
    return round(
        max(0, input_tokens) * rates["input"]
        + max(0, output_tokens) * rates["output"],
        6,
    )


def extract_openai_usage(response: Any) -> tuple[int, int]:
    usage = getattr(response, "usage", None)
    return (
        int(getattr(usage, "prompt_tokens", 0) or 0),
        int(getattr(usage, "completion_tokens", 0) or 0),
    )


def extract_anthropic_usage(response: Any) -> tuple[int, int]:
    usage = getattr(response, "usage", None)
    return (
        int(getattr(usage, "input_tokens", 0) or 0),
        int(getattr(usage, "output_tokens", 0) or 0),
    )


def log_openai_response_sync(
    supabase: Client,
    tenant_id: str | None,
    workflow: str,
    model: str,
    response: Any,
    latency_ms: int,
    *,
    contract_id: str | None = None,
    cache_hit: bool = False,
    metadata: dict[str, Any] | None = None,
) -> None:
    input_tokens, output_tokens = extract_openai_usage(response)
    log_ai_usage_sync(
        supabase,
        tenant_id,
        workflow,
        model,
        input_tokens,
        output_tokens,
        latency_ms,
        contract_id=contract_id,
        cache_hit=cache_hit,
        metadata=metadata,
    )


def log_anthropic_response_sync(
    supabase: Client,
    tenant_id: str | None,
    workflow: str,
    model: str,
    response: Any,
    latency_ms: int,
    *,
    contract_id: str | None = None,
    cache_hit: bool = False,
    metadata: dict[str, Any] | None = None,
) -> None:
    input_tokens, output_tokens = extract_anthropic_usage(response)
    log_ai_usage_sync(
        supabase,
        tenant_id,
        workflow,
        model,
        input_tokens,
        output_tokens,
        latency_ms,
        contract_id=contract_id,
        cache_hit=cache_hit,
        metadata=metadata,
    )


def log_ai_usage_sync(
    supabase: Client,
    tenant_id: str | None,
    workflow: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    *,
    contract_id: str | None = None,
    cache_hit: bool = False,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Log an AI usage event without ever failing the caller."""
    if not tenant_id:
        return
    try:
        supabase.table("ai_usage_events").insert({
            "tenant_id": tenant_id,
            "workflow": workflow,
            "model": model,
            "input_tokens": max(0, int(input_tokens or 0)),
            "output_tokens": max(0, int(output_tokens or 0)),
            "estimated_cost_usd": estimate_cost(model, input_tokens, output_tokens),
            "latency_ms": max(0, int(latency_ms or 0)),
            "contract_id": contract_id,
            "cache_hit": cache_hit,
            "metadata": metadata or {},
        }).execute()
    except Exception as exc:
        logger.warning("Failed to log ai_usage: %s", exc)


async def log_ai_usage(
    supabase: Client,
    tenant_id: str | None,
    workflow: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    *,
    contract_id: str | None = None,
    cache_hit: bool = False,
    metadata: dict[str, Any] | None = None,
) -> None:
    await asyncio.to_thread(
        log_ai_usage_sync,
        supabase,
        tenant_id,
        workflow,
        model,
        input_tokens,
        output_tokens,
        latency_ms,
        contract_id=contract_id,
        cache_hit=cache_hit,
        metadata=metadata,
    )
