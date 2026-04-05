"""
Pariana Backend — Review Pipeline Pydantic Schemas

These models enforce strict guardrails on LLM outputs for the Contract Review
workflow. Every finding MUST include exact text coordinates (absolute character
offsets relative to the full raw_document string) so the Frontend can paint
Aggressive Highlights on the correct paragraphs.

Used by:
  - graph.py (Agent 02-07 structured outputs)
  - routers/review.py (API response envelope)
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field
import uuid


# ─────────────────────────────────────────────
# Coordinate System (Document-Level Offsets)
# ─────────────────────────────────────────────

class TextCoordinate(BaseModel):
    """
    Absolute character-level offsets within the full raw_document string.
    The frontend uses these to locate and highlight the exact text span.
    """
    start_char: int = Field(
        description="Start character index (0-based) in the full raw_document."
    )
    end_char: int = Field(
        description="End character index (exclusive) in the full raw_document."
    )
    source_text: str = Field(
        description=(
            "The EXACT verbatim text excerpt from the contract that this "
            "finding refers to. Must be a direct copy-paste from the document."
        )
    )


# ─────────────────────────────────────────────
# Agent-Level Pydantic Output Schemas
# ─────────────────────────────────────────────

class ComplianceFinding(BaseModel):
    """Output schema for Agent 02 (Compliance). Each issue must cite the source."""
    issue: str = Field(description="Description of the compliance violation or risk.")
    category: str = Field(
        description=(
            "Category: 'Order of Precedence', 'Missing Clause', 'Biased Term', 'Regulatory', "
            "'Statutory Violation', 'Other'. "
            "Use 'Statutory Violation' ONLY when citing a specific Indonesian law provision "
            "(e.g. Pasal 31 UU 24/2009). This maps to CRITICAL severity in the review pipeline."
        )
    )
    source_text: str = Field(
        description="The EXACT verbatim quote from the contract that triggers this issue."
    )
    start_char: int = Field(
        description="Start character offset (0-based) of source_text in the full raw_document."
    )
    end_char: int = Field(
        description="End character offset (exclusive) of source_text in the full raw_document."
    )


class ComplianceAuditV2(BaseModel):
    """Structured output for Agent 02 with coordinate-mapped findings."""
    findings: list[ComplianceFinding] = Field(
        default_factory=list,
        description="List of compliance findings with exact text coordinates."
    )


class RiskFlagV2(BaseModel):
    """Output schema for Agent 03 (Risk). Each flag must cite the source."""
    flag: str = Field(description="Short summary of the risk danger.")
    severity: Literal["critical", "warning", "info"] = Field(
        description="Severity level: 'critical' (red), 'warning' (yellow), 'info' (blue)."
    )
    source_text: str = Field(
        description="The EXACT verbatim quote from the contract that triggers this risk flag."
    )
    start_char: int = Field(
        description="Start character offset (0-based) of source_text in the full raw_document."
    )
    end_char: int = Field(
        description="End character offset (exclusive) of source_text in the full raw_document."
    )


class RiskAssessmentV2(BaseModel):
    """Structured output for Agent 03 with coordinate-mapped risk flags."""
    risk_score: float = Field(description="Score between 0.0 and 100.0")
    risk_level: str = Field(description="'High', 'Medium', 'Low', or 'Safe'")
    risk_flags: list[RiskFlagV2] = Field(
        default_factory=list,
        description="List of risk flags with severity and exact text coordinates."
    )


class DraftRevisionV2(BaseModel):
    """Output schema for Agent 05 (Drafting). Links revision to original text."""
    original_issue: str = Field(description="The original problematic clause description.")
    neutral_rewrite: str = Field(description="The AI-suggested fair/neutral rewrite.")
    source_text: str = Field(
        description="The EXACT verbatim quote of the original clause being revised."
    )
    start_char: int = Field(
        description="Start character offset (0-based) of source_text in the full raw_document."
    )
    end_char: int = Field(
        description="End character offset (exclusive) of source_text in the full raw_document."
    )


class DraftingResultV2(BaseModel):
    """Structured output for Agent 05 with coordinate-mapped revisions."""
    draft_revisions: list[DraftRevisionV2] = Field(default_factory=list)


class ContractObligationV2(BaseModel):
    """Output schema for Agent 06 (Obligation Miner) with coordinates."""
    description: str = Field(description="Clear, concise description of the obligation.")
    due_date: Optional[str] = Field(
        default=None,
        description="Deadline or date if mentioned, otherwise null."
    )
    source_text: str = Field(
        description="The EXACT verbatim quote from the contract containing this obligation."
    )
    start_char: int = Field(
        description="Start character offset (0-based) of source_text in the full raw_document."
    )
    end_char: int = Field(
        description="End character offset (exclusive) of source_text in the full raw_document."
    )


class ObligationMinerResultV2(BaseModel):
    """Structured output for Agent 06 with coordinate-mapped obligations."""
    obligations: list[ContractObligationV2] = Field(default_factory=list)


class ClassifiedClauseV2(BaseModel):
    """Output schema for Agent 07 (Clause Classifier) with coordinates."""
    clause_type: str = Field(description="Standard category from the valid list.")
    original_text: str = Field(description="Exact text excerpt of this clause.")
    ai_summary: str = Field(description="1-2 sentence plain-English summary.")
    start_char: int = Field(
        description="Start character offset (0-based) of original_text in the full raw_document."
    )
    end_char: int = Field(
        description="End character offset (exclusive) of original_text in the full raw_document."
    )


class ClauseClassifierResultV2(BaseModel):
    """Structured output for Agent 07 with coordinate-mapped clauses."""
    clauses: list[ClassifiedClauseV2] = Field(default_factory=list)


# ─────────────────────────────────────────────
# Unified Review Response Models (API Layer)
# ─────────────────────────────────────────────

class ReviewFinding(BaseModel):
    """
    A single finding from the review pipeline, ready for the frontend.
    Combines compliance issues, risk flags, and draft revisions into one shape.
    """
    finding_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique ID for this finding."
    )
    severity: Literal["critical", "warning", "info"] = Field(
        description="Visual severity: 'critical' (🔴), 'warning' (🟡), 'info' (🔵)."
    )
    category: str = Field(
        description="Finding category, e.g. 'Compliance', 'Risk', 'Missing Clause', 'Biased Term'."
    )
    title: str = Field(
        description="Short label for the banner and sidebar (max 60 chars)."
    )
    description: str = Field(
        description="Full explanation for the tooltip and detail panel."
    )
    coordinates: TextCoordinate = Field(
        description="Exact location of the relevant text in the raw document."
    )
    suggested_revision: Optional[str] = Field(
        default=None,
        description="AI-suggested redline text to replace the source text."
    )
    playbook_reference: Optional[str] = Field(
        default=None,
        description="Which company playbook rule triggered this finding."
    )
    status: Literal["open", "accepted", "dismissed"] = Field(
        default="open",
        description="Lifecycle status of this finding."
    )


class BannerData(BaseModel):
    """Aggregated counts for the AI Insight Banner."""
    critical_count: int = Field(default=0, description="Number of 🔴 critical findings.")
    warning_count: int = Field(default=0, description="Number of 🟡 warning findings.")
    info_count: int = Field(default=0, description="Number of 🔵 info findings.")
    total_count: int = Field(default=0, description="Total findings.")


class QuickInsight(BaseModel):
    """A single quick insight for the right sidebar."""
    label: str = Field(description="Label, e.g. 'Contract Value', 'Payment Terms'.")
    value: str = Field(description="Display value, e.g. '$10M', 'Net 30'.")
    icon: str = Field(
        default="info",
        description="Material Symbols icon name."
    )


class ReviewResponse(BaseModel):
    """
    The unified API response for the Contract Review page.
    This is the single JSON payload that drives the entire frontend UI.
    """
    contract_id: str
    banner: BannerData
    quick_insights: list[QuickInsight] = Field(default_factory=list)
    findings: list[ReviewFinding] = Field(default_factory=list)
    raw_document: str = Field(
        description="The original clean document text. NEVER modified by AI."
    )


# ─────────────────────────────────────────────
# War Room (Phase 2): Smart Diff Models
# ─────────────────────────────────────────────

class DiffDeviation(BaseModel):
    """A single clause-level difference between V1 and V2."""
    deviation_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique ID for this deviation."
    )
    title: str = Field(
        description="Short, impactful label (e.g. 'Liability Cap Reduced', 'Termination Added')."
    )
    category: Literal["Added", "Removed", "Modified", "Unchanged-Risk"] = Field(
        description="What type of change occurred."
    )
    severity: Literal["critical", "warning", "info"] = Field(
        description="Severity based on business impact and playbook deviation."
    )
    v1_text: str = Field(
        description="Exact verbatim text of the clause in V1 (empty if added in V2)."
    )
    v2_text: str = Field(
        description="Exact verbatim text of the clause in V2 (empty if removed in V2)."
    )
    v2_coordinates: Optional[TextCoordinate] = Field(
        default=None,
        description="Position in V2 raw_text. Optional if the clause was removed."
    )
    impact_analysis: str = Field(
        description="Detailed explanation of what this change means for the business."
    )
    playbook_violation: Optional[str] = Field(
        default=None,
        description="Which playbook rule is violated, if any."
    )
    counterparty_intent: Optional[str] = Field(
        default=None,
        description="Analysis of WHY the counterparty made this change — their likely motivation, strategic objective, and what they are trying to achieve or avoid."
    )

class BATNAFallback(BaseModel):
    """An AI-generated BATNA fallback clause for a deviation."""
    deviation_id: str = Field(
        description="Must match exactly the deviation_id from the deviations array."
    )
    fallback_clause: str = Field(
        description="The detailed, exact text of the suggested compromise clause."
    )
    reasoning: str = Field(
        description="Explanation of why this is a strong middle-ground position."
    )
    leverage_points: list[str] = Field(
        default_factory=list,
        description="Bullet points of negotiation leverage to use when proposing this fallback."
    )

class SmartDiffResult(BaseModel):
    """Structured output for the Smart Diff Agent."""
    deviations: list[DiffDeviation] = Field(
        default_factory=list,
        description="List of significant differences found."
    )
    batna_fallbacks: list[BATNAFallback] = Field(
        default_factory=list,
        description="Strategic fallbacks generated for high-severity deviations."
    )
    risk_delta: float = Field(
        description="V2 risk score minus V1 risk score."
    )
    summary: str = Field(
        description="A 2-3 sentence executive summary of the negotiation position."
    )
