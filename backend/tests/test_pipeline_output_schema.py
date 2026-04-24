"""
Tests for app.pipeline_output_schema — PipelineOutput typed schema.

Covers:
  - parse_pipeline_output: empty, valid, unknown keys, bad data
  - serialize_pipeline_output: roundtrip, exclude_none, strict write guard
  - schema_version stamping
  - pending field alias handling
  - typed sub-model validation (banner, diff_result, review_findings)
"""

import logging
import pytest

from app.pipeline_output_schema import (
    CURRENT_SCHEMA_VERSION,
    PipelineOutput,
    PipelineOutputParseError,
    StoredBannerData,
    TruncationWarning,
    parse_pipeline_output,
    serialize_pipeline_output,
)


# ─────────────────────────────────────────────
# parse_pipeline_output
# ─────────────────────────────────────────────

class TestParseEmptyInput:
    def test_none_returns_default(self):
        po = parse_pipeline_output(None)
        assert isinstance(po, PipelineOutput)
        assert po.diff_result is None
        assert po.review_findings == []
        assert po.schema_version == CURRENT_SCHEMA_VERSION

    def test_empty_dict_returns_default(self):
        po = parse_pipeline_output({})
        assert po.risk_score is None
        assert po.banner is None
        assert po.review_findings == []


class TestParseValidData:
    def test_basic_review_fields(self):
        raw = {
            "risk_score": 75.0,
            "risk_level": "High",
            "pipeline_output_quality": "complete",
            "review_findings": [
                {
                    "finding_id": "f-1",
                    "severity": "critical",
                    "category": "Compliance",
                    "title": "Missing clause",
                    "description": "No indemnity clause found.",
                }
            ],
            "quick_insights": [
                {"label": "Contract Value", "value": "Rp 500,000,000", "icon": "payments"}
            ],
            "banner": {
                "critical_count": 1,
                "warning_count": 2,
                "info_count": 0,
                "total_count": 3,
            },
        }
        po = parse_pipeline_output(raw)
        assert po.risk_score == 75.0
        assert po.risk_level == "High"
        assert len(po.review_findings) == 1
        assert po.review_findings[0].finding_id == "f-1"
        assert po.review_findings[0].severity == "critical"
        assert len(po.quick_insights) == 1
        assert po.quick_insights[0].label == "Contract Value"
        assert po.banner is not None
        assert po.banner.critical_count == 1

    def test_banner_with_system_warning_count(self):
        """The review aggregator injects system_warning_count — our schema must accept it."""
        raw = {
            "banner": {
                "critical_count": 0,
                "warning_count": 1,
                "info_count": 0,
                "total_count": 1,
                "system_warning_count": 1,
            }
        }
        po = parse_pipeline_output(raw)
        assert po.banner is not None
        assert po.banner.system_warning_count == 1

    def test_diff_result_typed(self):
        """diff_result should parse into SmartDiffResult, not remain a raw dict."""
        raw = {
            "diff_result": {
                "deviations": [
                    {
                        "deviation_id": "d-1",
                        "title": "Liability cap removed",
                        "category": "Removed",
                        "severity": "critical",
                        "v1_text": "Liability shall not exceed...",
                        "v2_text": "",
                        "impact_analysis": "Major risk exposure.",
                    }
                ],
                "batna_fallbacks": [],
                "risk_delta": 25.0,
                "summary": "Significant risk increase in V2.",
            }
        }
        po = parse_pipeline_output(raw)
        assert po.diff_result is not None
        assert len(po.diff_result.deviations) == 1
        assert po.diff_result.deviations[0].deviation_id == "d-1"
        assert po.diff_result.risk_delta == 25.0

    def test_contract_metadata_fields(self):
        raw = {
            "contract_value": 1_000_000.0,
            "currency": "IDR",
            "end_date": "2026-12-31",
            "effective_date": "2026-01-01",
            "jurisdiction": "Jakarta",
            "governing_law": "Indonesian Law",
            "counter_proposal": "Negotiate liability cap.",
        }
        po = parse_pipeline_output(raw)
        assert po.contract_value == 1_000_000.0
        assert po.currency == "IDR"
        assert po.jurisdiction == "Jakarta"

    def test_truncation_warning(self):
        raw = {
            "truncation_warning": {
                "original_tokens": 150_000,
                "truncated_to": 80_000,
                "chars_removed": 50_000,
                "strategy": "tail_preserve",
                "message": "Document was truncated.",
            }
        }
        po = parse_pipeline_output(raw)
        assert po.truncation_warning is not None
        assert po.truncation_warning.original_tokens == 150_000
        assert po.truncation_warning.strategy == "tail_preserve"


class TestParsePendingFields:
    def test_pending_alias_parse(self):
        """_pending_* JSON keys should map to clean Python field names."""
        raw = {
            "_pending": True,
            "_pending_file_path": "/uploads/contract.pdf",
            "_pending_file_type": "application/pdf",
            "_pending_file_size": 102400,
            "_pending_matter_id": "matter-123",
        }
        po = parse_pipeline_output(raw)
        assert po.pending is True
        assert po.pending_file_path == "/uploads/contract.pdf"
        assert po.pending_file_type == "application/pdf"
        assert po.pending_file_size == 102400
        assert po.pending_matter_id == "matter-123"


class TestParseUnknownKeys:
    def test_unknown_keys_logged(self, caplog):
        with caplog.at_level(logging.WARNING):
            po = parse_pipeline_output({
                "risk_score": 50.0,
                "some_future_key": True,
                "another_mystery": [1, 2, 3],
            })
        assert po.risk_score == 50.0
        assert "pipeline_output_unknown_keys" in caplog.text
        assert "some_future_key" in caplog.text

    def test_unknown_keys_still_parsed(self, caplog):
        """Unknown keys should not crash parsing — allow on read."""
        with caplog.at_level(logging.WARNING):
            po = parse_pipeline_output({"unknown_key": {"nested": True}})
        assert isinstance(po, PipelineOutput)


class TestParseFailure:
    def test_invalid_review_finding_raises(self):
        """Completely malformed data should raise PipelineOutputParseError."""
        raw = {
            "review_findings": [
                {
                    # Missing required fields: severity, category, title, description
                    "finding_id": "bad",
                }
            ]
        }
        with pytest.raises(PipelineOutputParseError) as exc_info:
            parse_pipeline_output(raw)
        assert exc_info.value.raw is raw
        assert exc_info.value.cause is not None


# ─────────────────────────────────────────────
# serialize_pipeline_output
# ─────────────────────────────────────────────

class TestSerialize:
    def test_empty_model_minimal(self):
        po = PipelineOutput()
        data = serialize_pipeline_output(po)
        assert data["schema_version"] == CURRENT_SCHEMA_VERSION
        # None fields should be excluded
        assert "risk_score" not in data
        assert "diff_result" not in data
        assert "_pending" not in data

    def test_schema_version_always_stamped(self):
        po = PipelineOutput(risk_score=10.0)
        data = serialize_pipeline_output(po)
        assert data["schema_version"] == CURRENT_SCHEMA_VERSION

    def test_pending_serialized_with_aliases(self):
        po = PipelineOutput(
            pending=True,
            pending_file_path="/path/to/file.pdf",
        )
        data = serialize_pipeline_output(po)
        # Must use the JSON alias names, not the Python field names
        assert data["_pending"] is True
        assert data["_pending_file_path"] == "/path/to/file.pdf"
        # Python field names should NOT appear
        assert "pending" not in data
        assert "pending_file_path" not in data

    def test_strict_write_rejects_extra_keys(self, caplog):
        """Extra fields set via model's extra='allow' should be stripped on write."""
        po = parse_pipeline_output({"risk_score": 50.0, "rogue_key": True})
        with caplog.at_level(logging.ERROR):
            data = serialize_pipeline_output(po)
        assert "rogue_key" not in data
        assert "pipeline_output_write_rejected" in caplog.text

    def test_excludes_none_values(self):
        po = PipelineOutput(risk_score=None, diff_result=None)
        data = serialize_pipeline_output(po)
        assert "risk_score" not in data
        assert "diff_result" not in data


class TestRoundtrip:
    def test_full_roundtrip(self):
        original = {
            "schema_version": 1,
            "risk_score": 75.0,
            "risk_level": "High",
            "pipeline_output_quality": "complete",
            "review_findings": [
                {
                    "finding_id": "f-1",
                    "severity": "warning",
                    "category": "Risk",
                    "title": "High exposure",
                    "description": "Contract value exceeds threshold.",
                }
            ],
            "quick_insights": [
                {"label": "Risk", "value": "High (75/100)", "icon": "shield"}
            ],
            "banner": {
                "critical_count": 0,
                "warning_count": 1,
                "info_count": 0,
                "total_count": 1,
            },
            "diff_result": {
                "deviations": [],
                "batna_fallbacks": [],
                "risk_delta": 0.0,
                "summary": "No changes.",
            },
        }
        po = parse_pipeline_output(original)
        serialized = serialize_pipeline_output(po)

        assert serialized["risk_score"] == 75.0
        assert serialized["risk_level"] == "High"
        assert len(serialized["review_findings"]) == 1
        assert serialized["review_findings"][0]["finding_id"] == "f-1"
        assert serialized["diff_result"]["risk_delta"] == 0.0
        assert serialized["banner"]["warning_count"] == 1
        assert serialized["schema_version"] == CURRENT_SCHEMA_VERSION

    def test_pending_roundtrip(self):
        original = {
            "_pending": True,
            "_pending_file_path": "/uploads/v2.pdf",
            "_pending_file_type": "application/pdf",
            "_pending_file_size": 51200,
            "_pending_matter_id": "m-abc",
        }
        po = parse_pipeline_output(original)
        serialized = serialize_pipeline_output(po)

        assert serialized["_pending"] is True
        assert serialized["_pending_file_path"] == "/uploads/v2.pdf"
        assert serialized["_pending_file_size"] == 51200
