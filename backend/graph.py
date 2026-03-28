import os
import json
import operator
import uuid
from typing import TypedDict, Annotated, List, Dict, Any, Optional
from dotenv import load_dotenv
from openai import OpenAI
from langgraph.graph import StateGraph, START, END

# Load environment variables
load_dotenv()

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

from pydantic import BaseModel, Field

# Import the V2 coordinate-aware schemas
from app.review_schemas import (
    ComplianceAuditV2, ComplianceFinding,
    RiskAssessmentV2, RiskFlagV2,
    DraftRevisionV2, DraftingResultV2,
    ContractObligationV2, ObligationMinerResultV2,
    ClassifiedClauseV2, ClauseClassifierResultV2,
    ReviewFinding, BannerData, QuickInsight, TextCoordinate,
)


# ==========================================
# Legacy Pydantic Models (Agent 01 — Ingestion, unchanged)
# ==========================================

class ExtractedClause(BaseModel):
    clause_name: str = Field(description="The name of the clause (e.g., 'Indemnity', 'Liability', 'Payment').")
    clause_text: str = Field(description="The exact text or summary of this clause.")

class ContractMetadata(BaseModel):
    contract_value: float = Field(default=0.0, description="The monetary value of the contract. Remove formatting and output raw number.")
    currency: str = Field(default="IDR", description="3-letter currency code (e.g., IDR, USD).")
    end_date: str = Field(default="Unknown", description="The termination date or duration.")
    effective_date: Optional[str] = Field(default=None, description="The date the agreement goes into effect.")
    jurisdiction: Optional[str] = Field(default=None, description="The legal jurisdiction.")
    governing_law: Optional[str] = Field(default=None, description="The governing law.")
    extracted_clauses: list[ExtractedClause] = Field(default_factory=list, description="A list of key clauses extracted from the contract.")


# Legacy schemas kept for backward compatibility with existing serialized data
class NegotiationStrategy(BaseModel):
    counter_proposal: str = Field(description="Detailed strategy based on BATNA")


# ==========================================
# 1. State Definition (ContractState)
# ==========================================
class ContractState(TypedDict):
    """
    Shared state for the Contract Lifecycle Management (CLM) LangGraph.
    Data flows sequentially through agents and accumulates in this state.
    """
    contract_id: str
    raw_document: str             # The raw text extracted from the PDF
    extracted_clauses: Dict[str, Any] # Structured dictionary of key clauses
    contract_value: float         # Financial value or consideration found
    end_date: str                 # Termination or expiry date
    effective_date: str           # Date the agreement goes into effect
    jurisdiction: str             # Legal jurisdiction
    governing_law: str            # Governing law
    compliance_issues: Annotated[list, operator.add]  # Legacy: List of compliance strings
    risk_flags: Annotated[list, operator.add]          # Legacy: List of risk flag strings
    risk_score: float             # Calculated risk score (0-100)
    risk_level: str               # Categorical risk: 'High', 'Medium', 'Low', or 'Safe'
    counter_proposal: str         # Negotiation strategy / BATNA reasoning
    draft_revisions: Annotated[list, operator.add]     # Legacy: Revised clauses
    extracted_obligations: Annotated[list, operator.add]  # Legacy: Obligations
    classified_clauses: Annotated[list, operator.add]     # Legacy: Classified clauses
    currency: str                 # ISO 4217 Currency Code

    # ── V2 Coordinate-Aware Fields ──
    compliance_findings_v2: Annotated[list, operator.add]  # ComplianceFinding dicts
    risk_flags_v2: Annotated[list, operator.add]            # RiskFlagV2 dicts
    draft_revisions_v2: Annotated[list, operator.add]       # DraftRevisionV2 dicts
    obligations_v2: Annotated[list, operator.add]           # ContractObligationV2 dicts
    classified_clauses_v2: Annotated[list, operator.add]    # ClassifiedClauseV2 dicts
    review_findings: list           # Unified ReviewFinding dicts (set by aggregator)
    quick_insights: list            # QuickInsight dicts (set by aggregator)
    banner: dict                    # BannerData dict (set by aggregator)


# ==========================================
# Helper: Coordinate Instruction Block
# ==========================================
COORDINATE_INSTRUCTION = """
CRITICAL COORDINATE RULES:
You are given the FULL CONTRACT TEXT below. For every finding you return, you MUST provide:
- 'source_text': The EXACT verbatim quote from the contract. Copy-paste it precisely.
- 'start_char': The 0-based character index where source_text STARTS in the full contract text.
- 'end_char': The character index where source_text ENDS (exclusive) in the full contract text.

HOW TO CALCULATE start_char and end_char:
1. Find the EXACT substring in the contract text.
2. Count characters from position 0 to where that substring begins → that is start_char.
3. end_char = start_char + len(source_text).

If you cannot find the exact text, use your best approximation but the source_text MUST still be a real quote from the document.
"""


# ==========================================
# 2. Agent 01: Ingestion Agent (unchanged)
# ==========================================
def ingestion_agent(state: ContractState) -> ContractState:
    """
    AGENT 01: Parses the raw document to extract key metadata and clauses.
    Returns: contract_value, currency, end_date, and populated extracted_clauses.
    """
    print(f"[Agent 01: Ingestion] Processing contract: {state.get('contract_id', 'Unknown')}")

    prompt = f"""
    You are an expert Legal Document Parser.
    Extract the following from the provided contract text:
    1. 'contract_value': The total financial consideration or value as a number. If none, output 0.
    2. 'currency': The ISO 4217 currency code (e.g., 'IDR', 'USD', 'EUR'). If none or unclear, use 'IDR' as default.
    3. 'end_date': The termination date or duration. If none, say "Not Specified".
    4. 'effective_date': The date the agreement goes into effect.
    5. 'jurisdiction': The legal jurisdiction of the contract.
    6. 'governing_law': The governing law of the contract.
    7. 'extracted_clauses': A dictionary where keys are clause names (e.g., 'Indemnity', 'Liability') and values are the text.

    CONTRACT TEXT:
    {state.get('raw_document', '')}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            response_format=ContractMetadata,
            messages=[
                {"role": "system", "content": "You are a precise legal extraction engine."},
                {"role": "user", "content": prompt}
            ]
        )
        result = response.choices[0].message.parsed
        clauses_dict = {c.clause_name: c.clause_text for c in result.extracted_clauses} if result.extracted_clauses else {}
        print(f"[Agent 01] Extracted: value={result.contract_value}, currency={result.currency}, end_date={result.end_date}")
        return {
            "contract_value": result.contract_value,
            "currency": result.currency,
            "end_date": result.end_date,
            "effective_date": result.effective_date,
            "jurisdiction": result.jurisdiction,
            "governing_law": result.governing_law,
            "extracted_clauses": clauses_dict
        }
    except Exception as e:
        print(f"Ingestion Agent Error: {e}")
        import traceback
        traceback.print_exc()
        return {"contract_value": 0.0, "currency": "IDR", "end_date": "Error", "effective_date": None, "jurisdiction": None, "governing_law": None, "extracted_clauses": {}}


# ==========================================
# 3. Agent 02: Compliance Agent (V2 — Coordinate-Aware)
# ==========================================
def compliance_agent(state: ContractState) -> ContractState:
    """
    AGENT 02: Audits the contract for legal compliance violations.
    Returns both legacy compliance_issues AND coordinate-mapped compliance_findings_v2.
    """
    print("[Agent 02: Compliance] Auditing clauses for compliance violations...")

    raw_doc = state.get('raw_document', '')
    clauses = state.get('extracted_clauses', {})

    prompt = f"""
    You are a Senior Legal Compliance Auditor with strict corporate guidelines.
    Review the following contract and identify any risks.

    CRITICAL CORPORATE PLAYBOOK RULES:
    1. ORDER OF PRECEDENCE TRAP: If this is an SOW or Addendum and it states it is subordinate to an MSA or external agreement, FLAG THIS. It is a hidden risk.
    2. MISSING TERMS: If the document is missing a clear termination clause, liability cap, or governing law, flag it.
    3. BIASED TERMS: Flag any heavily biased or commercially unreasonable terms.

    {COORDINATE_INSTRUCTION}

    FULL CONTRACT TEXT:
    {raw_doc}

    EXTRACTED CLAUSES (for reference):
    {json.dumps(clauses)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a legal compliance engine that outputs structured findings with exact text coordinates."},
                {"role": "user", "content": prompt}
            ],
            response_format=ComplianceAuditV2
        )
        result = response.choices[0].message.parsed

        # Legacy format (backward compat)
        legacy_issues = [f.issue for f in result.findings]

        # V2 coordinate-aware format
        v2_findings = [f.model_dump() for f in result.findings]

        print(f"[Agent 02] Found {len(v2_findings)} compliance findings with coordinates.")
        return {
            "compliance_issues": legacy_issues,
            "compliance_findings_v2": v2_findings
        }
    except Exception as e:
        print(f"Compliance Agent Error: {e}")
        return {
            "compliance_issues": ["Error during compliance check."],
            "compliance_findings_v2": []
        }


# ==========================================
# 4. Agent 03: Risk Agent (V2 — Coordinate-Aware)
# ==========================================
def risk_agent(state: ContractState) -> ContractState:
    """
    AGENT 03: Evaluates compliance issues and assigns risk score + severity-coded flags.
    Returns both legacy risk_flags AND coordinate-mapped risk_flags_v2.
    """
    print("[Agent 03: Risk] Calculating overall contract risk score...")

    raw_doc = state.get('raw_document', '')
    issues = state.get('compliance_issues', [])
    findings_v2 = state.get('compliance_findings_v2', [])
    value = state.get('contract_value', 'Unknown')

    prompt = f"""
    You are a Chief Risk Officer AI.
    Evaluate the compliance issues, contract value, and the full contract text.

    CRITICAL SCORING RULES:
    - If issues contain "Order of Precedence", "MSA subordination", or missing critical clauses, 'risk_score' MUST be at least 50.0 and 'risk_level' MUST be 'Medium' or 'High'.
    - Only use 'Low' or 'Safe' if the contract is completely standalone, balanced, and has zero compliance issues.

    SEVERITY ASSIGNMENT:
    - 'critical': Issues that could cause major financial loss or legal exposure (>$100K impact)
    - 'warning': Issues that deviate from standard practice and need attention
    - 'info': Minor observations or best-practice recommendations

    1. Calculate a 'risk_score' (float 0.0 to 100.0).
    2. Determine a 'risk_level': 75-100 = 'High', 40-74 = 'Medium', 1-39 = 'Low', 0 = 'Safe'.
    3. Generate a list of 'risk_flags' with severity and exact text locations.

    {COORDINATE_INSTRUCTION}

    FULL CONTRACT TEXT:
    {raw_doc}

    CONTRACT VALUE: {value}
    COMPLIANCE ISSUES:
    {json.dumps(issues)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a risk assessment engine that outputs structured risk flags with severity levels and exact text coordinates."},
                {"role": "user", "content": prompt}
            ],
            response_format=RiskAssessmentV2
        )
        result = response.choices[0].message.parsed
        score = float(result.risk_score)
        risk_level = result.risk_level
        if not risk_level or risk_level not in ("High", "Medium", "Low", "Safe"):
            risk_level = "High" if score >= 75.0 else ("Medium" if score >= 40.0 else ("Low" if score > 0 else "Safe"))

        # Legacy format
        legacy_flags = [f.flag for f in result.risk_flags]
        # V2 format
        v2_flags = [f.model_dump() for f in result.risk_flags]

        print(f"[Agent 03] Risk Score: {score}, Level: {risk_level}, Flags: {len(v2_flags)}")
        return {
            "risk_score": score,
            "risk_level": risk_level,
            "risk_flags": legacy_flags,
            "risk_flags_v2": v2_flags
        }
    except Exception as e:
        print(f"Risk Agent Error: {e}")
        return {"risk_score": 100.0, "risk_level": "High", "risk_flags": ["Error calculating risk."], "risk_flags_v2": []}


# ==========================================
# 5. Agent 04: Negotiation Strategy Agent (unchanged)
# ==========================================
def negotiation_agent(state: ContractState) -> ContractState:
    """
    AGENT 04: Formulates a BATNA-based negotiation strategy.
    """
    print("[Agent 04: Negotiation] Formulating BATNA-based negotiation strategy...")

    issues = state.get('compliance_issues', [])
    flags = state.get('risk_flags', [])

    prompt = f"""
    You are an expert Corporate Negotiation Strategist.
    Analyze the following compliance issues and risk flags and formulate a BATNA-based strategy.
    Provide a robust, professional counter_proposal strategy.

    Return pure JSON with a single key 'counter_proposal' mapping to a detailed string.

    COMPLIANCE ISSUES:
    {json.dumps(issues)}
    RISK FLAGS:
    {json.dumps(flags)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a strategic negotiation JSON generator."},
                {"role": "user", "content": prompt}
            ],
            response_format=NegotiationStrategy
        )
        result = response.choices[0].message.parsed
        return {"counter_proposal": result.counter_proposal}
    except Exception as e:
        print(f"Negotiation Agent Error: {e}")
        return {"counter_proposal": "Error formulating negotiation strategy."}


# ==========================================
# 6. Agent 05: Contract Drafting Agent (V2 — Coordinate-Aware)
# ==========================================
def drafting_agent(state: ContractState) -> ContractState:
    """
    AGENT 05: Rewrites risky clauses with exact coordinate mapping.
    """
    print("[Agent 05: Drafting] Rewriting risky clauses to neutral/fair versions...")

    raw_doc = state.get('raw_document', '')
    strategy = state.get('counter_proposal', '')
    issues = state.get('compliance_issues', [])

    prompt = f"""
    You are a Senior Contract Drafter.
    Based on the following negotiation strategy and compliance issues, rewrite the problematic clauses into "Fair/Neutral" B2B versions.

    For each revision, you MUST:
    - Quote the EXACT original clause text from the contract (source_text)
    - Provide the character offsets where the original text is found
    - Provide your neutral rewrite

    {COORDINATE_INSTRUCTION}

    FULL CONTRACT TEXT:
    {raw_doc}

    NEGOTIATION STRATEGY: {strategy}
    COMPLIANCE ISSUES:
    {json.dumps(issues)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a legal contract drafting engine that outputs clause revisions with exact text coordinates."},
                {"role": "user", "content": prompt}
            ],
            response_format=DraftingResultV2
        )
        result = response.choices[0].message.parsed

        # Legacy format
        legacy_revisions = [{"original_issue": r.original_issue, "neutral_rewrite": r.neutral_rewrite} for r in result.draft_revisions]
        # V2 format
        v2_revisions = [r.model_dump() for r in result.draft_revisions]

        print(f"[Agent 05] Generated {len(v2_revisions)} coordinate-mapped revisions.")
        return {
            "draft_revisions": legacy_revisions,
            "draft_revisions_v2": v2_revisions
        }
    except Exception as e:
        print(f"Drafting Agent Error: {e}")
        return {"draft_revisions": [{"error": "Failed to draft revisions."}], "draft_revisions_v2": []}


# ==========================================
# 7. Agent 06: Obligation Miner (V2 — Coordinate-Aware)
# ==========================================
def obligation_miner_agent(state: ContractState) -> ContractState:
    """
    AGENT 06: Mines the raw document for contractual obligations with coordinates.
    """
    print("[Agent 06: Obligation Miner] Extracting contractual obligations...")

    raw_doc = state.get('raw_document', '')

    prompt = f"""
    You are an expert Legal Obligation Analyst.
    Analyze the following contract text and extract ALL contractual obligations,
    deliverables, duties, and commitments.

    Look for keywords: "shall", "must", "agrees to", "is required to", "will", "undertakes to", "covenants".

    For each obligation, extract:
    - 'description': A clear, concise description.
    - 'due_date': The specific deadline if mentioned, otherwise null.
    - 'source_text': The EXACT verbatim quote.
    - 'start_char' and 'end_char': Character offsets.

    {COORDINATE_INSTRUCTION}

    FULL CONTRACT TEXT:
    {raw_doc}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a precise obligation extraction engine with text coordinate output."},
                {"role": "user", "content": prompt}
            ],
            response_format=ObligationMinerResultV2
        )
        result = response.choices[0].message.parsed

        # Legacy format
        legacy_obligations = [{"description": o.description, "due_date": o.due_date} for o in result.obligations]
        # V2 format
        v2_obligations = [o.model_dump() for o in result.obligations]

        print(f"[Agent 06] Extracted {len(v2_obligations)} obligations with coordinates.")
        return {
            "extracted_obligations": legacy_obligations,
            "obligations_v2": v2_obligations
        }
    except Exception as e:
        print(f"Obligation Miner Error: {e}")
        return {"extracted_obligations": [], "obligations_v2": []}


# ==========================================
# 8. Agent 07: Clause Classifier (V2 — Coordinate-Aware)
# ==========================================
def clause_classifier_agent(state: ContractState) -> ContractState:
    """
    AGENT 07: Classifies key clauses with coordinates.
    """
    print("[Agent 07: Clause Classifier] Classifying key contract clauses...")

    raw_doc = state.get('raw_document', '')
    clauses = state.get('extracted_clauses', {})

    prompt = f"""
    You are an expert Legal Clause Classifier.
    Review the following contract and classify key clauses into standard legal categories.

    Valid categories: 'Indemnity', 'Payment', 'Termination', 'Survival',
    'Confidentiality', 'Liability', 'Force Majeure', 'Governing Law',
    'Dispute Resolution', 'Intellectual Property', 'Non-Compete', 'Other'.

    For each clause, provide:
    - 'clause_type': One of the valid categories.
    - 'original_text': The exact text excerpt.
    - 'ai_summary': A 1-2 sentence plain-English summary.
    - 'start_char' and 'end_char': Character offsets in the full contract text.

    {COORDINATE_INSTRUCTION}

    FULL CONTRACT TEXT:
    {raw_doc}

    EXTRACTED CLAUSES (for reference):
    {json.dumps(clauses)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a legal clause classification engine with text coordinate output."},
                {"role": "user", "content": prompt}
            ],
            response_format=ClauseClassifierResultV2
        )
        result = response.choices[0].message.parsed

        # Legacy
        legacy_clauses = [{"clause_type": c.clause_type, "original_text": c.original_text, "ai_summary": c.ai_summary} for c in result.clauses]
        # V2
        v2_clauses = [c.model_dump() for c in result.clauses]

        print(f"[Agent 07] Classified {len(v2_clauses)} clauses with coordinates.")
        return {
            "classified_clauses": legacy_clauses,
            "classified_clauses_v2": v2_clauses
        }
    except Exception as e:
        print(f"Clause Classifier Error: {e}")
        return {"classified_clauses": [], "classified_clauses_v2": []}


# ==========================================
# 9. Review Aggregator (NEW — Post-Processing Node)
# ==========================================
def review_aggregator(state: ContractState) -> ContractState:
    """
    POST-PROCESSING NODE: Merges all V2 agent outputs into the unified
    ReviewFinding format, computes the BannerData, and builds QuickInsights.
    This is the final node before END.
    """
    print("[Review Aggregator] Merging all agent outputs into unified review format...")

    raw_doc = state.get('raw_document', '')
    findings: list[dict] = []

    # ── 1. Merge Compliance Findings → ReviewFinding ──
    for cf in state.get('compliance_findings_v2', []):
        severity = "critical" if cf.get("category") in ("Order of Precedence", "Missing Clause") else "warning"
        findings.append(ReviewFinding(
            severity=severity,
            category=f"Compliance: {cf.get('category', 'General')}",
            title=cf.get('issue', 'Compliance Issue')[:60],
            description=cf.get('issue', ''),
            coordinates=TextCoordinate(
                start_char=cf.get('start_char', 0),
                end_char=cf.get('end_char', 0),
                source_text=cf.get('source_text', '')
            ),
            playbook_reference=cf.get('category')
        ).model_dump())

    # ── 2. Merge Risk Flags → ReviewFinding ──
    for rf in state.get('risk_flags_v2', []):
        findings.append(ReviewFinding(
            severity=rf.get('severity', 'warning'),
            category="Risk",
            title=rf.get('flag', 'Risk Flag')[:60],
            description=rf.get('flag', ''),
            coordinates=TextCoordinate(
                start_char=rf.get('start_char', 0),
                end_char=rf.get('end_char', 0),
                source_text=rf.get('source_text', '')
            )
        ).model_dump())

    # ── 3. Merge Draft Revisions → ReviewFinding (with suggested_revision) ──
    for dr in state.get('draft_revisions_v2', []):
        findings.append(ReviewFinding(
            severity="warning",
            category="Suggested Revision",
            title=dr.get('original_issue', 'Clause Revision')[:60],
            description=dr.get('original_issue', ''),
            coordinates=TextCoordinate(
                start_char=dr.get('start_char', 0),
                end_char=dr.get('end_char', 0),
                source_text=dr.get('source_text', '')
            ),
            suggested_revision=dr.get('neutral_rewrite')
        ).model_dump())

    # ── De-duplicate by overlapping coordinate ranges ──
    seen_ranges = set()
    deduped = []
    for f in findings:
        coord = f.get('coordinates', {})
        range_key = (coord.get('start_char', 0), coord.get('end_char', 0))
        if range_key not in seen_ranges:
            seen_ranges.add(range_key)
            deduped.append(f)
    findings = deduped

    # ── Sort by position in document ──
    findings.sort(key=lambda f: f.get('coordinates', {}).get('start_char', 0))

    # ── 4. Compute BannerData ──
    critical_count = sum(1 for f in findings if f.get('severity') == 'critical')
    warning_count = sum(1 for f in findings if f.get('severity') == 'warning')
    info_count = sum(1 for f in findings if f.get('severity') == 'info')

    banner = BannerData(
        critical_count=critical_count,
        warning_count=warning_count,
        info_count=info_count,
        total_count=len(findings)
    ).model_dump()

    # ── 5. Build QuickInsights from metadata ──
    quick_insights = []

    contract_value = state.get('contract_value', 0.0)
    currency = state.get('currency', 'IDR')
    if contract_value and contract_value > 0:
        if currency == 'IDR':
            formatted = f"Rp {contract_value:,.0f}"
        else:
            formatted = f"{currency} {contract_value:,.2f}"
        quick_insights.append(QuickInsight(label="Contract Value", value=formatted, icon="payments").model_dump())

    end_date = state.get('end_date', 'Not Specified')
    if end_date and end_date not in ('Unknown', 'Not Specified', 'Error'):
        quick_insights.append(QuickInsight(label="Term / End Date", value=end_date, icon="event").model_dump())

    effective_date = state.get('effective_date')
    if effective_date:
        quick_insights.append(QuickInsight(label="Effective Date", value=effective_date, icon="calendar_today").model_dump())

    jurisdiction = state.get('jurisdiction')
    if jurisdiction:
        quick_insights.append(QuickInsight(label="Jurisdiction", value=jurisdiction, icon="gavel").model_dump())

    governing_law = state.get('governing_law')
    if governing_law:
        quick_insights.append(QuickInsight(label="Governing Law", value=governing_law, icon="balance").model_dump())

    risk_level = state.get('risk_level', 'Unknown')
    risk_score = state.get('risk_score', 0.0)
    quick_insights.append(QuickInsight(
        label="Risk Assessment",
        value=f"{risk_level} ({risk_score:.0f}/100)",
        icon="shield"
    ).model_dump())

    # Obligations count
    obligations = state.get('obligations_v2', []) or state.get('extracted_obligations', [])
    if obligations:
        quick_insights.append(QuickInsight(
            label="Obligations Found",
            value=str(len(obligations)),
            icon="checklist"
        ).model_dump())

    # Check for missing critical clauses
    classified = state.get('classified_clauses_v2', []) or state.get('classified_clauses', [])
    clause_types = {c.get('clause_type', '') for c in classified}
    critical_clause_types = {'Termination', 'Liability', 'Indemnity', 'Governing Law'}
    missing = critical_clause_types - clause_types
    if missing:
        quick_insights.append(QuickInsight(
            label="Missing Clauses",
            value=", ".join(sorted(missing)),
            icon="warning"
        ).model_dump())

    print(f"[Review Aggregator] Aggregated {len(findings)} findings, {len(quick_insights)} quick insights.")
    return {
        "review_findings": findings,
        "quick_insights": quick_insights,
        "banner": banner
    }


# ==========================================
# 10. Graph Orchestration
# ==========================================
# Initialize the StateGraph with our ContractState
workflow = StateGraph(ContractState)

# Add the agent nodes to the graph
workflow.add_node("ingestion", ingestion_agent)
workflow.add_node("compliance", compliance_agent)
workflow.add_node("risk", risk_agent)
workflow.add_node("negotiation", negotiation_agent)
workflow.add_node("drafting", drafting_agent)
workflow.add_node("obligation_miner", obligation_miner_agent)
workflow.add_node("clause_classifier", clause_classifier_agent)
workflow.add_node("review_aggregator", review_aggregator)

# Define the sequential execution flow (7-Agent Pipeline + Aggregator)
workflow.add_edge(START, "ingestion")
workflow.add_edge("ingestion", "compliance")
workflow.add_edge("compliance", "risk")
workflow.add_edge("risk", "negotiation")
workflow.add_edge("negotiation", "drafting")
workflow.add_edge("drafting", "obligation_miner")
workflow.add_edge("obligation_miner", "clause_classifier")
workflow.add_edge("clause_classifier", "review_aggregator")
workflow.add_edge("review_aggregator", END)

# Compile the graph into an executable application
try:
    clm_graph = workflow.compile()
    print("LangGraph CLM 7-Agent + Review Aggregator Orchestration initialized successfully.")
except Exception as e:
    print(f"FATAL: Failed to compile LangGraph: {e}")
    clm_graph = None
