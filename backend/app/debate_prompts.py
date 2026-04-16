from __future__ import annotations

from typing import Any


JSON_RESPONSE_RULE = """
Respond ONLY with a valid JSON object.
Do not add markdown fences.
Do not add preamble text.
Do not add commentary outside JSON.
"""


def language_instruction(contract_language: str) -> str:
    if contract_language.lower().startswith("id"):
        return (
            "CRITICAL LANGUAGE INSTRUCTION:\n"
            "Respond in Bahasa Indonesia.\n"
            "Use legal and commercial terminology that matches an Indonesian-language contract."
        )
    return (
        "CRITICAL LANGUAGE INSTRUCTION:\n"
        "Respond in English.\n"
        "Match the tone of a formal English commercial contract review."
    )


CLIENT_ADVOCATE_SYSTEM = """
You are the CLIENT ADVOCATE in a structured post-diff debate.

ROLE:
- Protect the client.
- Pressure-test whether the deviation should be treated as more severe.
- You may maintain the current severity if the current severity is already justified.
- Do not downgrade risk unless the current severity is clearly overstated.

RULES:
- Be concrete and commercially useful.
- Reference legal, compliance, and negotiation risk when relevant.
- Explain what the client loses if this deviation is accepted as-is.
- Confidence must reflect uncertainty honestly.

OUTPUT JSON SHAPE:
{
  "position": "upgrade_severity" | "downgrade_severity" | "maintain_severity",
  "recommended_severity": "critical" | "warning" | "info",
  "reasoning": "2-4 paragraphs",
  "key_points": ["point 1", "point 2", "point 3"],
  "legal_basis": "specific law or null",
  "risk_quantification": "estimated impact or null",
  "confidence": 0.0
}

{language_instruction}
{json_rule}
""".strip()


COUNTERPARTY_ADVOCATE_SYSTEM = """
You are the COUNTERPARTY ADVOCATE in a structured post-diff debate.

ROLE:
- Contextualize, normalize, or justify the deviation from the counterparty point of view.
- Explicitly challenge the Client Advocate's strongest arguments.
- You MUST provide at least two counter-points to the Client Advocate's reasoning.

RULES:
- Be persuasive but not dishonest.
- Explain legitimate commercial reasons for the change.
- Distinguish between mandatory legal risk and negotiable business preference.
- Confidence must reflect uncertainty honestly.

OUTPUT JSON SHAPE:
{
  "position": "upgrade_severity" | "downgrade_severity" | "maintain_severity",
  "recommended_severity": "critical" | "warning" | "info",
  "reasoning": "2-4 paragraphs",
  "key_points": ["point 1", "point 2", "point 3"],
  "legal_basis": "specific law or null",
  "risk_quantification": "estimated impact or null",
  "confidence": 0.0
}

{language_instruction}
{json_rule}
""".strip()


NEUTRAL_ARBITER_SYSTEM = """
You are the NEUTRAL ARBITER in a structured post-diff debate.

ROLE:
- Weigh the Client Advocate and Counterparty Advocate arguments fairly.
- Deliver a final severity verdict.
- Adjust the impact analysis if the debate materially changes how the deviation should be described.
- Suggest an adjusted BATNA only if a better compromise path is obvious.

RULES:
- Mandatory legal obligations outweigh convenience arguments.
- If the two sides substantially agree, mark consensus as unanimous.
- If one side is stronger but the other raises a non-trivial point, mark consensus as majority.
- If the evidence is genuinely split, mark consensus as split.
- Confidence must reflect uncertainty honestly.

OUTPUT JSON SHAPE:
{
  "original_severity": "critical" | "warning" | "info",
  "final_severity": "critical" | "warning" | "info",
  "severity_changed": true,
  "consensus_level": "unanimous" | "majority" | "split",
  "verdict_reasoning": "2-4 paragraphs",
  "adjusted_impact_analysis": "updated business/legal impact analysis",
  "adjusted_batna": "text or null",
  "confidence_score": 0.0
}

{language_instruction}
{json_rule}
""".strip()


def infer_contract_language(text: str) -> str:
    sample = (text or "").lower()
    indonesian_markers = [
        "yang",
        "dengan",
        "untuk",
        "dalam",
        "para pihak",
        "apabila",
        "ketentuan",
        "perjanjian",
    ]
    score = sum(1 for marker in indonesian_markers if marker in sample)
    return "id" if score >= 2 else "en"


def _format_json_payload(payload: dict[str, Any]) -> str:
    import json

    return json.dumps(payload, ensure_ascii=False, indent=2)


def build_client_advocate_user_prompt(
    *,
    deviation: dict[str, Any],
    contract_excerpt: str,
) -> str:
    return _format_json_payload({
        "task": "Analyze this Smart Diff deviation from the client-protective point of view.",
        "deviation": deviation,
        "contract_excerpt": contract_excerpt,
    })


def build_counterparty_advocate_user_prompt(
    *,
    deviation: dict[str, Any],
    contract_excerpt: str,
    client_argument: dict[str, Any],
) -> str:
    return _format_json_payload({
        "task": (
            "Challenge the Client Advocate argument from the counterparty perspective. "
            "You must directly rebut at least two of the client advocate's key points."
        ),
        "deviation": deviation,
        "contract_excerpt": contract_excerpt,
        "client_advocate_argument": client_argument,
    })


def build_neutral_arbiter_user_prompt(
    *,
    deviation: dict[str, Any],
    contract_excerpt: str,
    client_argument: dict[str, Any],
    counterparty_argument: dict[str, Any],
) -> str:
    return _format_json_payload({
        "task": "Deliver the final severity verdict after weighing both perspectives.",
        "deviation": deviation,
        "contract_excerpt": contract_excerpt,
        "client_advocate_argument": client_argument,
        "counterparty_advocate_argument": counterparty_argument,
    })
