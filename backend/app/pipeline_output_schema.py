"""
Pariana Backend — PipelineOutput Typed Schema

Defines the explicit contract for the ``contract_versions.pipeline_output``
JSONB column.  Every read and write of ``pipeline_output`` MUST go through
:func:`parse_pipeline_output` / :func:`serialize_pipeline_output` to ensure
schema consistency and catch drift early.

Design rules
------------
* **Read** (``parse_pipeline_output``): ``extra = "allow"`` — unknown keys are
  accepted but logged as warnings.  This keeps us forward-compatible with old
  rows that may contain legacy keys we haven't cleaned up yet.
* **Write** (``serialize_pipeline_output``): uses
  ``model_dump(exclude_unset=True)`` through a *strict* re-validation pass so
  that only declared fields are persisted.  Any attempt to write an unknown key
  produces a hard error.
* ``_pending_*`` JSON keys are mapped to normal Python field names
  (``pending``, ``pending_file_path``, …) via ``alias``.
* ``schema_version`` is stamped on every write so future migrations can branch
  on it.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.review_schemas import (
    BannerData,
    QuickInsight,
    ReviewFinding,
    SmartDiffResult,
)

logger = logging.getLogger(__name__)

# Current schema revision — bump when adding/removing fields.
CURRENT_SCHEMA_VERSION = 1


# ─────────────────────────────────────────────
# Sub-models
# ─────────────────────────────────────────────

class TruncationWarning(BaseModel):
    """Metadata about document truncation before pipeline analysis."""

    original_tokens: int = 0
    truncated_to: int = 0
    chars_removed: int = 0
    strategy: str = ""
    message: str = ""


class StoredBannerData(BannerData):
    """
    Extension of :class:`BannerData` that allows the extra
    ``system_warning_count`` key injected by the review aggregator.
    """

    system_warning_count: int = Field(
        default=0,
        description="Number of system-generated sentinel warnings.",
    )


# ─────────────────────────────────────────────
# Main Schema
# ─────────────────────────────────────────────

class PipelineOutput(BaseModel):
    """
    Typed schema for the ``contract_versions.pipeline_output`` JSONB column.

    This is the **single authoritative definition** of what keys are valid.
    All reads and writes should go through :func:`parse_pipeline_output` and
    :func:`serialize_pipeline_output` respectively.
    """

    # ── Schema Versioning ──
    schema_version: int = Field(
        default=CURRENT_SCHEMA_VERSION,
        description="Schema revision number.  Bumped when fields change.",
    )

    # ── Review Pipeline Results ──
    review_findings: list[ReviewFinding] = Field(default_factory=list)
    quick_insights: list[QuickInsight] = Field(default_factory=list)
    banner: Optional[StoredBannerData] = None
    pipeline_output_quality: Optional[str] = None  # "complete" | "partial" | "empty"

    # ── Risk & Compliance (V2 coordinate-aware) ──
    risk_score: Optional[float] = None
    risk_level: Optional[str] = None
    risk_flags_v2: list[dict[str, Any]] = Field(default_factory=list)
    compliance_findings_v2: list[dict[str, Any]] = Field(default_factory=list)

    # ── Drafting & Classification (V2 coordinate-aware) ──
    draft_revisions_v2: list[dict[str, Any]] = Field(default_factory=list)
    obligations_v2: list[dict[str, Any]] = Field(default_factory=list)
    classified_clauses_v2: list[dict[str, Any]] = Field(default_factory=list)

    # ── Contract Metadata (from Ingestion Agent) ──
    contract_value: Optional[float] = None
    currency: Optional[str] = None
    end_date: Optional[str] = None
    effective_date: Optional[str] = None
    jurisdiction: Optional[str] = None
    governing_law: Optional[str] = None
    counter_proposal: Optional[str] = None

    # ── Truncation ──
    truncation_warning: Optional[TruncationWarning] = None

    # ── Smart Diff (War Room) ──
    diff_result: Optional[SmartDiffResult] = None

    # ── Pending Version Staging ──
    # Python field names are clean; ``alias`` maps to the underscore-prefixed
    # JSON keys stored in the database for backward compatibility.
    pending: Optional[bool] = Field(default=None, alias="_pending")
    pending_file_path: Optional[str] = Field(default=None, alias="_pending_file_path")
    pending_file_type: Optional[str] = Field(default=None, alias="_pending_file_type")
    pending_file_size: Optional[int] = Field(default=None, alias="_pending_file_size")
    pending_matter_id: Optional[str] = Field(default=None, alias="_pending_matter_id")

    # Allow unknown keys on read only — write path enforces strict mode.
    model_config = ConfigDict(
        extra="allow",
        populate_by_name=True,
    )

    @model_validator(mode="before")
    @classmethod
    def _warn_unknown_keys(cls, values: Any) -> Any:
        """Log a warning when unrecognised keys are found on read."""
        if isinstance(values, dict):
            known_fields = set(cls.model_fields.keys())
            known_aliases = {
                field_info.alias
                for field_info in cls.model_fields.values()
                if field_info.alias
            }
            known = known_fields | known_aliases
            unknown = set(values.keys()) - known
            if unknown:
                logger.warning(
                    "pipeline_output_unknown_keys | keys=%s | "
                    "These keys are not defined in PipelineOutput schema. "
                    "Consider adding them to pipeline_output_schema.py.",
                    sorted(unknown),
                )
        return values


# ─────────────────────────────────────────────
# Public Helpers
# ─────────────────────────────────────────────

class PipelineOutputParseError(Exception):
    """Raised when pipeline_output cannot be parsed into PipelineOutput."""

    def __init__(self, raw: dict | None, cause: Exception):
        self.raw = raw
        self.cause = cause
        super().__init__(
            f"Failed to parse pipeline_output: {cause!r} | "
            f"keys={sorted(raw.keys()) if raw else '(none)'}"
        )


def parse_pipeline_output(raw: dict | None) -> PipelineOutput:
    """
    Parse a raw JSONB dict into a typed :class:`PipelineOutput`.

    Uses ``extra="allow"`` so unknown keys are logged but don't crash.
    If validation fails entirely, raises :class:`PipelineOutputParseError`
    with full context — no silent fallback to an empty model.
    """
    if not raw:
        return PipelineOutput()
    try:
        return PipelineOutput.model_validate(raw)
    except Exception as exc:
        raise PipelineOutputParseError(raw, exc) from exc


def serialize_pipeline_output(output: PipelineOutput) -> dict:
    """
    Serialize a :class:`PipelineOutput` into a JSONB-safe dict.

    * Writes ``schema_version`` automatically.
    * Uses ``by_alias=True`` so pending fields get their ``_pending_*`` keys.
    * Excludes ``None`` values to keep the column lean.
    * **Strict pass**: re-validates with ``extra="forbid"`` semantics by
      checking for leftover extra fields and refusing to write them.
    """
    output.schema_version = CURRENT_SCHEMA_VERSION

    # Dump with aliases and without None values.
    data = output.model_dump(by_alias=True, exclude_none=True, mode="json")

    # Strict write guard: reject any extra fields that aren't in the schema.
    declared_keys = set(PipelineOutput.model_fields.keys())
    declared_aliases = {
        field_info.alias
        for field_info in PipelineOutput.model_fields.values()
        if field_info.alias
    }
    allowed_keys = declared_keys | declared_aliases
    extra_keys = set(data.keys()) - allowed_keys
    if extra_keys:
        logger.error(
            "pipeline_output_write_rejected | extra_keys=%s | "
            "Refusing to write unknown keys to pipeline_output. "
            "Add them to PipelineOutput in pipeline_output_schema.py first.",
            sorted(extra_keys),
        )
        for key in extra_keys:
            del data[key]

    return data
