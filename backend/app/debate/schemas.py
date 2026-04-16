from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class DebateRole(str, Enum):
    PROSECUTOR = "prosecutor"
    DEFENDER = "defender"
    JUDGE = "judge"


class EvidenceReference(BaseModel):
    """Evidence cited by a debate agent."""

    type: Literal[
        "playbook_rule",
        "national_law",
        "contract_text",
        "industry_standard",
        "case_precedent",
    ]
    reference: str = Field(description="Specific source reference or citation.")
    relevance: str = Field(description="Why this evidence matters to the argument.")


class DebateTurn(BaseModel):
    """One completed debate turn."""

    turn_number: int = Field(ge=1, le=4)
    role: DebateRole
    agent_name: str = Field(description="Human-friendly agent name.")
    model: str = Field(description="LLM model identifier used for this turn.")

    argument: str = Field(description="Main argument body, usually 2-4 paragraphs.")
    key_points: list[str] = Field(min_length=3, max_length=5)
    evidence_cited: list[EvidenceReference] = Field(default_factory=list)

    responding_to: Optional[str] = Field(default=None)
    concession: Optional[str] = Field(default=None)
    confidence: float = Field(ge=0.0, le=1.0)

    tokens_used: dict[str, int] = Field(
        default_factory=lambda: {"input": 0, "output": 0}
    )
    duration_ms: int = Field(default=0, ge=0)
    timestamp: datetime = Field(default_factory=utc_now)


class RiskDimension(BaseModel):
    legal_risk: Literal["low", "medium", "high", "critical"]
    business_risk: Literal["low", "medium", "high", "critical"]
    compliance_risk: Literal["low", "medium", "high", "critical"]


class VerdictKeyFactor(BaseModel):
    factor: str = Field(description="Decision factor name.")
    weight: float = Field(ge=0.0, le=1.0)
    favors: Literal["prosecutor", "defender"]


class JudgeVerdict(BaseModel):
    recommendation: Literal[
        "accept",
        "reject",
        "reject_with_counter",
        "accept_with_conditions",
        "escalate_to_human",
    ]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(description="Judge synthesis and rationale.")

    risk_assessment: RiskDimension
    suggested_action: Literal["accept", "reject", "counter", "escalate"]
    compromise_text: Optional[str] = Field(default=None)
    key_factors: list[VerdictKeyFactor] = Field(min_length=3, max_length=6)
    dissenting_note: Optional[str] = Field(default=None)

    @model_validator(mode="after")
    def validate_key_factor_weights(self) -> "JudgeVerdict":
        total = sum(factor.weight for factor in self.key_factors)
        if not 0.95 <= total <= 1.05:
            raise ValueError(
                f"JudgeVerdict.key_factors weights must sum to ~1.0; got {total:.3f}"
            )
        return self


class DebateSessionCreate(BaseModel):
    deviation_id: str
    issue_id: Optional[str] = None
    debate_focus: Literal["full"] = "full"


class DebateSessionResponse(BaseModel):
    id: str
    contract_id: str
    deviation_id: str
    status: Literal["queued", "running", "completed", "failed"]
    current_turn: int
    total_turns: int = 5
    turns: list[DebateTurn] = Field(default_factory=list)
    verdict: Optional[JudgeVerdict] = None
    duration_ms: Optional[int] = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    created_at: datetime
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None


class ProsecutorOutput(BaseModel):
    argument: str
    key_points: list[str] = Field(min_length=3, max_length=5)
    evidence_cited: list[EvidenceReference] = Field(default_factory=list)
    responding_to: Optional[str] = None
    concession: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)


class DefenderOutput(BaseModel):
    argument: str
    key_points: list[str] = Field(min_length=3, max_length=5)
    evidence_cited: list[EvidenceReference] = Field(default_factory=list)
    responding_to: Optional[str] = None
    concession: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)


class JudgeOutput(BaseModel):
    recommendation: Literal[
        "accept",
        "reject",
        "reject_with_counter",
        "accept_with_conditions",
        "escalate_to_human",
    ]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    risk_assessment: RiskDimension
    suggested_action: Literal["accept", "reject", "counter", "escalate"]
    compromise_text: Optional[str] = None
    key_factors: list[VerdictKeyFactor] = Field(min_length=3, max_length=6)
    dissenting_note: Optional[str] = None

    @model_validator(mode="after")
    def validate_key_factor_weights(self) -> "JudgeOutput":
        total = sum(factor.weight for factor in self.key_factors)
        if not 0.95 <= total <= 1.05:
            raise ValueError(
                f"JudgeOutput.key_factors weights must sum to ~1.0; got {total:.3f}"
            )
        return self
