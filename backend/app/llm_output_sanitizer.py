"""
LLM output sanitization helpers.

These functions sanitize text produced by LLM-backed agents before it is
persisted. The intent is defense in depth: strip HTML and executable payloads
from agent-authored analysis while preserving ordinary Markdown formatting.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

_SCRIPT_PATTERNS = [
    re.compile(r"<script[\s\S]*?>", re.IGNORECASE),
    re.compile(r"</script>", re.IGNORECASE),
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"data\s*:\s*text/html", re.IGNORECASE),
    re.compile(r"vbscript\s*:", re.IGNORECASE),
    re.compile(r"on\w+\s*=\s*['\"]", re.IGNORECASE),
    re.compile(r"expression\s*\(", re.IGNORECASE),
]

_REMOVE_BLOCK_PATTERNS = [
    re.compile(r"<script[\s\S]*?</script\s*>", re.IGNORECASE),
    re.compile(r"<style[\s\S]*?</style\s*>", re.IGNORECASE),
    re.compile(r"<iframe[\s\S]*?</iframe\s*>", re.IGNORECASE),
    re.compile(r"<object[\s\S]*?</object\s*>", re.IGNORECASE),
    re.compile(r"<embed[\s\S]*?</embed\s*>", re.IGNORECASE),
]

_REMOVE_INLINE_PATTERNS = [
    re.compile(r"javascript\s*:\s*[^\s)\"'>]+(?:\([^)]*\))?", re.IGNORECASE),
    re.compile(r"data\s*:\s*text/html[^\s\"'>]*", re.IGNORECASE),
    re.compile(r"vbscript\s*:\s*[^\s\"'>]+", re.IGNORECASE),
    re.compile(r"on\w+\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE),
]

_HTML_TAG_PATTERN = re.compile(r"<[^>]+>", re.DOTALL)

_INJECTION_INDICATORS = [
    "ignore previous instructions",
    "ignore all previous",
    "disregard previous",
    "you are now",
    "###instruction###",
    "[system]",
    "<|system|>",
]

_FIELD_MAX_LENGTHS = {
    "impact_analysis": 2000,
    "counterparty_intent": 1500,
    "description": 2000,
    "suggested_revision": 2000,
    "fallback_clause": 3000,
    "reasoning": 1500,
    "leverage_points_item": 500,
    "summary": 1000,
    "ai_summary": 1000,
    "counsel_response": 8000,
    "counter_proposal": 5000,
    "default": 5000,
}


class LLMOutputViolationError(ValueError):
    """Raised when strict sanitization encounters dangerous content."""


def sanitize_llm_text(
    text: str | None,
    field_name: str = "default",
    strict: bool = False,
) -> str:
    """
    Sanitize a single LLM-generated string.

    Markdown is preserved. HTML and executable payload fragments are removed.
    """

    if not text or not isinstance(text, str):
        return text or ""

    for pattern in _SCRIPT_PATTERNS:
        if pattern.search(text):
            logger.error(
                "LLM sanitizer detected dangerous pattern",
                extra={
                    "field": field_name,
                    "pattern": pattern.pattern[:80],
                    "text_preview": text[:120],
                },
            )
            if strict:
                raise LLMOutputViolationError(
                    f"LLM output field '{field_name}' contains dangerous content"
                )

    sanitized = text
    for pattern in _REMOVE_BLOCK_PATTERNS:
        sanitized = pattern.sub("", sanitized)

    sanitized = _HTML_TAG_PATTERN.sub("", sanitized)

    for pattern in _REMOVE_INLINE_PATTERNS:
        sanitized = pattern.sub("", sanitized)

    lower = sanitized.lower()
    for indicator in _INJECTION_INDICATORS:
        if indicator in lower:
            logger.warning(
                "LLM sanitizer detected injection indicator",
                extra={
                    "field": field_name,
                    "indicator": indicator,
                    "text_preview": sanitized[:150],
                },
            )
            if strict:
                raise LLMOutputViolationError(
                    f"LLM output field '{field_name}' contains injection indicator"
                )
            break

    max_length = _FIELD_MAX_LENGTHS.get(field_name, _FIELD_MAX_LENGTHS["default"])
    if len(sanitized) > max_length:
        logger.info(
            "LLM sanitizer truncated oversized field",
            extra={
                "field": field_name,
                "original_length": len(sanitized),
                "max_length": max_length,
            },
        )
        sanitized = sanitized[:max_length].rstrip()

    sanitized = re.sub(r"\n{3,}", "\n\n", sanitized).strip()
    return sanitized


def sanitize_llm_list(
    items: list[Any] | None,
    field_name: str = "leverage_points_item",
    strict: bool = False,
) -> list[str]:
    """Sanitize a list of LLM-generated strings."""

    if not items or not isinstance(items, list):
        return items or []

    return [
        sanitize_llm_text(str(item), field_name=field_name, strict=strict)
        for item in items
        if item
    ]


def sanitize_deviation(deviation: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Return a sanitized copy of a diff deviation payload."""

    sanitized = dict(deviation)

    for field, field_name in (
        ("impact_analysis", "impact_analysis"),
        ("counterparty_intent", "counterparty_intent"),
        ("playbook_violation", "default"),
    ):
        if sanitized.get(field):
            sanitized[field] = sanitize_llm_text(
                sanitized[field],
                field_name=field_name,
                strict=strict,
            )

    debate_verdict = sanitized.get("debate_verdict")
    if isinstance(debate_verdict, dict):
        sanitized["debate_verdict"] = sanitize_debate_verdict(debate_verdict, strict=strict)

    return sanitized


def sanitize_batna(batna: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Return a sanitized copy of a BATNA fallback payload."""

    sanitized = dict(batna)

    for field, field_name in (
        ("fallback_clause", "fallback_clause"),
        ("reasoning", "reasoning"),
    ):
        if sanitized.get(field):
            sanitized[field] = sanitize_llm_text(
                sanitized[field],
                field_name=field_name,
                strict=strict,
            )

    if sanitized.get("leverage_points"):
        sanitized["leverage_points"] = sanitize_llm_list(
            sanitized["leverage_points"],
            field_name="leverage_points_item",
            strict=strict,
        )

    return sanitized


def sanitize_debate_argument(argument: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Return a sanitized copy of a debate argument payload."""

    sanitized = dict(argument)

    for field in ("reasoning", "legal_basis", "risk_quantification"):
        if sanitized.get(field):
            sanitized[field] = sanitize_llm_text(
                sanitized[field],
                field_name="reasoning",
                strict=strict,
            )

    if sanitized.get("key_points"):
        sanitized["key_points"] = sanitize_llm_list(
            sanitized["key_points"],
            field_name="leverage_points_item",
            strict=strict,
        )

    return sanitized


def sanitize_debate_verdict(verdict: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Return a sanitized copy of a debate verdict payload."""

    sanitized = dict(verdict)

    for field, field_name in (
        ("verdict_reasoning", "reasoning"),
        ("adjusted_impact_analysis", "impact_analysis"),
        ("adjusted_batna", "fallback_clause"),
    ):
        if sanitized.get(field):
            sanitized[field] = sanitize_llm_text(
                sanitized[field],
                field_name=field_name,
                strict=strict,
            )

    return sanitized


def sanitize_debate_result(result: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Return a sanitized copy of a debate result payload."""

    sanitized = dict(result)

    if sanitized.get("arguments"):
        sanitized["arguments"] = [
            sanitize_debate_argument(argument, strict=strict)
            for argument in sanitized["arguments"]
            if isinstance(argument, dict)
        ]

    verdict = sanitized.get("verdict")
    if isinstance(verdict, dict):
        sanitized["verdict"] = sanitize_debate_verdict(verdict, strict=strict)

    return sanitized


def sanitize_diff_result(diff_result: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Return a sanitized copy of a SmartDiffResult-shaped payload."""

    sanitized = dict(diff_result)

    if sanitized.get("summary"):
        sanitized["summary"] = sanitize_llm_text(
            sanitized["summary"],
            field_name="summary",
            strict=strict,
        )

    if sanitized.get("deviations"):
        sanitized["deviations"] = [
            sanitize_deviation(deviation, strict=strict)
            for deviation in sanitized["deviations"]
            if isinstance(deviation, dict)
        ]

    if sanitized.get("batna_fallbacks"):
        sanitized["batna_fallbacks"] = [
            sanitize_batna(batna, strict=strict)
            for batna in sanitized["batna_fallbacks"]
            if isinstance(batna, dict)
        ]

    debate_protocol = sanitized.get("debate_protocol")
    if isinstance(debate_protocol, dict):
        sanitized_protocol = dict(debate_protocol)
        if sanitized_protocol.get("debate_results"):
            sanitized_protocol["debate_results"] = [
                sanitize_debate_result(result, strict=strict)
                for result in sanitized_protocol["debate_results"]
                if isinstance(result, dict)
            ]
        sanitized["debate_protocol"] = sanitized_protocol

    return sanitized


def sanitize_review_finding(finding: dict[str, Any], strict: bool = False) -> dict[str, Any]:
    """Return a sanitized copy of a ReviewFinding-like payload."""

    sanitized = dict(finding)

    for field, field_name in (
        ("description", "description"),
        ("suggested_revision", "suggested_revision"),
        ("ai_summary", "ai_summary"),
    ):
        if sanitized.get(field):
            sanitized[field] = sanitize_llm_text(
                sanitized[field],
                field_name=field_name,
                strict=strict,
            )

    return sanitized
