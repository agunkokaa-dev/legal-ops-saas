from enum import Enum
from typing import Literal, Optional
from pydantic import BaseModel, Field
from datetime import datetime
from app.review_schemas import TextCoordinate

class ClauseSyncStatus(str, Enum):
    SYNCED = "synced"
    OUT_OF_SYNC = "out_of_sync"
    NEEDS_REVIEW = "needs_review"
    AI_PENDING = "ai_pending"

class BilingualClause(BaseModel):
    id: str
    clause_number: str
    id_text: str
    en_text: Optional[str] = None
    sync_status: ClauseSyncStatus
    last_synced_at: Optional[datetime] = None

class ClauseSyncRequest(BaseModel):
    clause_id: str
    source_language: Literal["id", "en"]
    source_text: str

class ClauseCreateRequest(BaseModel):
    clause_number: str

class ClauseSyncResponse(BaseModel):
    suggested_translation: str
    confidence_score: float  # 0.0 - 1.0
    legal_notes: str

class ClauseUpdateRequest(BaseModel):
    id_text: Optional[str] = None
    en_text: Optional[str] = None

class BilingualFinding(BaseModel):
    clause_id: str
    id_clause_text: str
    en_clause_text: Optional[str] = None
    divergence_type: str
    severity: Literal["critical", "warning", "info"]
    explanation: str
    suggested_correction_language: Literal["id", "en", "both"]
    id_coordinates: Optional[TextCoordinate] = None
    en_coordinates: Optional[TextCoordinate] = None

class BilingualConsistencyReport(BaseModel):
    findings: list[BilingualFinding] = Field(default_factory=list)
    overall_consistency_score: float
    id_version_complete: bool
    en_version_complete: bool
    legally_compliant: bool
    compliance_notes: str
