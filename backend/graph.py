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

# Qdrant client for national law RAG retrieval
from qdrant_client import QdrantClient
from qdrant_client.http.models import Filter, FieldCondition, MatchValue
_qdrant_url = os.getenv("QDRANT_URL", "http://qdrant:6333")
_qdrant = QdrantClient(url=_qdrant_url)
NATIONAL_LAWS_COLLECTION = "id_national_laws"

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
    _task_logger: Any               # Optional TaskLogger instance (injected by contracts.py)


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
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('ingestion')

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
        if _logger: _logger.log_agent_complete('ingestion', {'currency': result.currency, 'clauses_found': len(clauses_dict)})
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
        if _logger: _logger.log_agent_failed('ingestion', e)
        return {"contract_value": 0.0, "currency": "IDR", "end_date": "Error", "effective_date": None, "jurisdiction": None, "governing_law": None, "extracted_clauses": {}}


# ==========================================
# 3. Agent 02: Compliance Agent (V2 — Coordinate-Aware)
# ==========================================
def compliance_agent(state: ContractState) -> ContractState:
    """
    AGENT 02: Audits the contract for legal compliance violations.
    Now enhanced with Indonesian national law RAG retrieval.
    Returns both legacy compliance_issues AND coordinate-mapped compliance_findings_v2.
    """
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('compliance')
    print("[Agent 02: Compliance] Auditing clauses for compliance violations...")

    raw_doc = state.get('raw_document', '')
    clauses = state.get('extracted_clauses', {})

    # ── National Law RAG Retrieval ──
    law_context = ""
    try:
        # Check if collection exists before querying
        existing_cols = [c.name for c in _qdrant.get_collections().collections]
        if NATIONAL_LAWS_COLLECTION in existing_cols:
            # Embed a summary of the contract for semantic search
            contract_summary = raw_doc[:3000]
            embed_resp = client.embeddings.create(
                input=contract_summary, model="text-embedding-3-small"
            )
            query_vector = embed_resp.data[0].embedding

            # Search national laws — NO tenant filter (global corpus)
            hits = _qdrant.query_points(
                collection_name=NATIONAL_LAWS_COLLECTION,
                query=query_vector,
                query_filter=Filter(
                    must=[FieldCondition(key="is_active", match=MatchValue(value=True))]
                ),
                limit=15,
                with_payload=True,
            )

            if hits.points:
                law_context = "\n\nRELEVANT INDONESIAN LAW PROVISIONS (from id_national_laws corpus):\n"
                for hit in hits.points:
                    p = hit.payload
                    law_context += (
                        f"--- [{p.get('source_law_short', '')} Pasal {p.get('pasal', '')}] ---\n"
                        f"{p.get('text', '')}\n\n"
                    )
                print(f"[Agent 02] Retrieved {len(hits.points)} national law provisions for context.")
        else:
            print(f"[Agent 02] Collection '{NATIONAL_LAWS_COLLECTION}' not found — skipping law RAG.")
    except Exception as e:
        print(f"[Agent 02] National law retrieval failed (non-fatal): {e}")

    prompt = f"""
    You are a Senior Legal Compliance Auditor with deep expertise in Indonesian law.
    Review the following contract and identify any risks.

    CRITICAL CORPORATE PLAYBOOK RULES:
    1. ORDER OF PRECEDENCE TRAP: If this is an SOW or Addendum and it states it is subordinate to an MSA or external agreement, FLAG THIS. It is a hidden risk.
    2. MISSING TERMS: If the document is missing a clear termination clause, liability cap, or governing law, flag it.
    3. BIASED TERMS: Flag any heavily biased or commercially unreasonable terms.

    INDONESIAN LAW COMPLIANCE (CRITICAL):
    4. LANGUAGE REQUIREMENT: Detect the language of the contract. If the contract is ALREADY in Bahasa Indonesia, DO NOT flag it for UU 24/2009. ONLY flag this as a violation if the contract involves an Indonesian party AND is written EXCLUSIVELY in a foreign language (e.g., English) without an Indonesian version.
    5. DATA PROTECTION: If the contract involves personal data processing, check compliance with UU 27/2022 (PDP Law) — consent, breach notification (3x24h), cross-border transfer, DPO requirements.
    6. EMPLOYMENT: If the contract is a PKWT (fixed-term), verify it complies with UU 6/2023 — max 5 year duration, non-permanent work only, compensation obligation.

    STATUTORY VIOLATION CATEGORY:
    When you find a violation of a SPECIFIC Indonesian law provision, you MUST:
    - Set category to "Statutory Violation"
    - ALWAYS cite the exact pasal number in your issue description (e.g., "Pasal 31 UU 24/2009")
    - Quote the relevant statutory text in your issue description

    {COORDINATE_INSTRUCTION}
    {law_context}

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the source text. 
    Your output MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your outputs (summaries, findings, clauses) MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English if the contract is Indonesian.

    FULL CONTRACT TEXT:
    {raw_doc}

    EXTRACTED CLAUSES (for reference):
    {json.dumps(clauses)}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a legal compliance engine that outputs structured findings with exact text coordinates. You have deep knowledge of Indonesian law and MUST cite specific pasal numbers when identifying statutory violations."},
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
        statutory_count = sum(1 for f in result.findings if f.category == "Statutory Violation")
        if statutory_count:
            print(f"[Agent 02] Including {statutory_count} Statutory Violation(s) citing Indonesian law.")
        if _logger: _logger.log_agent_complete('compliance', {'v2_findings': len(v2_findings), 'statutory_violations': statutory_count})
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
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('risk')
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

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the source text. 
    Your output MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your outputs (summaries, findings, clauses) MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English if the contract is Indonesian.

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
        if _logger: _logger.log_agent_complete('risk', {'score': score, 'level': risk_level})
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
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('negotiation')
    print("[Agent 04: Negotiation] Formulating BATNA-based negotiation strategy...")

    issues = state.get('compliance_issues', [])
    flags = state.get('risk_flags', [])
    raw_doc_sample = state.get('raw_document', '')[:5000]

    prompt = f"""
    You are an expert Corporate Negotiation Strategist.
    Analyze the following compliance issues and risk flags and formulate a BATNA-based strategy.
    Provide a robust, professional counter_proposal strategy.

    Return pure JSON with a single key 'counter_proposal' mapping to a detailed string.

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the 'FULL CONTRACT TEXT'. 
    Your output (strategy, reasoning, and specifically the drafted rewrite/redline) MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your suggested clauses and explanations MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English redlines for an Indonesian contract.

    FULL CONTRACT TEXT (Sample):
    {raw_doc_sample}

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
        if _logger: _logger.log_agent_complete('negotiation')
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
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('drafting')
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

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the 'FULL CONTRACT TEXT'. 
    Your output (strategy, reasoning, and specifically the drafted rewrite/redline) MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your suggested clauses and explanations MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English redlines for an Indonesian contract.

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
        if _logger: _logger.log_agent_complete('drafting', {'revisions': len(v2_revisions)})
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
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('obligation_miner')
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

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the source text. 
    Your output MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your outputs (summaries, findings, clauses) MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English if the contract is Indonesian.

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
        if _logger: _logger.log_agent_complete('obligation_miner', {'obligations': len(v2_obligations)})
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
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('clause_classifier')
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

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the source text. 
    Your output MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your outputs (summaries, findings, clauses) MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English if the contract is Indonesian.

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
        if _logger: _logger.log_agent_complete('clause_classifier', {'clauses': len(v2_clauses)})
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
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('review_aggregator')
    print("[Review Aggregator] Merging all agent outputs into unified review format...")

    raw_doc = state.get('raw_document', '')
    findings: list[dict] = []

    # ── 1. Merge Compliance Findings → ReviewFinding ──
    for cf in state.get('compliance_findings_v2', []):
        severity = "critical" if cf.get("category") in ("Order of Precedence", "Missing Clause", "Statutory Violation") else "warning"
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
    if _logger: _logger.log_agent_complete('review_aggregator', {'findings': len(findings), 'quick_insights': len(quick_insights)})
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

# ==========================================
# Phase 2: On-Demand Smart Diff Agent
# ==========================================
from app.review_schemas import SmartDiffResult, TextCoordinate
import re
from difflib import SequenceMatcher


def strip_markdown(text: str) -> str:
    """
    Strips common markdown formatting characters from text to enable
    fuzzy matching when the LLM injects markdown into its output.
    """
    # Remove bold/italic markers
    text = re.sub(r'\*{1,3}', '', text)
    # Remove heading markers
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    # Remove list markers at line start (-, +, *)
    text = re.sub(r'^\s*[-+*]\s+', '', text, flags=re.MULTILINE)
    # Remove blockquote markers
    text = re.sub(r'^>\s*', '', text, flags=re.MULTILINE)
    # Remove inline code backticks
    text = re.sub(r'`+', '', text)
    # Remove strikethrough tildes
    text = re.sub(r'~~', '', text)
    # Remove underscores used for emphasis (but keep word-internal ones)
    text = re.sub(r'(?<![\w])_|_(?![\w])', '', text)
    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def fuzzy_find_substring(haystack: str, needle: str, threshold: float = 0.75) -> tuple:
    """
    Finds the best approximate match of `needle` within `haystack`
    using SequenceMatcher. Returns (start, end) character indices
    if the best match exceeds `threshold`, else (-1, -1).
    """
    if not needle or not haystack:
        return (-1, -1)

    needle_len = len(needle)
    best_ratio = 0.0
    best_start = -1

    # Sliding window with some flexibility on the window size
    # Check windows from 80% to 120% of needle length
    min_window = max(1, int(needle_len * 0.8))
    max_window = min(len(haystack), int(needle_len * 1.3))

    # Step through the haystack in chunks for efficiency
    step = max(1, needle_len // 10)

    for window_size in range(min_window, max_window + 1, max(1, (max_window - min_window) // 5)):
        for i in range(0, len(haystack) - window_size + 1, step):
            candidate = haystack[i:i + window_size]
            ratio = SequenceMatcher(None, needle, candidate).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_start = i
                best_window = window_size

    if best_ratio >= threshold and best_start >= 0:
        # Refine: re-scan character-by-character around the best match
        refine_start = max(0, best_start - step)
        refine_end = min(len(haystack), best_start + best_window + step)
        final_best_ratio = best_ratio
        final_start = best_start
        final_end = best_start + best_window

        for i in range(refine_start, min(refine_end, len(haystack) - min_window + 1)):
            for ws in range(min_window, min(max_window + 1, len(haystack) - i + 1)):
                candidate = haystack[i:i + ws]
                ratio = SequenceMatcher(None, needle, candidate).ratio()
                if ratio > final_best_ratio:
                    final_best_ratio = ratio
                    final_start = i
                    final_end = i + ws

        return (final_start, final_end)

    return (-1, -1)

def run_smart_diff_agent(v1_raw_text: str, v2_raw_text: str, v1_risk_score: float, playbook_rules_text: str, prior_rounds_context: str = None) -> dict:
    """
    On-demand agent that compares V1 and V2 raw texts, applies playbook rules,
    and returns a structured SmartDiffResult containing deviations and BATNAs.
    Uses gpt-4o as requested for maximum reasoning capability.
    Optionally accepts prior_rounds_context for multi-round pattern detection.
    """
    # Build multi-round context block if available
    rounds_block = ""
    if prior_rounds_context:
        rounds_block = f"""
    MULTI-ROUND NEGOTIATION HISTORY (Previous Rounds):
    {prior_rounds_context}

    Use this history to detect counterparty concession patterns. For example:
    - Did they concede on Payment Terms in V2 but push harder on IP in V3?
    - Are they slowly escalating liability shifts across rounds?
    - Have they consistently ignored your Playbook positions on specific clauses?
    Note any such patterns in your analysis.
    """

    prompt = f"""
    You are a Senior Contract Negotiation Analyst and Counterparty Strategist performing a V1 vs V2 comparison.

    TASK: Compare the PREVIOUS VERSION (V1) against the CURRENT VERSION (V2) of this contract.

    For each significant difference (added, removed, or materially modified clause):
    1. Assess its business impact.
    2. Check if the V2 approach violates the COMPANY PLAYBOOK RULES.
    3. Generate a BATNA fallback clause (a strategic compromise position).
    4. Provide the exact verbatim text of the V2 clause (or V1 if removed) and its character coordinates.
    5. **COUNTERPARTY INTENT (CRITICAL)**: For each deviation, analyze WHY the counterparty made this change.
       Think like a Senior Lawyer advising your client:
       - What is the counterparty trying to achieve or avoid?
       - Are they shifting liability, reducing obligations, expanding rights, or protecting against a specific risk?
       - Reference specific Playbook Rules if the intent appears to circumvent them.
       - Example: "Counterparty is shifting indemnification burden to avoid exposure under Playbook Rule 2.1 (Mutual Indemnity Required)."
       Populate this analysis in the `counterparty_intent` field for each deviation.

    VITAL STRICT INSTRUCTION FOR `v2_text`:
    The `v2_text` field MUST be an EXACT verbatim copy-paste from the V2 TEXT below.
    DO NOT add any markdown formatting (**, *, #, -, +, >, `, ~) to the v2_text.
    DO NOT paraphrase, summarize, or modify the text in any way.
    Copy the EXACT characters as they appear in the V2 TEXT.

    VITAL STRICT INSTRUCTION FOR `v2_coordinates`:
    You MUST provide the EXACT `start_char` and `end_char` index mapping for where `v2_text` occurs within the V2 TEXT provided below. The indices are 0-based.
    If the deviation is a 'Removed' clause, leave `v2_coordinates` completely empty/null, since it no longer exists in V2.
    For 'Added' and 'Modified' clauses, you MUST provide precise coordinates relative to the V2 TEXT block.

    {COORDINATE_INSTRUCTION}
    {rounds_block}

    V1 RISK SCORE: {v1_risk_score}

    COMPANY PLAYBOOK RULES:
    {playbook_rules_text}

    V1 TEXT:
    {v1_raw_text}

    V2 TEXT:
    {v2_raw_text}
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a strategic Diff Engine that identifies deviations, evaluates playbook compliance, and generates BATNA compromises."},
                {"role": "user", "content": prompt}
            ],
            response_format=SmartDiffResult
        )
        parsed_result = response.choices[0].message.parsed
        
        # ================================================================
        # 3-TIER RAG ANCHORING: Ensure V2 coordinates map correctly
        # Tier 1: Exact match
        # Tier 2: Markdown-stripped match
        # Tier 3: Fuzzy substring match (SequenceMatcher)
        # ================================================================
        for dev in parsed_result.deviations:
            if dev.category in ["Added", "Modified"] and dev.v2_text:
                # ── Tier 1: Exact string match ──
                idx = v2_raw_text.find(dev.v2_text)
                
                if idx != -1:
                    dev.v2_coordinates = TextCoordinate(
                        start_char=idx,
                        end_char=idx + len(dev.v2_text),
                        source_text=dev.v2_text
                    )
                    print(f"  ✅ Tier 1 (Exact) anchored: '{dev.title[:40]}' at [{idx}:{idx + len(dev.v2_text)}]")
                else:
                    # ── Tier 2: Markdown-stripped match ──
                    stripped_v2_text = strip_markdown(dev.v2_text)
                    stripped_raw = strip_markdown(v2_raw_text)
                    idx_strip = stripped_raw.find(stripped_v2_text)
                    
                    if idx_strip != -1:
                        # Map the stripped index back to the original text
                        # by finding the approximate position using ratio
                        ratio = idx_strip / max(len(stripped_raw), 1)
                        approx_start = int(ratio * len(v2_raw_text))
                        
                        # Search a window around the approximate position for exact boundaries
                        search_start = max(0, approx_start - 200)
                        search_end = min(len(v2_raw_text), approx_start + len(dev.v2_text) + 200)
                        search_window = v2_raw_text[search_start:search_end]
                        
                        # Try to find the stripped text in the original window
                        best_start, best_end = fuzzy_find_substring(
                            search_window, dev.v2_text, threshold=0.70
                        )
                        if best_start != -1:
                            actual_start = search_start + best_start
                            actual_end = search_start + best_end
                            matched_text = v2_raw_text[actual_start:actual_end]
                            dev.v2_coordinates = TextCoordinate(
                                start_char=actual_start,
                                end_char=actual_end,
                                source_text=matched_text
                            )
                            print(f"  ✅ Tier 2 (Stripped) anchored: '{dev.title[:40]}' at [{actual_start}:{actual_end}]")
                        else:
                            # Fallback: use the LLM's coordinates if plausible
                            if dev.v2_coordinates and dev.v2_coordinates.start_char < len(v2_raw_text):
                                print(f"  ⚠️ Tier 2 partial: '{dev.title[:40]}' — using LLM coordinates")
                            else:
                                dev.v2_coordinates = None
                                print(f"  ⚠️ Tier 2 failed: '{dev.title[:40]}' — trying Tier 3")
                                
                                # ── Tier 3: Fuzzy substring match ──
                                fuzzy_start, fuzzy_end = fuzzy_find_substring(
                                    v2_raw_text, dev.v2_text, threshold=0.75
                                )
                                if fuzzy_start != -1:
                                    matched_text = v2_raw_text[fuzzy_start:fuzzy_end]
                                    dev.v2_coordinates = TextCoordinate(
                                        start_char=fuzzy_start,
                                        end_char=fuzzy_end,
                                        source_text=matched_text
                                    )
                                    print(f"  ✅ Tier 3 (Fuzzy) anchored: '{dev.title[:40]}' at [{fuzzy_start}:{fuzzy_end}]")
                                else:
                                    dev.v2_coordinates = None
                                    print(f"  ❌ All tiers failed: '{dev.title[:40]}' — UNMAPPED")
                    else:
                        # Stripped match failed entirely, go straight to Tier 3
                        fuzzy_start, fuzzy_end = fuzzy_find_substring(
                            v2_raw_text, dev.v2_text, threshold=0.75
                        )
                        if fuzzy_start != -1:
                            matched_text = v2_raw_text[fuzzy_start:fuzzy_end]
                            dev.v2_coordinates = TextCoordinate(
                                start_char=fuzzy_start,
                                end_char=fuzzy_end,
                                source_text=matched_text
                            )
                            print(f"  ✅ Tier 3 (Fuzzy) anchored: '{dev.title[:40]}' at [{fuzzy_start}:{fuzzy_end}]")
                        else:
                            dev.v2_coordinates = None
                            print(f"  ❌ All tiers failed: '{dev.title[:40]}' — UNMAPPED")
            elif dev.category == "Removed":
                dev.v2_coordinates = None  # Removed clauses have no V2 position
                
        return parsed_result.model_dump()
    except Exception as e:
        print(f"Smart Diff Agent Error: {e}")
        import traceback
        traceback.print_exc()
        raise e
