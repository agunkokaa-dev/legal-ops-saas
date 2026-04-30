import asyncio
import os
import json
import operator
import logging
import time
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
    assess_pipeline_output_quality,
)
from app.ai_usage import extract_openai_usage, log_ai_usage_sync
from app.analysis_cache import build_cache_key, get_cached_analysis_sync, set_cached_analysis_sync
from app.config import LAW_QDRANT_ACTIVE_ALIAS, OUTPUT_TOKEN_CAPS, admin_supabase
from app.diff_utils import changed_clause_payload_size, find_changed_clauses
from app.event_bus import SSEEvent
from app.llm_output_sanitizer import sanitize_llm_text, sanitize_review_finding
from app.token_budget import allocate_budget, count_tokens, get_budget, preflight_check, truncate_to_budget


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
    tenant_id: str                # Tenant context for tenant-scoped retrieval
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
    playbook_rules: list[str]     # Triple RAG: tenant playbook rules from Qdrant
    national_law_excerpts: list[str]  # Triple RAG: active Indonesian law excerpts

    # ── V2 Coordinate-Aware Fields ──
    compliance_findings_v2: Annotated[list, operator.add]  # ComplianceFinding dicts
    risk_flags_v2: Annotated[list, operator.add]            # RiskFlagV2 dicts
    draft_revisions_v2: Annotated[list, operator.add]       # DraftRevisionV2 dicts
    obligations_v2: Annotated[list, operator.add]           # ContractObligationV2 dicts
    classified_clauses_v2: Annotated[list, operator.add]    # ClassifiedClauseV2 dicts
    review_findings: list           # Unified ReviewFinding dicts (set by aggregator)
    quick_insights: list            # QuickInsight dicts (set by aggregator)
    banner: dict                    # BannerData dict (set by aggregator)
    pipeline_output_quality: str    # Quality marker for empty-output guard
    _task_logger: Any               # Optional TaskLogger instance (injected by contracts.py)
    _event_bus: Any                 # Optional EventBus instance (injected by contracts.py)
    _tenant_id: str                 # Tenant context for SSE events


AGENT_PROGRESS = {
    "ingestion": {"name": "01_ingestion", "index": 1, "message": "Extracting contract metadata..."},
    "rag_prefetch": {"name": "rag_prefetch", "index": 2, "message": "Fetching playbook rules and Indonesian law context..."},
    "compliance": {"name": "02_compliance", "index": 3, "message": "Analyzing compliance issues..."},
    "risk": {"name": "03_risk", "index": 4, "message": "Calculating risk score..."},
    "obligation_miner": {"name": "04_obligation_miner", "index": 5, "message": "Extracting contractual obligations..."},
    "clause_classifier": {"name": "05_clause_classifier", "index": 6, "message": "Classifying clause types..."},
    "review_aggregator": {"name": "06_review_aggregator", "index": 7, "message": "Merging and finalizing results..."},
    "negotiation": {"name": "lazy_negotiation", "index": 1, "message": "Generating counter-proposal strategy..."},
    "drafting": {"name": "lazy_drafting", "index": 1, "message": "Suggesting neutral rewrites..."},
}
PIPELINE_AGENT_KEYS = ("ingestion", "rag_prefetch", "compliance", "risk", "obligation_miner", "clause_classifier", "review_aggregator")
TOTAL_AGENTS = len(PIPELINE_AGENT_KEYS)


def _emit_pipeline_event(
    state: ContractState,
    event_type: str,
    agent_key: str,
    *,
    message: Optional[str] = None,
    metadata: Optional[dict] = None,
    duration_ms: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    event_bus_ref = state.get("_event_bus")
    tenant_id = state.get("_tenant_id")
    contract_id = state.get("contract_id")
    if not event_bus_ref or not tenant_id or not contract_id:
        return

    agent_info = AGENT_PROGRESS[agent_key]
    data = {
        "agent_name": agent_info["name"],
        "agent_index": agent_info["index"],
        "total_agents": TOTAL_AGENTS,
        "message": message or agent_info["message"],
    }
    if metadata:
        data["metadata"] = metadata
    if duration_ms is not None:
        data["duration_ms"] = duration_ms
    if error:
        data["error"] = error[:300]

    event_bus_ref.publish_sync(SSEEvent(
        event_type=event_type,
        contract_id=contract_id,
        tenant_id=tenant_id,
        data=data,
    ))


def _serialize_for_prompt(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value or {}, ensure_ascii=False)
    except Exception:
        return str(value)


def _fit_prompt(
    *,
    model: str,
    label: str,
    system_prompt: str,
    user_template: str,
    sections: dict[str, str],
    priorities: dict[str, int],
    reserve_tokens: int = 2048,
) -> tuple[str, dict[str, str]]:
    rendered_prompt = user_template.format(**sections)
    check = preflight_check(model, system_prompt, rendered_prompt, label)
    if check["fits"]:
        return rendered_prompt, sections

    section_tokens = sum(count_tokens(text or "", model) for text in sections.values())
    framing_tokens = max(0, check["user_tokens"] - section_tokens)
    allocation = allocate_budget(
        inputs=sections,
        priorities=priorities,
        total_budget=get_budget(model)["usable_input"],
        model=model,
        system_prompt_tokens=check["system_tokens"] + framing_tokens + reserve_tokens,
    )
    adjusted_sections = {name: text for name, (text, _token_count) in allocation.items()}
    rendered_prompt = user_template.format(**adjusted_sections)
    final_check = preflight_check(model, system_prompt, rendered_prompt, f"{label} (adjusted)")

    if not final_check["fits"] and "raw_document" in adjusted_sections:
        current_tokens = count_tokens(adjusted_sections["raw_document"], model)
        overflow = max(512, -final_check["remaining"] + reserve_tokens)
        adjusted_sections["raw_document"], _, _ = truncate_to_budget(
            adjusted_sections["raw_document"],
            max(1024, current_tokens - overflow),
            model=model,
            strategy="tail_preserve",
        )
        rendered_prompt = user_template.format(**adjusted_sections)
        preflight_check(model, system_prompt, rendered_prompt, f"{label} (final)")

    return rendered_prompt, adjusted_sections


def _state_tenant_id(state: ContractState | dict) -> str | None:
    return state.get("_tenant_id") or state.get("tenant_id")


def _cache_key_for_state(
    state: ContractState | dict,
    *,
    workflow: str,
    document_text: str,
    prompt_version: str = "v1",
    schema_version: str = "v1",
    model_family: str = "gpt-4o-mini",
    playbook_version: str = "v1",
    law_corpus_version: str = "v1",
) -> str | None:
    tenant_id = _state_tenant_id(state)
    if not tenant_id:
        return None
    try:
        return build_cache_key(
            tenant_id=tenant_id,
            workflow=workflow,
            document_text=document_text,
            prompt_version=prompt_version,
            schema_version=schema_version,
            model_family=model_family,
            playbook_version=playbook_version,
            law_corpus_version=law_corpus_version,
        )
    except Exception:
        return None


def _log_usage_for_state(
    state: ContractState | dict,
    *,
    workflow: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    cache_hit: bool = False,
    metadata: dict | None = None,
) -> None:
    log_ai_usage_sync(
        admin_supabase,
        _state_tenant_id(state),
        workflow,
        model,
        input_tokens,
        output_tokens,
        latency_ms,
        contract_id=state.get("contract_id"),
        cache_hit=cache_hit,
        metadata=metadata,
    )


def _log_openai_response(
    state: ContractState | dict,
    *,
    workflow: str,
    model: str,
    response: Any,
    started_at: float,
    metadata: dict | None = None,
) -> None:
    input_tokens, output_tokens = extract_openai_usage(response)
    _log_usage_for_state(
        state,
        workflow=workflow,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=int((time.time() - started_at) * 1000),
        metadata=metadata,
    )


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


ANTI_HALLUCINATION_GUARD = """
CRITICAL ACCURACY REQUIREMENT:
You are a legal analysis tool used by Indonesian lawyers. False findings are WORSE than
missed findings — they damage professional credibility.

Before flagging any issue, ask yourself:
1. Is there EXPLICIT evidence in the contract text? (not implied, not assumed)
2. Would a senior Indonesian lawyer agree this is a real violation?
3. Am I confusing common industry terminology with actual legal violations?

If the answer to any of these is NO or UNCERTAIN — do NOT flag it.
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
    _emit_pipeline_event(state, "pipeline.agent_started", "ingestion")
    started_at = time.time()

    system_prompt = "You are a precise legal extraction engine."
    user_template = """
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
    {raw_document}
    """
    prompt, _ = _fit_prompt(
        model="gpt-4o-mini",
        label="Agent 01 Ingestion",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={"raw_document": state.get('raw_document', '')},
        priorities={"raw_document": 3},
    )
    workflow_name = "ingestion"
    model_name = "gpt-4o-mini"
    cache_key = _cache_key_for_state(
        state,
        workflow=workflow_name,
        document_text=prompt,
        prompt_version="ingestion_v1",
        schema_version="ContractMetadata_v1",
        model_family=model_name,
    )
    if cache_key:
        cached = get_cached_analysis_sync(cache_key)
        if cached:
            _log_usage_for_state(
                state,
                workflow=workflow_name,
                model=model_name,
                input_tokens=0,
                output_tokens=0,
                latency_ms=int((time.time() - started_at) * 1000),
                cache_hit=True,
            )
            return cached

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS["ingestion"],
            response_format=ContractMetadata,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ]
        )
        _log_openai_response(
            state,
            workflow=workflow_name,
            model=model_name,
            response=response,
            started_at=started_at,
        )
        result = response.choices[0].message.parsed
        clauses_dict = {c.clause_name: c.clause_text for c in result.extracted_clauses} if result.extracted_clauses else {}
        print(f"[Agent 01] Extracted: value={result.contract_value}, currency={result.currency}, end_date={result.end_date}")
        if _logger: _logger.log_agent_complete('ingestion', {'currency': result.currency, 'clauses_found': len(clauses_dict)})
        _emit_pipeline_event(
            state,
            "pipeline.agent_completed",
            "ingestion",
            duration_ms=int((time.time() - started_at) * 1000),
            metadata={"clauses_found": len(clauses_dict), "currency": result.currency},
        )
        payload = {
            "contract_value": result.contract_value,
            "currency": result.currency,
            "end_date": result.end_date,
            "effective_date": result.effective_date,
            "jurisdiction": result.jurisdiction,
            "governing_law": result.governing_law,
            "extracted_clauses": clauses_dict
        }
        if cache_key:
            set_cached_analysis_sync(cache_key, payload)
        return payload
    except Exception as e:
        print(f"Ingestion Agent Error: {e}")
        import traceback
        traceback.print_exc()
        if _logger: _logger.log_agent_failed('ingestion', e)
        _emit_pipeline_event(state, "pipeline.agent_failed", "ingestion", error=str(e))
        return {"contract_value": 0.0, "currency": "IDR", "end_date": "Error", "effective_date": None, "jurisdiction": None, "governing_law": None, "extracted_clauses": {}}


# ==========================================
# 2b. Triple RAG Prefetch Node (Qdrant-only)
# ==========================================
MAX_RULE_LENGTH = 300
MAX_LAW_EXCERPT_LENGTH = 400
MAX_PLAYBOOK_RULES = 15
MAX_LAW_EXCERPTS = 8


def _truncate_context_items(items: list[str], *, max_items: int, max_chars: int) -> list[str]:
    seen: set[str] = set()
    truncated: list[str] = []
    for item in items:
        normalized = " ".join(str(item or "").split())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        truncated.append(normalized[:max_chars])
        if len(truncated) >= max_items:
            break
    return truncated


def _format_playbook_rule(point: Any) -> str:
    payload = dict(getattr(point, "payload", {}) or {})
    rule_text = payload.get("rule_text") or payload.get("content") or payload.get("text") or ""
    if not rule_text:
        return ""

    label = payload.get("category") or payload.get("rule_id") or payload.get("title") or ""
    severity = payload.get("risk_severity") or ""
    prefix = " | ".join(part for part in [str(label).strip(), str(severity).strip()] if part)
    return f"{prefix}: {rule_text}" if prefix else str(rule_text)


def _format_law_excerpt(point: Any) -> str:
    payload = dict(getattr(point, "payload", {}) or {})
    body = payload.get("body") or payload.get("text") or payload.get("content") or ""
    if not body:
        return ""

    law_short = payload.get("law_short") or payload.get("source_law_short") or payload.get("source") or "Regulation"
    identifier = payload.get("identifier_full") or payload.get("identifier") or ""
    pasal = payload.get("pasal") or payload.get("article") or ""
    if not identifier and pasal:
        identifier = f"Pasal {pasal}"
    elif pasal and "pasal" not in str(identifier).lower():
        identifier = f"{identifier} Pasal {pasal}".strip()

    label = " ".join(part for part in [str(law_short).strip(), str(identifier).strip()] if part)
    return f"[{label}]: {body}" if label else str(body)


def _infer_law_categories(raw_text: str) -> list[str]:
    text = (raw_text or "")[:12000].lower()
    keyword_groups = [
        (
            "data_protection",
            (
                "data pribadi",
                "personal data",
                "personal information",
                "privacy",
                "pdp",
                "pemrosesan data",
                "data processing",
                "cross-border transfer",
            ),
        ),
        (
            "employment",
            (
                "pkwt",
                "pekerja",
                "buruh",
                "employee",
                "employment",
                "alih daya",
                "outsourcing",
                "uang kompensasi",
            ),
        ),
        (
            "bahasa",
            (
                "bahasa indonesia",
                "indonesian language",
                "hukum indonesia",
                "governing law of indonesia",
                "perseroan terbatas",
                " pt ",
            ),
        ),
    ]
    return [
        category
        for category, keywords in keyword_groups
        if any(keyword in text for keyword in keywords)
    ]


def _scroll_qdrant_points(*, collection_name: str, limit: int, scroll_filter: Filter | None = None) -> list[Any]:
    response = _qdrant.scroll(
        collection_name=collection_name,
        scroll_filter=scroll_filter,
        limit=limit,
        with_payload=True,
        with_vectors=False,
    )
    if isinstance(response, tuple):
        return response[0] or []
    return getattr(response, "points", []) or []


def _fetch_playbook_rules_for_tenant(tenant_id: str) -> list[str]:
    if not tenant_id:
        return []

    points = _scroll_qdrant_points(
        collection_name="company_rules",
        scroll_filter=Filter(must=[
            FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id)),
        ]),
        limit=MAX_PLAYBOOK_RULES,
    )
    return _truncate_context_items(
        [_format_playbook_rule(point) for point in points],
        max_items=MAX_PLAYBOOK_RULES,
        max_chars=MAX_RULE_LENGTH,
    )


def _fetch_national_law_excerpts(raw_text: str) -> list[str]:
    categories = _infer_law_categories(raw_text)
    excerpts: list[str] = []
    collections_to_try = [LAW_QDRANT_ACTIVE_ALIAS, NATIONAL_LAWS_COLLECTION]

    for collection_name in collections_to_try:
        try:
            if categories:
                per_category_limit = max(2, (MAX_LAW_EXCERPTS // len(categories)) + 1)
                for category in categories:
                    try:
                        points = _scroll_qdrant_points(
                            collection_name=collection_name,
                            scroll_filter=Filter(must=[
                                FieldCondition(key="category", match=MatchValue(value=category)),
                            ]),
                            limit=per_category_limit,
                        )
                        excerpts.extend(_format_law_excerpt(point) for point in points)
                    except Exception as exc:
                        print(f"[RAG Prefetch] Law category fetch failed for {collection_name}/{category}: {exc}")

            if len(_truncate_context_items(excerpts, max_items=MAX_LAW_EXCERPTS, max_chars=MAX_LAW_EXCERPT_LENGTH)) < MAX_LAW_EXCERPTS:
                points = _scroll_qdrant_points(
                    collection_name=collection_name,
                    limit=MAX_LAW_EXCERPTS,
                )
                excerpts.extend(_format_law_excerpt(point) for point in points)

            formatted = _truncate_context_items(
                excerpts,
                max_items=MAX_LAW_EXCERPTS,
                max_chars=MAX_LAW_EXCERPT_LENGTH,
            )
            if formatted:
                return formatted
        except Exception as exc:
            print(f"[RAG Prefetch] Law fetch failed for {collection_name}: {exc}")

    return []


def rag_prefetch_node(state: ContractState) -> ContractState:
    """
    Pre-fetch triple RAG context before compliance and risk agents.
    This node performs Qdrant retrieval only; it does not call an LLM or embedding model.
    """
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('rag_prefetch')
    _emit_pipeline_event(state, "pipeline.agent_started", "rag_prefetch")
    started_at = time.time()

    tenant_id = _state_tenant_id(state) or ""
    raw_doc = state.get("raw_document", "")
    playbook_rules: list[str] = []
    national_law_excerpts: list[str] = []

    try:
        playbook_rules = _fetch_playbook_rules_for_tenant(tenant_id)
    except Exception as exc:
        print(f"[RAG Prefetch] Playbook retrieval failed (non-fatal): {exc}")

    try:
        national_law_excerpts = _fetch_national_law_excerpts(raw_doc)
    except Exception as exc:
        print(f"[RAG Prefetch] National law retrieval failed (non-fatal): {exc}")

    metadata = {
        "playbook_rules_count": len(playbook_rules),
        "law_excerpts_count": len(national_law_excerpts),
    }
    if _logger: _logger.log_agent_complete('rag_prefetch', metadata)
    _emit_pipeline_event(
        state,
        "pipeline.agent_completed",
        "rag_prefetch",
        duration_ms=int((time.time() - started_at) * 1000),
        metadata=metadata,
    )
    return {
        "tenant_id": tenant_id,
        "playbook_rules": playbook_rules,
        "national_law_excerpts": national_law_excerpts,
    }


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
    _emit_pipeline_event(state, "pipeline.agent_started", "compliance")
    started_at = time.time()
    print("[Agent 02: Compliance] Auditing clauses for compliance violations...")

    raw_doc = state.get('raw_document', '')
    clauses = state.get('extracted_clauses', {})
    workflow_name = "compliance_first_pass"
    model_name = "gpt-4o-mini"

    playbook_rules = state.get("playbook_rules", [])
    national_law_excerpts = state.get("national_law_excerpts", [])

    playbook_context = ""
    if playbook_rules:
        rules_text = "\n".join(f"- {rule}" for rule in playbook_rules)
        playbook_context = f"""
    COMPANY PLAYBOOK RULES (Internal standards):
    {rules_text}

    STRICT RULES for using playbook rules:
    - Only flag if a contract clause CLEARLY and DIRECTLY violates a specific playbook rule
    - Quote the exact contract text that violates the rule
    - DO NOT flag general industry practices that happen to differ from the rule
    - DO NOT flag if the contract is silent on a topic (only flag explicit contradictions)
    """

    law_context = ""
    if national_law_excerpts:
        laws_text = "\n".join(national_law_excerpts)
        law_context = f"""
    INDONESIAN LAW REFERENCE CONTEXT (Read-only reference):
    {laws_text}

    STRICT RULES for using these law excerpts:
    - ONLY flag a statutory violation if the contract text EXPLICITLY and UNAMBIGUOUSLY contradicts the provision
    - ONLY flag if a MANDATORY clause required by law is COMPLETELY ABSENT from the contract
    - DO NOT flag use of English technical/industry terms (MSA, SOW, NDA, Force Majeure, Vendor, Klien, etc.) — these are internationally accepted legal terms
    - DO NOT flag a contract written in Indonesian simply because it contains some English terms or headings
    - DO NOT infer violations — require explicit textual evidence
    - When in doubt, DO NOT flag — false positives damage user trust
    """

    system_prompt = (
        ANTI_HALLUCINATION_GUARD + "\n"
        "You are a legal compliance engine that outputs structured findings with exact text coordinates. "
        "You have deep knowledge of Indonesian law and MUST cite specific pasal numbers when identifying statutory violations."
    )
    user_template = """
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
    {playbook_context}
    {law_context}

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the source text. 
    Your output MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your outputs (summaries, findings, clauses) MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English if the contract is Indonesian.

    FULL CONTRACT TEXT:
    {raw_document}

    EXTRACTED CLAUSES (for reference):
    {clauses}
    """
    prompt, _ = _fit_prompt(
        model=model_name,
        label="Agent 02 Compliance",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={
            "COORDINATE_INSTRUCTION": COORDINATE_INSTRUCTION,
            "playbook_context": playbook_context,
            "law_context": law_context,
            "raw_document": raw_doc,
            "clauses": _serialize_for_prompt(clauses),
        },
        priorities={
            "COORDINATE_INSTRUCTION": 1,
            "playbook_context": 2,
            "law_context": 2,
            "raw_document": 3,
            "clauses": 1,
        },
    )
    cache_key = _cache_key_for_state(
        state,
        workflow=workflow_name,
        document_text=prompt,
        prompt_version="compliance_v2_triple_rag",
        schema_version="ComplianceAuditV2_v1",
        model_family=model_name,
        playbook_version="company_rules_v1",
        law_corpus_version=LAW_QDRANT_ACTIVE_ALIAS,
    )
    if cache_key:
        cached = get_cached_analysis_sync(cache_key)
        if cached:
            _log_usage_for_state(
                state,
                workflow=workflow_name,
                model=model_name,
                input_tokens=0,
                output_tokens=0,
                latency_ms=int((time.time() - started_at) * 1000),
                cache_hit=True,
            )
            return cached

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS[workflow_name],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            response_format=ComplianceAuditV2
        )
        _log_openai_response(
            state,
            workflow=workflow_name,
            model=model_name,
            response=response,
            started_at=started_at,
            metadata={
                "playbook_context_chars": len(playbook_context),
                "law_context_chars": len(law_context),
            },
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
        _emit_pipeline_event(
            state,
            "pipeline.agent_completed",
            "compliance",
            duration_ms=int((time.time() - started_at) * 1000),
            metadata={"findings_count": len(v2_findings), "statutory_violations": statutory_count},
        )
        payload = {
            "compliance_issues": legacy_issues,
            "compliance_findings_v2": v2_findings
        }
        if cache_key:
            set_cached_analysis_sync(cache_key, payload)
        return payload
    except Exception as e:
        print(f"Compliance Agent Error: {e}")
        if _logger: _logger.log_agent_failed('compliance', e)
        _emit_pipeline_event(state, "pipeline.agent_failed", "compliance", error=str(e))
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
    _emit_pipeline_event(state, "pipeline.agent_started", "risk")
    started_at = time.time()
    print("[Agent 03: Risk] Calculating overall contract risk score...")

    raw_doc = state.get('raw_document', '')
    issues = state.get('compliance_issues', [])
    findings_v2 = state.get('compliance_findings_v2', [])
    value = state.get('contract_value', 'Unknown')
    workflow_name = "risk_first_pass"
    model_name = "gpt-4o-mini"

    national_law_excerpts = state.get("national_law_excerpts", [])
    playbook_rules = state.get("playbook_rules", [])

    law_context = ""
    if national_law_excerpts:
        laws_text = "\n".join(national_law_excerpts[:5])
        law_context = f"""
    INDONESIAN LAW CONTEXT FOR RISK SCORING (Reference only):
    {laws_text}

    STRICT RULES for risk scoring based on laws:
    - Only INCREASE risk score if there is CLEAR, EXPLICIT textual evidence of a violation
    - A contract written in Indonesian with some English technical terms is NOT a language violation
    - Common English legal terms (MSA, NDA, SOW, Force Majeure, Indemnity, etc.) are acceptable in Indonesian contracts
    - Penalize ONLY for substantive violations, not stylistic or terminology choices
    - When uncertain, DO NOT penalize — false positives are worse than false negatives for legal tools
    """

    playbook_context = ""
    if playbook_rules:
        rules_text = "\n".join(f"- {rule}" for rule in playbook_rules[:10])
        playbook_context = f"""
    COMPANY RISK THRESHOLDS (from Playbook):
    {rules_text}

    Only increase risk score if a contract clause EXPLICITLY contradicts a playbook rule.
    Do not penalize for clauses that are merely different from, but not contradictory to, the rules.
    """

    system_prompt = (
        ANTI_HALLUCINATION_GUARD + "\n"
        "You are a risk assessment engine that outputs structured risk flags with severity levels and exact text coordinates."
    )
    user_template = """
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

    {playbook_context}
    {law_context}

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the source text. 
    Your output MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your outputs (summaries, findings, clauses) MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English if the contract is Indonesian.

    {COORDINATE_INSTRUCTION}

    FULL CONTRACT TEXT:
    {raw_document}

    CONTRACT VALUE: {contract_value}
    COMPLIANCE ISSUES:
    {issues}
    """
    prompt, _ = _fit_prompt(
        model=model_name,
        label="Agent 03 Risk",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={
            "COORDINATE_INSTRUCTION": COORDINATE_INSTRUCTION,
            "playbook_context": playbook_context,
            "law_context": law_context,
            "raw_document": raw_doc,
            "contract_value": str(value),
            "issues": _serialize_for_prompt(issues),
        },
        priorities={
            "COORDINATE_INSTRUCTION": 1,
            "playbook_context": 2,
            "law_context": 2,
            "raw_document": 3,
            "contract_value": 1,
            "issues": 2,
        },
    )
    cache_key = _cache_key_for_state(
        state,
        workflow=workflow_name,
        document_text=prompt,
        prompt_version="risk_v2_triple_rag",
        schema_version="RiskAssessmentV2_v1",
        model_family=model_name,
        playbook_version="company_rules_v1",
        law_corpus_version=LAW_QDRANT_ACTIVE_ALIAS,
    )
    if cache_key:
        cached = get_cached_analysis_sync(cache_key)
        if cached:
            _log_usage_for_state(
                state,
                workflow=workflow_name,
                model=model_name,
                input_tokens=0,
                output_tokens=0,
                latency_ms=int((time.time() - started_at) * 1000),
                cache_hit=True,
            )
            return cached

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS[workflow_name],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            response_format=RiskAssessmentV2
        )
        _log_openai_response(
            state,
            workflow=workflow_name,
            model=model_name,
            response=response,
            started_at=started_at,
            metadata={
                "playbook_context_chars": len(playbook_context),
                "law_context_chars": len(law_context),
            },
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
        _emit_pipeline_event(
            state,
            "pipeline.agent_completed",
            "risk",
            duration_ms=int((time.time() - started_at) * 1000),
            metadata={"risk_score": score, "risk_level": risk_level, "flags_count": len(v2_flags)},
        )
        payload = {
            "risk_score": score,
            "risk_level": risk_level,
            "risk_flags": legacy_flags,
            "risk_flags_v2": v2_flags
        }
        if cache_key:
            set_cached_analysis_sync(cache_key, payload)
        return payload
    except Exception as e:
        print(f"Risk Agent Error: {e}")
        if _logger: _logger.log_agent_failed('risk', e)
        _emit_pipeline_event(state, "pipeline.agent_failed", "risk", error=str(e))
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
    _emit_pipeline_event(state, "pipeline.agent_started", "negotiation")
    started_at = time.time()
    print("[Agent 04: Negotiation] Formulating BATNA-based negotiation strategy...")

    issues = state.get('compliance_issues', [])
    flags = state.get('risk_flags', [])
    raw_doc_sample = state.get('raw_document', '')[:5000]
    workflow_name = "negotiation"
    model_name = "gpt-4o-mini"

    system_prompt = "You are a strategic negotiation JSON generator."
    user_template = """
    You are an expert Corporate Negotiation Strategist.
    Analyze the following compliance issues and risk flags and formulate a BATNA-based strategy.
    Provide a robust, professional counter_proposal strategy.

    Return pure JSON with a single key 'counter_proposal' mapping to a detailed string.

    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING):
    You MUST detect the language of the 'FULL CONTRACT TEXT'. 
    Your output (strategy, reasoning, and specifically the drafted rewrite/redline) MUST be in the EXACT SAME LANGUAGE as the source contract. 
    If the contract is written in Indonesian (Bahasa Indonesia), your suggested clauses and explanations MUST be written in formal, legal Indonesian (Bahasa Indonesia baku yang sesuai dengan standar hukum). DO NOT output English redlines for an Indonesian contract.

    FULL CONTRACT TEXT (Sample):
    {raw_document_sample}

    COMPLIANCE ISSUES:
    {issues}
    RISK FLAGS:
    {flags}
    """
    prompt, _ = _fit_prompt(
        model=model_name,
        label="Agent 04 Negotiation",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={
            "raw_document_sample": raw_doc_sample,
            "issues": _serialize_for_prompt(issues),
            "flags": _serialize_for_prompt(flags),
        },
        priorities={
            "raw_document_sample": 3,
            "issues": 2,
            "flags": 2,
        },
    )
    cache_key = _cache_key_for_state(
        state,
        workflow=workflow_name,
        document_text=prompt,
        prompt_version="negotiation_v1",
        schema_version="NegotiationStrategy_v1",
        model_family=model_name,
    )
    if cache_key:
        cached = get_cached_analysis_sync(cache_key)
        if cached:
            _log_usage_for_state(
                state,
                workflow=workflow_name,
                model=model_name,
                input_tokens=0,
                output_tokens=0,
                latency_ms=int((time.time() - started_at) * 1000),
                cache_hit=True,
            )
            return cached

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS[workflow_name],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            response_format=NegotiationStrategy
        )
        _log_openai_response(
            state,
            workflow=workflow_name,
            model=model_name,
            response=response,
            started_at=started_at,
        )
        result = response.choices[0].message.parsed
        if _logger: _logger.log_agent_complete('negotiation')
        _emit_pipeline_event(
            state,
            "pipeline.agent_completed",
            "negotiation",
            duration_ms=int((time.time() - started_at) * 1000),
        )
        payload = {
            "counter_proposal": sanitize_llm_text(
                result.counter_proposal,
                field_name="counter_proposal",
                strict=False,
            )
        }
        if cache_key:
            set_cached_analysis_sync(cache_key, payload)
        return payload
    except Exception as e:
        print(f"Negotiation Agent Error: {e}")
        if _logger: _logger.log_agent_failed('negotiation', e)
        _emit_pipeline_event(state, "pipeline.agent_failed", "negotiation", error=str(e))
        return {
            "counter_proposal": sanitize_llm_text(
                "Error formulating negotiation strategy.",
                field_name="counter_proposal",
                strict=False,
            )
        }


# ==========================================
# 6. Agent 05: Contract Drafting Agent (V2 — Coordinate-Aware)
# ==========================================
def drafting_agent(state: ContractState) -> ContractState:
    """
    AGENT 05: Rewrites risky clauses with exact coordinate mapping.
    """
    _logger = state.get('_task_logger')
    if _logger: _logger.log_agent_start('drafting')
    _emit_pipeline_event(state, "pipeline.agent_started", "drafting")
    started_at = time.time()
    print("[Agent 05: Drafting] Rewriting risky clauses to neutral/fair versions...")

    raw_doc = state.get('raw_document', '')
    strategy = state.get('counter_proposal', '')
    issues = state.get('compliance_issues', [])
    workflow_name = "drafting"
    model_name = "gpt-4o-mini"
    system_prompt = "You are a legal contract drafting engine that outputs clause revisions with exact text coordinates."
    user_template = """
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
    {raw_document}

    NEGOTIATION STRATEGY: {strategy}
    COMPLIANCE ISSUES:
    {issues}
    """
    prompt, _ = _fit_prompt(
        model=model_name,
        label="Agent 05 Drafting",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={
            "COORDINATE_INSTRUCTION": COORDINATE_INSTRUCTION,
            "raw_document": raw_doc,
            "strategy": strategy,
            "issues": _serialize_for_prompt(issues),
        },
        priorities={
            "COORDINATE_INSTRUCTION": 1,
            "raw_document": 3,
            "strategy": 2,
            "issues": 2,
        },
    )
    cache_key = _cache_key_for_state(
        state,
        workflow=workflow_name,
        document_text=prompt,
        prompt_version="drafting_v1",
        schema_version="DraftingResultV2_v1",
        model_family=model_name,
    )
    if cache_key:
        cached = get_cached_analysis_sync(cache_key)
        if cached:
            _log_usage_for_state(
                state,
                workflow=workflow_name,
                model=model_name,
                input_tokens=0,
                output_tokens=0,
                latency_ms=int((time.time() - started_at) * 1000),
                cache_hit=True,
            )
            return cached

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS[workflow_name],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            response_format=DraftingResultV2
        )
        _log_openai_response(
            state,
            workflow=workflow_name,
            model=model_name,
            response=response,
            started_at=started_at,
        )
        result = response.choices[0].message.parsed

        # Legacy format
        legacy_revisions = [{"original_issue": r.original_issue, "neutral_rewrite": r.neutral_rewrite} for r in result.draft_revisions]
        # V2 format
        v2_revisions = [r.model_dump() for r in result.draft_revisions]

        print(f"[Agent 05] Generated {len(v2_revisions)} coordinate-mapped revisions.")
        if _logger: _logger.log_agent_complete('drafting', {'revisions': len(v2_revisions)})
        _emit_pipeline_event(
            state,
            "pipeline.agent_completed",
            "drafting",
            duration_ms=int((time.time() - started_at) * 1000),
            metadata={"revisions_count": len(v2_revisions)},
        )
        payload = {
            "draft_revisions": legacy_revisions,
            "draft_revisions_v2": v2_revisions
        }
        if cache_key:
            set_cached_analysis_sync(cache_key, payload)
        return payload
    except Exception as e:
        print(f"Drafting Agent Error: {e}")
        if _logger: _logger.log_agent_failed('drafting', e)
        _emit_pipeline_event(state, "pipeline.agent_failed", "drafting", error=str(e))
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
    _emit_pipeline_event(state, "pipeline.agent_started", "obligation_miner")
    started_at = time.time()
    print("[Agent 06: Obligation Miner] Extracting contractual obligations...")

    raw_doc = state.get('raw_document', '')
    workflow_name = "obligation_miner"
    model_name = "gpt-4o-mini"

    system_prompt = "You are a precise obligation extraction engine with text coordinate output."
    user_template = """
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
    {raw_document}
    """
    prompt, _ = _fit_prompt(
        model=model_name,
        label="Agent 06 Obligation Miner",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={
            "COORDINATE_INSTRUCTION": COORDINATE_INSTRUCTION,
            "raw_document": raw_doc,
        },
        priorities={
            "COORDINATE_INSTRUCTION": 1,
            "raw_document": 3,
        },
    )
    cache_key = _cache_key_for_state(
        state,
        workflow=workflow_name,
        document_text=prompt,
        prompt_version="obligation_miner_v1",
        schema_version="ObligationMinerResultV2_v1",
        model_family=model_name,
    )
    if cache_key:
        cached = get_cached_analysis_sync(cache_key)
        if cached:
            _log_usage_for_state(
                state,
                workflow=workflow_name,
                model=model_name,
                input_tokens=0,
                output_tokens=0,
                latency_ms=int((time.time() - started_at) * 1000),
                cache_hit=True,
            )
            return cached

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS[workflow_name],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            response_format=ObligationMinerResultV2
        )
        _log_openai_response(
            state,
            workflow=workflow_name,
            model=model_name,
            response=response,
            started_at=started_at,
        )
        result = response.choices[0].message.parsed

        # Legacy format
        legacy_obligations = [{"description": o.description, "due_date": o.due_date} for o in result.obligations]
        # V2 format
        v2_obligations = [o.model_dump() for o in result.obligations]

        print(f"[Agent 06] Extracted {len(v2_obligations)} obligations with coordinates.")
        if _logger: _logger.log_agent_complete('obligation_miner', {'obligations': len(v2_obligations)})
        _emit_pipeline_event(
            state,
            "pipeline.agent_completed",
            "obligation_miner",
            duration_ms=int((time.time() - started_at) * 1000),
            metadata={"obligations_count": len(v2_obligations)},
        )
        payload = {
            "extracted_obligations": legacy_obligations,
            "obligations_v2": v2_obligations
        }
        if cache_key:
            set_cached_analysis_sync(cache_key, payload)
        return payload
    except Exception as e:
        print(f"Obligation Miner Error: {e}")
        if _logger: _logger.log_agent_failed('obligation_miner', e)
        _emit_pipeline_event(state, "pipeline.agent_failed", "obligation_miner", error=str(e))
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
    _emit_pipeline_event(state, "pipeline.agent_started", "clause_classifier")
    started_at = time.time()
    print("[Agent 07: Clause Classifier] Classifying key contract clauses...")

    raw_doc = state.get('raw_document', '')
    clauses = state.get('extracted_clauses', {})
    workflow_name = "clause_classifier"
    model_name = "gpt-4o-mini"

    system_prompt = "You are a legal clause classification engine with text coordinate output."
    user_template = """
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
    {raw_document}

    EXTRACTED CLAUSES (for reference):
    {clauses}
    """
    prompt, _ = _fit_prompt(
        model=model_name,
        label="Agent 07 Clause Classifier",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={
            "COORDINATE_INSTRUCTION": COORDINATE_INSTRUCTION,
            "raw_document": raw_doc,
            "clauses": _serialize_for_prompt(clauses),
        },
        priorities={
            "COORDINATE_INSTRUCTION": 1,
            "raw_document": 3,
            "clauses": 1,
        },
    )
    cache_key = _cache_key_for_state(
        state,
        workflow=workflow_name,
        document_text=prompt,
        prompt_version="clause_classifier_v1",
        schema_version="ClauseClassifierResultV2_v1",
        model_family=model_name,
    )
    if cache_key:
        cached = get_cached_analysis_sync(cache_key)
        if cached:
            _log_usage_for_state(
                state,
                workflow=workflow_name,
                model=model_name,
                input_tokens=0,
                output_tokens=0,
                latency_ms=int((time.time() - started_at) * 1000),
                cache_hit=True,
            )
            return cached

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS[workflow_name],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            response_format=ClauseClassifierResultV2
        )
        _log_openai_response(
            state,
            workflow=workflow_name,
            model=model_name,
            response=response,
            started_at=started_at,
        )
        result = response.choices[0].message.parsed

        # Legacy
        legacy_clauses = [{"clause_type": c.clause_type, "original_text": c.original_text, "ai_summary": c.ai_summary} for c in result.clauses]
        # V2
        v2_clauses = [c.model_dump() for c in result.clauses]

        print(f"[Agent 07] Classified {len(v2_clauses)} clauses with coordinates.")
        if _logger: _logger.log_agent_complete('clause_classifier', {'clauses': len(v2_clauses)})
        _emit_pipeline_event(
            state,
            "pipeline.agent_completed",
            "clause_classifier",
            duration_ms=int((time.time() - started_at) * 1000),
            metadata={"clauses_count": len(v2_clauses)},
        )
        payload = {
            "classified_clauses": legacy_clauses,
            "classified_clauses_v2": v2_clauses
        }
        if cache_key:
            set_cached_analysis_sync(cache_key, payload)
        return payload
    except Exception as e:
        print(f"Clause Classifier Error: {e}")
        if _logger: _logger.log_agent_failed('clause_classifier', e)
        _emit_pipeline_event(state, "pipeline.agent_failed", "clause_classifier", error=str(e))
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
    _emit_pipeline_event(state, "pipeline.agent_started", "review_aggregator")
    started_at = time.time()
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
    findings.sort(key=lambda f: (f.get('coordinates') or {}).get('start_char', 0))
    findings = [sanitize_review_finding(finding, strict=False) for finding in findings]

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

    output_quality, sentinel_findings = assess_pipeline_output_quality(state)

    if sentinel_findings:
        findings = sentinel_findings + findings
        banner["warning_count"] = banner.get("warning_count", 0) + sum(
            1 for finding in sentinel_findings if finding.get("severity") == "warning"
        )
        banner["info_count"] = banner.get("info_count", 0) + sum(
            1 for finding in sentinel_findings if finding.get("severity") == "info"
        )
        banner["critical_count"] = banner.get("critical_count", 0) + sum(
            1 for finding in sentinel_findings if finding.get("severity") == "critical"
        )
        banner["system_warning_count"] = len(sentinel_findings)
        banner["total_count"] = len(findings)

    print(f"[Review Aggregator] Aggregated {len(findings)} findings, {len(quick_insights)} quick insights.")
    if _logger: _logger.log_agent_complete('review_aggregator', {'findings': len(findings), 'quick_insights': len(quick_insights)})
    _emit_pipeline_event(
        state,
        "pipeline.agent_completed",
        "review_aggregator",
        duration_ms=int((time.time() - started_at) * 1000),
        metadata={"findings_count": len(findings), "quick_insights_count": len(quick_insights)},
    )
    return {
        "review_findings": findings,
        "quick_insights": quick_insights,
        "banner": banner,
        "pipeline_output_quality": output_quality.value,
    }


# ==========================================
# 10. Graph Orchestration
# ==========================================
# Initialize the StateGraph with our ContractState
workflow = StateGraph(ContractState)

# Add the agent nodes to the graph
workflow.add_node("ingestion", ingestion_agent)
workflow.add_node("rag_prefetch", rag_prefetch_node)
workflow.add_node("compliance", compliance_agent)
workflow.add_node("risk", risk_agent)
workflow.add_node("obligation_miner", obligation_miner_agent)
workflow.add_node("clause_classifier", clause_classifier_agent)
workflow.add_node("review_aggregator", review_aggregator)

# Define the default upload/review flow. Drafting and Negotiation are lazy
# on-demand operations and are intentionally excluded from this graph.
workflow.add_edge(START, "ingestion")
workflow.add_edge("ingestion", "rag_prefetch")
workflow.add_edge("rag_prefetch", "compliance")
workflow.add_edge("compliance", "risk")
workflow.add_edge("risk", "obligation_miner")
workflow.add_edge("obligation_miner", "clause_classifier")
workflow.add_edge("clause_classifier", "review_aggregator")
workflow.add_edge("review_aggregator", END)

# Compile the graph into an executable application
try:
    clm_graph = workflow.compile()
    print("LangGraph CLM Cost-Optimized Review Orchestration initialized successfully.")
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

def run_smart_diff_agent(
    v1_raw_text: str,
    v2_raw_text: str,
    v1_risk_score: float,
    playbook_rules_text: str,
    prior_rounds_context: str = None,
    tenant_id: str | None = None,
    contract_id: str | None = None,
) -> dict:
    """
    On-demand agent that compares V1 and V2 raw texts, applies playbook rules,
    and returns a structured SmartDiffResult containing deviations and BATNAs.
    Uses gpt-4o as requested for maximum reasoning capability.
    Optionally accepts prior_rounds_context for multi-round pattern detection.
    """
    workflow_name = "smart_diff_triage"
    model_name = "gpt-4o"
    started_at = time.time()
    full_v2_raw_text = v2_raw_text

    changed_clauses = find_changed_clauses(v1_raw_text, v2_raw_text)
    if not changed_clauses:
        result = SmartDiffResult(
            deviations=[],
            batna_fallbacks=[],
            risk_delta=0.0,
            summary="No material changes detected.",
            debate_protocol=None,
        ).model_dump()
        log_ai_usage_sync(
            admin_supabase,
            tenant_id,
            workflow_name,
            "deterministic_diff",
            0,
            0,
            int((time.time() - started_at) * 1000),
            contract_id=contract_id,
            cache_hit=True,
            metadata={"changed_clause_count": 0, "skipped_llm": True},
        )
        return result

    changed_payload_chars = changed_clause_payload_size(changed_clauses)
    original_payload_chars = len(v1_raw_text) + len(v2_raw_text)
    use_compact_diff = (
        changed_payload_chars > 0
        and changed_payload_chars < int(original_payload_chars * 0.75)
        and changed_payload_chars <= 80_000
    )

    if use_compact_diff:
        changed_blocks = []
        for item in changed_clauses:
            changed_blocks.append(
                "\n".join([
                    f"CLAUSE: {item['identifier']}",
                    f"CHANGE_TYPE: {item['change_type']}",
                    f"SIMILARITY: {item.get('similarity', 0)}",
                    f"V1_COORDINATES: {item.get('v1_start_char')}:{item.get('v1_end_char')}",
                    f"V2_COORDINATES: {item.get('v2_start_char')}:{item.get('v2_end_char')}",
                    "V1_CLAUSE_TEXT:",
                    item.get("v1_text") or "",
                    "V2_CLAUSE_TEXT:",
                    item.get("v2_text") or "",
                ])
            )
        compact_changed_clause_text = "\n\n---\n\n".join(changed_blocks)
        prompt_v1_text = "Only changed clauses are included. Use each V1_CLAUSE_TEXT block below."
        prompt_v2_text = (
            "CHANGED CLAUSES ONLY. Coordinates listed in V2_COORDINATES are relative to the full V2 contract.\n\n"
            f"{compact_changed_clause_text}"
        )
    else:
        prompt_v1_text = v1_raw_text
        prompt_v2_text = v2_raw_text

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

    system_prompt = (
        "You are a strategic Diff Engine that identifies deviations, evaluates playbook "
        "compliance, and generates BATNA compromises. Language mirroring is mandatory: "
        "every narrative field must match the dominant language of the V2 contract text."
    )
    language_instruction = """
    CRITICAL LANGUAGE INSTRUCTION (LANGUAGE MIRRORING) — WAJIB DIIKUTI:
    You MUST detect the dominant language of the V2 contract text.
    Your output MUST be in the EXACT SAME LANGUAGE as the V2 contract text.
    - Jika teks kontrak dominan BAHASA INDONESIA → seluruh output HARUS dalam Bahasa Indonesia hukum yang formal
    - Jika teks kontrak dominan BAHASA INGGRIS → seluruh output HARUS dalam English

    Instruksi ini berlaku untuk SEMUA field output tanpa terkecuali:
    - Setiap `impact_analysis` → tulis dalam bahasa yang sama dengan kontrak
    - Setiap `counterparty_intent` → tulis dalam bahasa yang sama dengan kontrak
    - Setiap `reasoning` di BATNA → tulis dalam bahasa yang sama dengan kontrak
    - Setiap `fallback_clause` → tulis dalam bahasa yang sama dengan kontrak
    - Setiap item dalam `leverage_points[]` → tulis dalam bahasa yang sama dengan kontrak
    - Field `summary` → tulis dalam bahasa yang sama dengan kontrak

    DILARANG mencampur bahasa. DILARANG menggunakan English untuk kontrak Indonesia.
    Untuk kontrak Indonesia, `counterparty_intent`, `reasoning`, `fallback_clause`, dan setiap item `leverage_points[]`
    wajib ditulis ulang penuh dalam Bahasa Indonesia, bukan campuran.

    FINAL SELF-CHECK SEBELUM MENJAWAB:
    - Jika V2 berbahasa Indonesia, periksa ulang setiap `impact_analysis`, `counterparty_intent`, `reasoning`,
      `fallback_clause`, `leverage_points[]`, dan `summary`.
    - Jika masih ada kata, kalimat, atau bullet penjelasan dalam English pada field-field tersebut, ubah semuanya ke Bahasa Indonesia.
    - Response dianggap INVALID jika kontrak Indonesia tetapi field-field tersebut masih berbahasa English.
    """
    user_template = """
    You are a Senior Contract Negotiation Analyst and Counterparty Strategist performing a V1 vs V2 comparison.

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
    {LANGUAGE_INSTRUCTION}
    {rounds_block}

    TASK: Compare the PREVIOUS VERSION (V1) against the CURRENT VERSION (V2) of this contract.

    For each significant difference (added, removed, or materially modified clause):
    1. Assess its business impact.
    2. Check if the V2 approach violates the COMPANY PLAYBOOK RULES.
    3. Generate a BATNA fallback clause (a strategic compromise position), plus BATNA `reasoning` and `leverage_points[]`
       in the exact same language as the contract.
    4. Provide the exact verbatim text of the V2 clause (or V1 if removed) and its character coordinates.
    5. **COUNTERPARTY INTENT (CRITICAL)**: For each deviation, analyze WHY the counterparty made this change.
       Think like a Senior Lawyer advising your client:
       - What is the counterparty trying to achieve or avoid?
       - Are they shifting liability, reducing obligations, expanding rights, or protecting against a specific risk?
       - Reference specific Playbook Rules if the intent appears to circumvent them.
       - Example for an Indonesian contract: "Pihak lawan berupaya mengalihkan beban indemnifikasi untuk mengurangi eksposur mereka atas kewajiban klaim pihak ketiga."
       Populate this analysis in the `counterparty_intent` field for each deviation.

    V1 RISK SCORE: {v1_risk_score}

    COMPANY PLAYBOOK RULES:
    {playbook_rules_text}

    V1 TEXT:
    {v1_raw_text}

    V2 TEXT:
    {v2_raw_text}
    """
    prompt, adjusted_sections = _fit_prompt(
        model=model_name,
        label="Smart Diff Agent",
        system_prompt=system_prompt,
        user_template=user_template,
        sections={
            "COORDINATE_INSTRUCTION": COORDINATE_INSTRUCTION,
            "LANGUAGE_INSTRUCTION": language_instruction,
            "rounds_block": rounds_block,
            "v1_risk_score": str(v1_risk_score),
            "playbook_rules_text": playbook_rules_text,
            "v1_raw_text": prompt_v1_text,
            "v2_raw_text": prompt_v2_text,
        },
        priorities={
            "COORDINATE_INSTRUCTION": 1,
            "LANGUAGE_INSTRUCTION": 1,
            "rounds_block": 1,
            "v1_risk_score": 1,
            "playbook_rules_text": 2,
            "v1_raw_text": 3,
            "v2_raw_text": 3,
        },
        reserve_tokens=4096,
    )
    cache_key = None
    if tenant_id:
        try:
            cache_key = build_cache_key(
                tenant_id=tenant_id,
                workflow=workflow_name,
                document_text=prompt,
                prompt_version="smart_diff_v2_changed_clauses",
                schema_version="SmartDiffResult_v1",
                model_family=model_name,
                playbook_version="v1",
                law_corpus_version="v1",
            )
            cached = get_cached_analysis_sync(cache_key)
            if cached:
                log_ai_usage_sync(
                    admin_supabase,
                    tenant_id,
                    workflow_name,
                    model_name,
                    0,
                    0,
                    int((time.time() - started_at) * 1000),
                    contract_id=contract_id,
                    cache_hit=True,
                    metadata={
                        "changed_clause_count": len(changed_clauses),
                        "compact_diff": use_compact_diff,
                    },
                )
                return cached
        except Exception:
            cache_key = None

    try:
        response = client.beta.chat.completions.parse(
            model=model_name,
            max_tokens=OUTPUT_TOKEN_CAPS[workflow_name],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            response_format=SmartDiffResult
        )
        log_ai_usage_sync(
            admin_supabase,
            tenant_id,
            workflow_name,
            model_name,
            *extract_openai_usage(response),
            int((time.time() - started_at) * 1000),
            contract_id=contract_id,
            metadata={
                "changed_clause_count": len(changed_clauses),
                "changed_payload_chars": changed_payload_chars,
                "original_payload_chars": original_payload_chars,
                "compact_diff": use_compact_diff,
            },
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
                idx = full_v2_raw_text.find(dev.v2_text)
                
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
                    stripped_raw = strip_markdown(full_v2_raw_text)
                    idx_strip = stripped_raw.find(stripped_v2_text)
                    
                    if idx_strip != -1:
                        # Map the stripped index back to the original text
                        # by finding the approximate position using ratio
                        ratio = idx_strip / max(len(stripped_raw), 1)
                        approx_start = int(ratio * len(full_v2_raw_text))
                        
                        # Search a window around the approximate position for exact boundaries
                        search_start = max(0, approx_start - 200)
                        search_end = min(len(full_v2_raw_text), approx_start + len(dev.v2_text) + 200)
                        search_window = full_v2_raw_text[search_start:search_end]
                        
                        # Try to find the stripped text in the original window
                        best_start, best_end = fuzzy_find_substring(
                            search_window, dev.v2_text, threshold=0.70
                        )
                        if best_start != -1:
                            actual_start = search_start + best_start
                            actual_end = search_start + best_end
                            matched_text = full_v2_raw_text[actual_start:actual_end]
                            dev.v2_coordinates = TextCoordinate(
                                start_char=actual_start,
                                end_char=actual_end,
                                source_text=matched_text
                            )
                            print(f"  ✅ Tier 2 (Stripped) anchored: '{dev.title[:40]}' at [{actual_start}:{actual_end}]")
                        else:
                            # Fallback: use the LLM's coordinates if plausible
                            if dev.v2_coordinates and dev.v2_coordinates.start_char < len(full_v2_raw_text):
                                print(f"  ⚠️ Tier 2 partial: '{dev.title[:40]}' — using LLM coordinates")
                            else:
                                dev.v2_coordinates = None
                                print(f"  ⚠️ Tier 2 failed: '{dev.title[:40]}' — trying Tier 3")
                                
                                # ── Tier 3: Fuzzy substring match ──
                                fuzzy_start, fuzzy_end = fuzzy_find_substring(
                                    full_v2_raw_text, dev.v2_text, threshold=0.75
                                )
                                if fuzzy_start != -1:
                                    matched_text = full_v2_raw_text[fuzzy_start:fuzzy_end]
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
                            full_v2_raw_text, dev.v2_text, threshold=0.75
                        )
                        if fuzzy_start != -1:
                            matched_text = full_v2_raw_text[fuzzy_start:fuzzy_end]
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

        result_payload = parsed_result.model_dump()
        if cache_key:
            set_cached_analysis_sync(cache_key, result_payload)
        return result_payload
    except Exception as e:
        print(f"Smart Diff Agent Error: {e}")
        import traceback
        traceback.print_exc()
        raise e


async def run_smart_diff_with_debate(
    v1_text: str,
    v2_text: str,
    v1_risk_score: float,
    playbook_rules: str,
    prior_rounds: str | None,
    tenant_id: str,
    contract_id: str,
    enable_debate: bool = False,
    event_bus=None,
) -> dict:
    """
    Wrapper: runs Smart Diff Agent + optional Debate Protocol.
    Debate enriches the diff_result, it does not replace it.
    """
    diff_result = await asyncio.to_thread(
        run_smart_diff_agent,
        v1_raw_text=v1_text,
        v2_raw_text=v2_text,
        v1_risk_score=v1_risk_score,
        playbook_rules_text=playbook_rules,
        prior_rounds_context=prior_rounds,
        tenant_id=tenant_id,
        contract_id=contract_id,
    )

    if enable_debate and diff_result:
        try:
            from app.debate_engine import run_debate_protocol

            debate_result = await run_debate_protocol(
                diff_result=diff_result,
                v2_raw_text=v2_text,
                tenant_id=tenant_id,
                contract_id=contract_id,
                event_bus=event_bus,
            )

            diff_result["debate_protocol"] = debate_result.model_dump()

            for dev in diff_result.get("deviations", []):
                dev_id = dev.get("deviation_id")
                matching = next(
                    (
                        result for result in debate_result.debate_results
                        if result.deviation_id == dev_id and result.verdict
                    ),
                    None,
                )
                if matching and matching.verdict:
                    dev["pre_debate_severity"] = dev.get("severity")
                    dev["debate_verdict"] = matching.verdict.model_dump()
                    if matching.verdict.severity_changed:
                        dev["severity"] = matching.verdict.final_severity
        except Exception as exc:
            logging.getLogger(__name__).error("[DEBATE] Protocol failed, using raw diff: %s", exc)
            diff_result["debate_protocol"] = None
    else:
        diff_result["debate_protocol"] = None

    return diff_result


class PreSignChecklistAssessment(BaseModel):
    bilingual_required: bool = False
    recommended_signature_type: Optional[str] = None
    notes: list[str] = Field(default_factory=list)
    rationale: str = ""


def run_presign_checklist_agent(
    *,
    contract: dict,
    matter: Optional[dict],
    issues: list[dict],
    bilingual_clauses: list[dict],
) -> dict:
    """
    Lightweight AI advisor for the pre-signing checklist.

    This helper is intentionally non-blocking. If the model call fails, callers
    still receive deterministic heuristic guidance.
    """
    matter_industry = ((matter or {}).get("industry") or "").lower()
    jurisdiction = (contract.get("jurisdiction") or "").lower()
    parties = json.dumps(contract.get("parties") or {}, ensure_ascii=False)
    unresolved_critical = [
        issue for issue in issues
        if (issue.get("severity") == "critical" and (issue.get("status") or "").lower() in ("open", "under_review"))
    ]
    has_bilingual = bool(bilingual_clauses) or bool(contract.get("id_raw_text") and contract.get("en_raw_text"))
    regulated_keywords = ["banking", "finance", "insurance", "government", "ojk", "bi", "bfsi"]
    heuristic_recommendation = (
        "certified"
        if any(keyword in matter_industry or keyword in jurisdiction for keyword in regulated_keywords)
        else "simple"
    )
    heuristic_bilingual_required = "indonesia" in jurisdiction or "indones" in parties.lower()

    system_prompt = (
        "You are an Indonesian legal operations reviewer. "
        "Assess whether a contract should have a bilingual version before signing, "
        "whether certified digital signatures are recommended, and return concise notes."
    )
    user_prompt = f"""
    CONTRACT SNAPSHOT:
    title: {contract.get("title")}
    status: {contract.get("status")}
    jurisdiction: {contract.get("jurisdiction")}
    contract_value: {contract.get("currency", "IDR")} {contract.get("contract_value")}
    parties: {parties}
    matter_industry: {(matter or {}).get("industry")}
    risk_level: {contract.get("risk_level")}

    NEGOTIATION:
    total_issues: {len(issues)}
    unresolved_critical: {len(unresolved_critical)}

    BILINGUAL:
    has_bilingual: {has_bilingual}
    bilingual_clause_count: {len(bilingual_clauses)}

    Use Indonesian signing and document practice. Return JSON with:
    - bilingual_required: boolean
    - recommended_signature_type: "certified" or "simple"
    - notes: array of 1-3 short strings
    - rationale: short paragraph
    """

    try:
        started_at = time.time()
        response = client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            max_tokens=OUTPUT_TOKEN_CAPS["presign_checklist"],
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format=PreSignChecklistAssessment,
        )
        log_ai_usage_sync(
            admin_supabase,
            contract.get("tenant_id"),
            "presign_checklist",
            "gpt-4o-mini",
            *extract_openai_usage(response),
            int((time.time() - started_at) * 1000),
            contract_id=contract.get("id"),
        )
        parsed = response.choices[0].message.parsed
        return parsed.model_dump()
    except Exception:
        notes = []
        if heuristic_bilingual_required and not has_bilingual:
            notes.append("Bahasa Indonesia version is advisable before execution.")
        if heuristic_recommendation == "certified":
            notes.append("Certified PSrE signatures are recommended for regulated contexts.")
        if unresolved_critical:
            notes.append("Critical negotiation issues remain open and should block signing.")
        return {
            "bilingual_required": heuristic_bilingual_required,
            "recommended_signature_type": heuristic_recommendation,
            "notes": notes,
            "rationale": "Fallback heuristic guidance generated because the AI pre-sign assessment was unavailable.",
        }
