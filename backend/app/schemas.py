"""
Pariana Backend - Pydantic Schemas
All request/response models used across the application.
"""
from pydantic import BaseModel
from typing import Any, List, Optional


class MatterCreate(BaseModel):
    name: str
    description: str


class ClauseAssistantRequest(BaseModel):
    message: str
    contractId: str
    matterId: str
    userId: str = None


class PlaybookVectorizeRequest(BaseModel):
    id: int
    user_id: str
    rule_text: str
    category: Optional[str] = None
    standard_position: Optional[str] = None
    fallback_position: Optional[str] = None
    redline: Optional[str] = None
    risk_severity: Optional[str] = None


class ExtractObligationsRequest(BaseModel):
    contract_id: str
    user_id: str


# --- SOP Template Engine Models ---
class TemplateItemCreate(BaseModel):
    title: str
    description: Optional[str] = None
    days_offset: int = 0
    position: int = 0
    procedural_steps: Optional[list[str]] = []


class TemplateCreateRequest(BaseModel):
    name: str
    matter_type: Optional[str] = None
    items: List[TemplateItemCreate]


class ApplyTemplateRequest(BaseModel):
    template_id: str
    matter_id: str


class TaskAssistantRequest(BaseModel):
    matter_id: str
    task_id: str
    message: str
    tenant_id: Optional[str] = None
    source_page: Optional[str] = "dashboard"
    document_id: Optional[str] = None


class ArchiveContractRequest(BaseModel):
    archive_reason: str


# --- Intake Portal Models ---
class IntakeRequestCreate(BaseModel):
    request_type: str  # e.g., "NDA", "PKS", "Review"
    counterparty: str
    urgency: str  # e.g., "Standard", "High"
    business_context: str
    matter_id: Optional[str] = None


# --- Smart Drafting Models ---
class DraftGenerateRequest(BaseModel):
    matter_id: str
    template_name: str
    party_name: str
    instructions: Optional[str] = None


class DraftAuditRequest(BaseModel):
    matter_id: str
    title: str
    draft_text: str


class DraftChatRequest(BaseModel):
    draft_text: str
    question: str


class DraftSaveRequest(BaseModel):
    matter_id: str
    title: str
    draft_text: Any  # Accepts string OR full JSONB {latest_text, history[]}
    contract_id: Optional[str] = None


class ApplySuggestionRequest(BaseModel):
    contract_id: str
    original_issue: str
    neutral_rewrite: str


# --- Clause Library Models ---
class ClauseBase(BaseModel):
    category: str
    clause_type: str  # 'Standard' or 'Fallback'
    title: str
    content: str
    guidance_notes: Optional[str] = None

class ClauseCreate(ClauseBase):
    pass

class ClauseResponse(ClauseBase):
    id: str
    tenant_id: str
    created_at: str
    updated_at: str


class ClauseMatchRequest(BaseModel):
    query_text: str
    limit: int = 3
    category: Optional[str] = None


class ClauseMatchResult(BaseModel):
    id: str
    category: str
    clause_type: str
    title: str
    content: str
    guidance_notes: Optional[str] = None
    similarity_score: float


# --- Negotiation War Room (Phase 1) Models ---

class ContractVersionResponse(BaseModel):
    id: str
    contract_id: str
    version_number: int
    risk_score: float = 0.0
    risk_level: str = "Unknown"
    uploaded_filename: Optional[str] = None
    created_at: str


class NegotiationIssueResponse(BaseModel):
    id: str
    contract_id: str
    version_id: Optional[str] = None
    finding_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    severity: str = "warning"
    category: Optional[str] = None
    status: str = "open"
    linked_task_id: Optional[str] = None
    coordinates: Optional[Any] = None
    suggested_revision: Optional[str] = None
    playbook_reference: Optional[str] = None
    created_at: str


class EscalateIssueRequest(BaseModel):
    issue_id: str
    matter_id: str


class VersionCandidateResponse(BaseModel):
    """Returned by upload when a potential version match is detected."""
    is_version_candidate: bool = False
    matched_contract_id: Optional[str] = None
    matched_contract_title: Optional[str] = None
    similarity_score: float = 0.0
    uploaded_contract_id: str  # The new contract ID created (pending link)
    uploaded_filename: str


class ConfirmVersionLinkRequest(BaseModel):
    """User confirms that a newly uploaded contract is a new version."""
    new_contract_id: str
    parent_contract_id: str

class DiffRequest(BaseModel):
    v1_version_id: Optional[str] = None
    v2_version_id: Optional[str] = None

