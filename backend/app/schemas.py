"""
Pariana Backend - Pydantic Schemas
All request/response models used across the application.
"""
from pydantic import BaseModel
from typing import List, Optional


class MatterCreate(BaseModel):
    name: str
    description: str


class ClauseAssistantRequest(BaseModel):
    message: str
    contractId: str
    matterId: str
    userId: str = None


class PlaybookRuleRequest(BaseModel):
    rule_id: str
    user_id: str
    category: str
    standard_position: str
    fallback_position: Optional[str] = None
    redline: Optional[str] = None
    risk_severity: str


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
