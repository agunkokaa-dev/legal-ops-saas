"""
Token budget management helpers for LLM prompts.
"""

from __future__ import annotations

import logging
import re
from typing import Dict, Tuple

import tiktoken

logger = logging.getLogger(__name__)

_encoder_cache: dict[str, tiktoken.Encoding] = {}


MODEL_BUDGETS = {
    "gpt-4o-mini": {
        "max_context": 128_000,
        "max_output": 16_384,
        "safety_margin": 0.20,
        "usable_input": 102_400,
    },
    "gpt-4o": {
        "max_context": 128_000,
        "max_output": 16_384,
        "safety_margin": 0.20,
        "usable_input": 102_400,
    },
}


def get_encoder(model: str = "gpt-4o-mini") -> tiktoken.Encoding:
    if model not in _encoder_cache:
        try:
            _encoder_cache[model] = tiktoken.encoding_for_model(model)
        except KeyError:
            _encoder_cache[model] = tiktoken.get_encoding("cl100k_base")
    return _encoder_cache[model]


def count_tokens(text: str, model: str = "gpt-4o-mini") -> int:
    if not text:
        return 0
    return len(get_encoder(model).encode(text))


def get_budget(model: str = "gpt-4o-mini") -> dict:
    return MODEL_BUDGETS.get(model, MODEL_BUDGETS["gpt-4o-mini"])


def truncate_to_budget(
    text: str,
    max_tokens: int,
    model: str = "gpt-4o-mini",
    strategy: str = "tail_preserve",
    preserve_tail_ratio: float = 0.15,
) -> tuple[str, bool, int]:
    encoder = get_encoder(model)
    tokens = encoder.encode(text or "")
    original_count = len(tokens)

    if original_count <= max_tokens:
        return text or "", False, original_count

    if strategy == "simple":
        truncated_text = encoder.decode(tokens[:max_tokens])
    elif strategy == "tail_preserve":
        tail_tokens = max(1, int(max_tokens * preserve_tail_ratio))
        head_tokens = max(1, max_tokens - tail_tokens - 80)
        head = encoder.decode(tokens[:head_tokens])
        tail = encoder.decode(tokens[-tail_tokens:])
        marker = (
            f"\n\n[...DOCUMENT TRUNCATED: {original_count - max_tokens:,} tokens removed "
            f"from the middle to fit the {max_tokens:,} token budget. "
            f"The beginning and end of the document were preserved...]\n\n"
        )
        truncated_text = head + marker + tail
    elif strategy == "section_aware":
        parts = re.split(r"(\[Page \d+\])", text or "")
        sections = []
        current_marker = ""
        for part in parts:
            if re.fullmatch(r"\[Page \d+\]", part or ""):
                current_marker = part
            else:
                sections.append((current_marker, part))
                current_marker = ""

        if len(sections) <= 2:
            return truncate_to_budget(text or "", max_tokens, model, "tail_preserve", preserve_tail_ratio)

        first_page = sections[0][0] + sections[0][1]
        last_page = sections[-1][0] + sections[-1][1]
        first_tokens = count_tokens(first_page, model)
        last_tokens = count_tokens(last_page, model)
        remaining_budget = max_tokens - first_tokens - last_tokens - 100
        middle = ""
        skipped = 0

        for marker, content in sections[1:-1]:
            page = marker + content
            page_tokens = count_tokens(page, model)
            if remaining_budget >= page_tokens:
                middle += page
                remaining_budget -= page_tokens
            else:
                skipped += 1

        if skipped > 0:
            middle += f"\n\n[...{skipped} pages skipped to fit token budget...]\n\n"

        truncated_text = first_page + middle + last_page
    else:
        raise ValueError(f"Unknown truncation strategy: {strategy}")

    logger.warning(
        "[TOKEN BUDGET] Text truncated: %s -> %s tokens (strategy=%s)",
        f"{original_count:,}",
        f"{max_tokens:,}",
        strategy,
    )
    return truncated_text, True, original_count


def allocate_budget(
    inputs: Dict[str, str],
    priorities: Dict[str, int],
    total_budget: int,
    model: str = "gpt-4o-mini",
    system_prompt_tokens: int = 2_000,
) -> Dict[str, Tuple[str, int]]:
    available = max(1, total_budget - system_prompt_tokens)
    token_counts = {name: count_tokens(text or "", model) for name, text in inputs.items()}
    total_needed = sum(token_counts.values())

    if total_needed <= available:
        return {name: (text or "", token_counts[name]) for name, text in inputs.items()}

    total_priority = max(1, sum(max(1, priorities.get(name, 1)) for name in inputs))
    allocations: dict[str, int] = {}
    for name in inputs:
        priority = max(1, priorities.get(name, 1))
        allocations[name] = max(512, int((priority / total_priority) * available))

    # Redistribute leftover budget to large, high-priority inputs.
    allocated_total = sum(allocations.values())
    if allocated_total > available:
        scale = available / allocated_total
        allocations = {name: max(256, int(value * scale)) for name, value in allocations.items()}

    result: Dict[str, Tuple[str, int]] = {}
    for name, text in inputs.items():
        current_tokens = token_counts[name]
        max_tokens = min(current_tokens, allocations.get(name, current_tokens))
        if current_tokens <= max_tokens:
            result[name] = (text or "", current_tokens)
            continue

        strategy = "tail_preserve" if priorities.get(name, 1) >= 3 else "simple"
        truncated_text, _, _ = truncate_to_budget(text or "", max_tokens, model, strategy=strategy)
        result[name] = (truncated_text, count_tokens(truncated_text, model))

    return result


def preflight_check(
    model: str,
    system_prompt: str,
    user_content: str,
    label: str = "",
) -> dict:
    budget = get_budget(model)
    usable = budget["usable_input"]
    system_tokens = count_tokens(system_prompt or "", model)
    user_tokens = count_tokens(user_content or "", model)
    total = system_tokens + user_tokens
    fits = total <= usable
    utilization = round(total / usable, 3) if usable else 1.0

    result = {
        "fits": fits,
        "system_tokens": system_tokens,
        "user_tokens": user_tokens,
        "total_tokens": total,
        "budget": usable,
        "remaining": usable - total,
        "utilization": utilization,
        "model": model,
        "label": label,
    }

    if fits:
        logger.info(
            "[TOKEN BUDGET] %s: OK %s/%s tokens (%s%%)",
            label or model,
            f"{total:,}",
            f"{usable:,}",
            round(utilization * 100, 1),
        )
    else:
        logger.warning(
            "[TOKEN BUDGET] %s: EXCEEDED %s/%s tokens (%s%%)",
            label or model,
            f"{total:,}",
            f"{usable:,}",
            round(utilization * 100, 1),
        )

    return result
