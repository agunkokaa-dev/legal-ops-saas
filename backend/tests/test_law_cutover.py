from __future__ import annotations

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.sync_canonical_to_qdrant import LAW_PAYLOAD_SCHEMA_VERSION, build_payload, promote_alias, rollback_alias


def test_build_v2_payload_has_schema_version_and_no_legacy_verification_flag():
    payload = build_payload(
        {
            "id": "node-1",
            "identifier": "Pasal 56",
            "body": "Transfer Data Pribadi...",
            "legal_status": "berlaku",
            "effective_from": "2022-10-17",
            "effective_to": None,
            "contract_relevance": "high",
            "contract_types": ["saas"],
            "topic_tags": ["cross_border_transfer"],
            "extraction_method": "manual",
            "verification_status": "unreviewed",
            "human_verified_at": None,
        },
        {"id": "law-1", "short_name": "UU PDP", "law_type": "UU", "category": "data_protection"},
        {"id": "version-1", "effective_from": "2022-10-17", "effective_to": None},
        [{"id": "node-1", "node_type": "pasal", "identifier": "Pasal 56"}],
    )

    assert payload["schema_version"] == LAW_PAYLOAD_SCHEMA_VERSION
    assert payload["verification_status"] == "unreviewed"
    assert "is_verified" not in payload
    assert "verified_by" not in payload


def test_alias_promote_requires_clean_parity(monkeypatch):
    monkeypatch.setattr("scripts.sync_canonical_to_qdrant.collect_parity", lambda target_collection: {"parity_ok": False})

    with pytest.raises(SystemExit):
        promote_alias("id_national_laws_v2", alias_name="id_national_laws_active")


def test_rollback_alias_restores_requested_collection(monkeypatch):
    captured = {}

    def fake_http_request(method, path, payload=None):
        captured["method"] = method
        captured["path"] = path
        captured["payload"] = payload
        return {"status": "ok"}

    monkeypatch.setattr("scripts.sync_canonical_to_qdrant._qdrant_http_request", fake_http_request)
    result = rollback_alias("id_national_laws", alias_name="id_national_laws_active")

    assert result == {"status": "ok"}
    actions = captured["payload"]["actions"]
    assert actions[1]["create_alias"]["collection_name"] == "id_national_laws"
