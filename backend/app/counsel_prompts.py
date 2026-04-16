"""
Prompt templates and context builders for the interactive negotiation counsel chat.
"""

from __future__ import annotations

from typing import Any


DEVIATION_COUNSEL_SYSTEM = """
You are an expert AI Negotiation Counsel embedded in a Contract Lifecycle Management platform.
You are having a conversation with a lawyer about a SPECIFIC clause deviation found between two contract versions.

Your capabilities:
- Deep analysis of contractual implications from both parties' perspectives
- Indonesian and international contract law knowledge
- BATNA strategy formulation
- Risk quantification and severity assessment
- Counter-proposal drafting
- Playbook rule compliance checking

Your conversation style:
- Direct and substantive
- Support arguments with specific references to the contract text
- If the lawyer challenges your assessment, engage seriously and update your position when their argument is stronger
- If asked to draft counter-proposals or clauses, write them in proper legal language
- When relevant, cite Indonesian regulations such as UU PDP, UU Cipta Kerja, POJK, and UU Bahasa

Critical language instruction:
Respond in the SAME LANGUAGE as the user's message.

Specific deviation context:
{deviation_context}

Broader contract context:
{contract_context}

Negotiation history:
{prior_rounds_context}

Relevant company playbook rules:
{playbook_context}

Relevant Indonesian law provisions:
{law_context}
""".strip()


GENERAL_STRATEGY_COUNSEL_SYSTEM = """
You are an expert AI Negotiation Counsel embedded in a Contract Lifecycle Management platform.
You are having a conversation with a lawyer about the OVERALL negotiation strategy for a contract.

Your capabilities:
- Holistic risk assessment across all identified deviations
- Concession strategy and trade-off analysis
- Prioritization of negotiation issues by business impact
- Multi-round negotiation pattern recognition
- Counterparty behavior analysis based on their proposed changes
- Indonesian regulatory landscape awareness

Your conversation style:
- Strategic and high-level when discussing overall approach
- Granular and specific when the lawyer drills into particular issues
- Proactive about issues the lawyer may have overlooked
- Quantify trade-offs where the available context supports it

Critical language instruction:
Respond in the SAME LANGUAGE as the user's message.

Diff summary context:
{diff_summary_context}

Contract metadata:
{contract_context}

Negotiation history:
{prior_rounds_context}

All deviations found:
{all_deviations_context}

Company playbook rules:
{playbook_context}

Relevant Indonesian law provisions:
{law_context}
""".strip()


def _text(value: Any, fallback: str = "N/A") -> str:
    if value is None:
        return fallback
    stringified = str(value).strip()
    return stringified or fallback


def _snippet(value: Any, limit: int = 500) -> str:
    text = _text(value, "")
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def build_deviation_context(deviation: dict[str, Any], batna: dict[str, Any] | None = None) -> str:
    """Build a rich context block for a single deviation."""

    sections = [
        "DEVIATION DETAILS:",
        f"- Title: {_text(deviation.get('title'), 'Untitled deviation')}",
        f"- Category: {_text(deviation.get('category'), 'Unknown')}",
        f"- Current Severity: {_text(deviation.get('severity'), 'Unknown')}",
        f"- Playbook Violation: {_text(deviation.get('playbook_violation'), 'None detected')}",
        "",
        "ORIGINAL TEXT (V1 - Our Version):",
        '"""',
        _text(deviation.get("v1_text"), "[No V1 text - this clause was added by counterparty]"),
        '"""',
        "",
        "COUNTERPARTY TEXT (V2 - Their Version):",
        '"""',
        _text(deviation.get("v2_text"), "[No V2 text - this clause was removed by counterparty]"),
        '"""',
        "",
        "AI IMPACT ANALYSIS:",
        _text(deviation.get("impact_analysis"), "No analysis available"),
        "",
        "COUNTERPARTY INTENT:",
        _text(deviation.get("counterparty_intent"), "No intent analysis available"),
    ]

    if batna:
        leverage_points = batna.get("leverage_points") or []
        sections.extend([
            "",
            "AI SUGGESTED COMPROMISE (BATNA):",
            f"Fallback clause: {_text(batna.get('fallback_clause'), 'None')}",
            f"Reasoning: {_text(batna.get('reasoning'), 'None')}",
            f"Leverage points: {', '.join(str(point) for point in leverage_points) if leverage_points else 'None'}",
        ])

    verdict = deviation.get("debate_verdict") or {}
    if verdict:
        sections.extend([
            "",
            "PRIOR AI DEBATE VERDICT:",
            f"- Original severity: {_text(verdict.get('original_severity'), 'Unknown')} -> Final: {_text(verdict.get('final_severity'), 'Unknown')}",
            f"- Consensus: {_text(verdict.get('consensus_level'), 'Unknown')}",
            f"- Reasoning: {_snippet(verdict.get('verdict_reasoning'), 500) or 'No verdict reasoning available'}",
        ])

    return "\n".join(sections)


def build_contract_context(
    contract: dict[str, Any],
    current_version: dict[str, Any],
    previous_version: dict[str, Any] | None,
    diff_result: dict[str, Any],
    *,
    v1_excerpt: str,
    v2_excerpt: str,
) -> str:
    """Build the contract-level context block."""

    deviations = diff_result.get("deviations", []) or []
    critical_count = sum(1 for item in deviations if item.get("severity") == "critical")
    warning_count = sum(1 for item in deviations if item.get("severity") == "warning")
    info_count = sum(1 for item in deviations if item.get("severity") == "info")

    lines = [
        f"CONTRACT: {_text(contract.get('title'), 'Unknown')}",
        f"- Value: {_text(contract.get('currency'), '')} {_text(contract.get('contract_value'), 'Not specified')}".strip(),
        f"- Jurisdiction: {_text(contract.get('jurisdiction'), 'Not specified')}",
        f"- Governing Law: {_text(contract.get('governing_law'), 'Not specified')}",
        f"- Status: {_text(contract.get('status'), 'Unknown')}",
        f"- Current Version ID: {_text(current_version.get('id'), 'Unknown')}",
        f"- Current Version Number: {_text(current_version.get('version_number'), 'Unknown')}",
        f"- Previous Version Number: {_text(previous_version.get('version_number') if previous_version else None, 'Not available')}",
        f"- Risk Score: {_text(current_version.get('risk_score'), 'N/A')}/100",
        f"- Risk Level: {_text(current_version.get('risk_level'), 'N/A')}",
        "",
        "DIFF SUMMARY:",
        f"- Total deviations: {len(deviations)}",
        f"- Risk delta: {_text(diff_result.get('risk_delta'), '0')} points",
        f"- Critical deviations: {critical_count}",
        f"- Warning deviations: {warning_count}",
        f"- Info deviations: {info_count}",
        f"- Executive summary: {_text(diff_result.get('summary'), 'No summary available')}",
        "",
        "FULL CONTRACT EXCERPT (V1 - previous version):",
        v1_excerpt or "[No V1 excerpt available]",
        "",
        "FULL CONTRACT EXCERPT (V2 - current version):",
        v2_excerpt or "[No V2 excerpt available]",
    ]
    return "\n".join(lines)


def build_prior_rounds_summary(rounds: list[dict[str, Any]]) -> str:
    """Format prior negotiation rounds for prompt context."""

    if not rounds:
        return "No prior negotiation rounds available."

    lines = []
    for round_row in rounds[:5]:
        snapshot = round_row.get("diff_snapshot") or {}
        summary = _text(snapshot.get("summary"), "No summary available")
        concessions = _snippet(round_row.get("concession_analysis"), 250)
        lines.append(f"Round {round_row.get('round_number', '?')}: {summary}")
        if concessions:
            lines.append(f"Concession analysis: {concessions}")
    return "\n".join(lines)


def build_all_deviations_summary(deviations: list[dict[str, Any]]) -> str:
    """Build summary of all deviations for general strategy chat."""

    if not deviations:
        return "No deviations found."

    summary_lines = ["ALL DEVIATIONS:"]
    for index, deviation in enumerate(deviations, start=1):
        summary_lines.extend([
            "",
            f"{index}. [{_text(deviation.get('severity'), '?').upper()}] {_text(deviation.get('title'), 'Untitled deviation')}",
            f"   Category: {_text(deviation.get('category'), 'Unknown')}",
            f"   V2 text: \"{_snippet(deviation.get('v2_text'), 120)}\"",
            f"   Impact: {_snippet(deviation.get('impact_analysis'), 180)}",
            f"   Playbook violation: {_text(deviation.get('playbook_violation'), 'None')}",
        ])
    return "\n".join(summary_lines)


def build_playbook_context(rules: list[Any]) -> str:
    """Format playbook hits for prompt injection."""

    if not rules:
        return "No company playbook rules configured."

    lines: list[str] = []
    for hit in rules[:10]:
        payload = dict(getattr(hit, "payload", {}) or {})
        lines.extend([
            f"- [{_text(payload.get('category'), '?')}] {_snippet(payload.get('rule_text') or payload.get('text'), 220) or 'No rule text available'}",
            f"  Standard position: {_snippet(payload.get('standard_position'), 120) or 'N/A'}",
            f"  Fallback: {_snippet(payload.get('fallback_position'), 120) or 'N/A'}",
        ])
    return "\n".join(lines)


def build_law_context(law_hits: list[Any]) -> str:
    """Format Indonesian law hits for prompt injection."""

    if not law_hits:
        return "No relevant Indonesian law provisions found."

    lines: list[str] = []
    for hit in law_hits[:10]:
        payload = dict(getattr(hit, "payload", {}) or {})
        label = f"{_text(payload.get('source_law_short'), '?')} - {_text(payload.get('pasal'), '?')}"
        lines.extend([
            f"[{label}]",
            _snippet(payload.get("text"), 320) or "No law text available.",
            "",
        ])
    return "\n".join(lines).strip()
