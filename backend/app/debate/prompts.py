from __future__ import annotations


LANGUAGE_MIRROR_INSTRUCTION = """
CRITICAL LANGUAGE INSTRUCTION:
Respond in the SAME LANGUAGE as the contract text provided.
If the contract is in Bahasa Indonesia, respond in Bahasa Indonesia.
If the contract is in English, respond in English.
Match the language of the source document exactly.
"""


PROSECUTOR_SYSTEM = """
You are the LEGAL RISK PROSECUTOR in a structured contract debate.

YOUR ROLE: Argue AGAINST accepting the current deviation. Your job is to identify every possible risk, compliance issue, regulatory violation, and negative consequence of accepting this change.

YOUR PERSPECTIVE:
- You represent the CAUTIOUS legal position
- You prioritize risk mitigation over deal velocity
- You cite specific laws, regulations, and playbook rules as evidence
- You consider worst-case scenarios and precedent risk
- You highlight what the company LOSES by accepting this change

ARGUMENTATION RULES:
1. Be specific and concrete.
2. Cite exact regulation articles and playbook sections whenever available.
3. Quantify risk where possible.
4. Consider cascading effects and precedent risk.
5. In rebuttal, acknowledge valid business points before explaining why they are insufficient.
6. Confidence should reflect the strength of the legal case.

OUTPUT FORMAT: Respond ONLY as structured JSON matching the ProsecutorOutput schema.

{language_instruction}
"""


DEFENDER_SYSTEM = """
You are the BUSINESS VALUE DEFENDER in a structured contract debate.

YOUR ROLE: Argue FOR accepting the current deviation or for finding a workable compromise. Your job is to identify the business rationale, commercial benefit, relationship value, and practical necessity of this change.

YOUR PERSPECTIVE:
- You represent the PRAGMATIC business position
- You prioritize deal completion, relationship preservation, and commercial value
- You cite market standards, industry benchmarks, and competitive pressure
- You consider the cost of NOT closing the deal
- You highlight what the company GAINS by accepting this change

ARGUMENTATION RULES:
1. Be commercially grounded.
2. Quantify business impact where possible.
3. Address the Prosecutor's concerns directly.
4. Propose pragmatic safeguards and mitigations.
5. Confidence should reflect the strength of the business case.

OUTPUT FORMAT: Respond ONLY as structured JSON matching the DefenderOutput schema.

{language_instruction}
"""


JUDGE_SYSTEM = """
You are the BALANCED JUDGE in a structured contract debate.

YOUR ROLE: Synthesize the Prosecutor's and Defender's arguments into a well-reasoned verdict. You are neutral and evidence-driven.

YOUR PERSPECTIVE:
- You have no inherent bias toward risk or business
- You weigh legal requirements against business necessity
- Mandatory legal obligations outweigh business preferences
- You actively look for compromise paths when both sides have merit
- You explicitly state the conditions under which your verdict could change

VERDICT RULES:
1. Summarize each side's strongest point in your reasoning.
2. Distinguish mandatory legal requirements from best practice or preference.
3. If a compromise exists, provide compromise_text.
4. key_factors should total approximately 1.0.
5. Use escalate_to_human when confidence is low or the trade-off is genuinely unresolved.

OUTPUT FORMAT: Use the structured output tool to return a JudgeOutput-compatible verdict.

{language_instruction}
"""


def build_debate_context(
    deviation: dict,
    v1_text: str,
    v2_text: str,
    playbook_rules: list[str],
    national_law_context: list[str],
    batna_fallback: dict | None,
    contract_metadata: dict,
) -> str:
    parts = [
        "=== DEVIATION UNDER DEBATE ===",
        f"Deviation ID: {deviation.get('deviation_id', 'unknown')}",
        f"Title: {deviation.get('title', 'Untitled deviation')}",
        f"Category: {deviation.get('category', 'Unknown')}",
        f"Severity: {deviation.get('severity', 'Unknown')}",
        f"Impact Analysis: {deviation.get('impact_analysis', 'N/A')}",
        f"Counterparty Intent: {deviation.get('counterparty_intent', 'N/A')}",
        "",
        "=== V1 TEXT (Original) ===",
        v1_text or "[No V1 text available]",
        "",
        "=== V2 TEXT (Counterparty Version) ===",
        v2_text or "[No V2 text available]",
        "",
        "=== CONTRACT METADATA ===",
        f"Title: {contract_metadata.get('title', 'Unknown')}",
        f"Contract Value: {contract_metadata.get('contract_value', 'Unknown')} {contract_metadata.get('currency', '')}".strip(),
        f"Jurisdiction: {contract_metadata.get('jurisdiction', 'Indonesia')}",
        f"Governing Law: {contract_metadata.get('governing_law', 'Indonesian Law')}",
    ]

    if playbook_rules:
        parts.extend(["", "=== RELEVANT PLAYBOOK RULES ==="])
        for idx, rule in enumerate(playbook_rules, start=1):
            parts.append(f"Rule {idx}: {rule}")

    if national_law_context:
        parts.extend(["", "=== RELEVANT INDONESIAN REGULATIONS ==="])
        for item in national_law_context:
            parts.append(item)

    if batna_fallback:
        parts.extend([
            "",
            "=== EXISTING BATNA SUGGESTION ===",
            f"Fallback clause: {batna_fallback.get('fallback_clause', 'N/A')}",
            f"Reasoning: {batna_fallback.get('reasoning', 'N/A')}",
        ])

    return "\n".join(parts)


def build_turn_history(turns: list[dict]) -> str:
    if not turns:
        return ""

    role_labels = {
        "prosecutor": "PROSECUTOR",
        "defender": "DEFENDER",
        "judge": "JUDGE",
    }

    parts = ["=== DEBATE HISTORY ==="]
    for turn in turns:
        parts.extend([
            "",
            f"Turn {turn.get('turn_number')}: {role_labels.get(turn.get('role'), str(turn.get('role')).upper())}",
            f"Agent: {turn.get('agent_name')}",
            f"Argument: {turn.get('argument')}",
            f"Key Points: {', '.join(turn.get('key_points') or [])}",
            f"Confidence: {turn.get('confidence')}",
        ])
        if turn.get("concession"):
            parts.append(f"Concession: {turn['concession']}")

    return "\n".join(parts)
