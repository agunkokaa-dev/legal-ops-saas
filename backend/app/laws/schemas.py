from __future__ import annotations

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.laws.utils import sanitize_query_text, strip_html_tags


class LawSearchFilter(BaseModel):
    category: Optional[str] = None
    law_short: Optional[str] = None
    contract_relevance: Optional[Literal["high", "medium", "low"]] = None
    contract_type: Optional[str] = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = re.sub(r"[^a-z_]+", "_", value.strip().lower()).strip("_")
        if not cleaned:
            raise ValueError("Invalid category")
        return cleaned

    @field_validator("law_short")
    @classmethod
    def validate_law_short(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = re.sub(r"\s+", " ", value.strip()).upper()
        if len(cleaned) > 64:
            raise ValueError("law_short is too long")
        return cleaned

    @field_validator("contract_type")
    @classmethod
    def validate_contract_type(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = re.sub(r"[^a-z0-9_ -]+", "", value.strip().lower())
        if not cleaned:
            raise ValueError("Invalid contract_type")
        return cleaned


class LawSearchContext(BaseModel):
    source_type: Optional[str] = None
    title: Optional[str] = None
    impact_analysis: Optional[str] = None
    v1_text: Optional[str] = None
    v2_text: Optional[str] = None
    severity: Optional[str] = None
    playbook_violation: Optional[str] = None

    @field_validator(
        "source_type",
        "title",
        "impact_analysis",
        "v1_text",
        "v2_text",
        "severity",
        "playbook_violation",
    )
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = strip_html_tags(value).strip()
        return cleaned or None


class LawSearchRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=500)
    filters: Optional[LawSearchFilter] = None
    context: Optional[LawSearchContext] = None
    effective_as_of: Optional[date] = None
    limit: int = Field(default=10, ge=1, le=50)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        return sanitize_query_text(value)


class LawSearchResult(BaseModel):
    node_id: str
    law_short: str
    law_full_name: str
    identifier_full: str
    body_snippet: str
    category: str
    legal_status: str
    is_currently_citable: bool
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    legal_status_notes: Optional[str] = None
    legal_status_source_url: Optional[str] = None
    verification_status: str
    human_verified_at: Optional[str] = None
    confidence_score: float = 0.0
    confidence_label: Literal["abstain", "warning", "high"] = "warning"
    warning_note: Optional[str] = None
    retrieval_path: Optional[Literal["citation", "graph", "semantic"]] = None
    reference_type: Optional[Literal["direct", "conditional", "implementing"]] = None
    reference_context: Optional[str] = None


class CorpusCoverageSummary(BaseModel):
    total_laws_in_corpus: int
    category_coverage: dict
    query_coverage_note: Optional[str] = None


class LawSearchResponse(BaseModel):
    intent: Literal["citation", "filter_heavy", "conceptual"]
    query: str
    effective_as_of: str
    resolved_query_category: Optional[str] = None
    results: list[LawSearchResult]
    corpus_status: CorpusCoverageSummary


class CitationLookupResponse(BaseModel):
    query_text: str
    parsed_citation: dict
    resolution_status: Literal["resolved", "not_found", "ambiguous", "not_currently_citable"]
    resolution_note: Optional[str] = None
    effective_as_of: str
    results: list[LawSearchResult]


class LawDetailResponse(BaseModel):
    node_id: str
    law: dict
    version: dict
    hierarchy: list[dict]
    body: Optional[str] = None
    siblings: list[dict]
    legal_status: str
    is_currently_citable: bool
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None
    legal_status_notes: Optional[str] = None
    legal_status_source_url: Optional[str] = None
    verification_status: str
    human_verified_at: Optional[str] = None


class LawsCatalogResponse(BaseModel):
    laws: list[dict]
    coverage: list[dict]
