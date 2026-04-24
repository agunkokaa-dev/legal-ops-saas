"""
Canonical UU PDP seed ingestion.

This script seeds the global law corpus with curated official excerpts from
UU No. 27 Tahun 2022. Seeded content is never marked as human-verified.
"""

from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "app" / ".env")

from app.laws.repository import LawCorpusRepository  # noqa: E402
from app.laws.utils import normalize_identifier, stable_uuid, utcnow  # noqa: E402

DATA_FILE = ROOT / "data" / "laws" / "uu_pdp_27_2022.json"

INITIAL_COVERAGE = [
    {
        "category": "data_protection",
        "category_label_id": "Perlindungan Data Pribadi",
        "category_label_en": "Data Protection",
        "total_planned_laws": 3,
        "ingested_laws": 1,
        "verified_laws": 0,
        "coverage_level": "in_progress",
        "coverage_notes": "UU PDP curated official provisions ingested. Human legal verification and sectoral regulations remain pending.",
    },
    {
        "category": "labor",
        "category_label_id": "Ketenagakerjaan",
        "category_label_en": "Labor",
        "total_planned_laws": 2,
        "ingested_laws": 0,
        "verified_laws": 0,
        "coverage_level": "not_started",
        "coverage_notes": "Not yet ingested.",
    },
    {
        "category": "financial_services",
        "category_label_id": "Jasa Keuangan",
        "category_label_en": "Financial Services",
        "total_planned_laws": 5,
        "ingested_laws": 0,
        "verified_laws": 0,
        "coverage_level": "not_started",
        "coverage_notes": "Not yet ingested.",
    },
    {
        "category": "language",
        "category_label_id": "Bahasa dalam Perjanjian",
        "category_label_en": "Language Requirements",
        "total_planned_laws": 1,
        "ingested_laws": 0,
        "verified_laws": 0,
        "coverage_level": "not_started",
        "coverage_notes": "Not yet ingested.",
    },
    {
        "category": "general_business",
        "category_label_id": "Korporasi Umum",
        "category_label_en": "General Business",
        "total_planned_laws": 2,
        "ingested_laws": 0,
        "verified_laws": 0,
        "coverage_level": "not_started",
        "coverage_notes": "Not yet ingested.",
    },
]


def _repo() -> LawCorpusRepository:
    # CROSS-TENANT: canonical law-corpus seeding writes global system-owned data, not tenant-owned business rows.
    from app.config import LAW_QDRANT_ACTIVE_ALIAS, LAW_QDRANT_V2_COLLECTION, NATIONAL_LAWS_COLLECTION, admin_supabase, qdrant

    return LawCorpusRepository(
        supabase=admin_supabase,
        qdrant=qdrant,
        active_collection=LAW_QDRANT_ACTIVE_ALIAS,
        v2_collection=LAW_QDRANT_V2_COLLECTION,
        legacy_collection=NATIONAL_LAWS_COLLECTION,
    )


def _load_payload() -> dict[str, Any]:
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _law_id(law: dict[str, Any]) -> str:
    return stable_uuid("law", law["law_type"], law["number"], law["year"])


def _version_id(law_id: str, version_number: int) -> str:
    return stable_uuid("law-version", law_id, version_number)


def _coverage_id(category: str) -> str:
    return stable_uuid("coverage", category)


def _node_id(version_id: str, path_tokens: list[str]) -> str:
    return stable_uuid("structural-node", version_id, *path_tokens)


def _build_nodes(
    *,
    law_version_id: str,
    version_effective_from: str,
    version_effective_to: str | None,
    nodes: list[dict[str, Any]],
    parent_id: str | None = None,
    path_tokens: list[str] | None = None,
) -> list[dict[str, Any]]:
    built: list[dict[str, Any]] = []
    path_tokens = list(path_tokens or [])
    now = utcnow().isoformat()
    for item in nodes:
        identifier = item["identifier"]
        normalized = normalize_identifier(identifier)
        current_path = [*path_tokens, normalized]
        node_id = _node_id(law_version_id, current_path)
        payload = {
            "id": node_id,
            "law_version_id": law_version_id,
            "node_type": item["type"],
            "parent_id": parent_id,
            "identifier": identifier,
            "identifier_normalized": normalized,
            "sequence_order": item["sequence"],
            "heading": item.get("heading"),
            "body": item.get("body"),
            "body_en": item.get("body_en"),
            "legal_status": item.get("legal_status", "berlaku"),
            "legal_status_notes": item.get("legal_status_notes"),
            "legal_status_source_url": item.get("legal_status_source_url"),
            "effective_from": item.get("effective_from", version_effective_from),
            "effective_to": item.get("effective_to", version_effective_to),
            "topic_tags": item.get("topic_tags", []),
            "contract_relevance": item.get("contract_relevance"),
            "contract_types": item.get("contract_types", []),
            "compliance_trigger": item.get("compliance_trigger"),
            "source_document_position": item.get("source_document_position"),
            "extraction_method": item.get("extraction_method", "manual"),
            "extraction_confidence": item.get("extraction_confidence", 1.0),
            "seeded_at": now,
            "seeded_by": "system_seed",
            "verification_status": "unreviewed",
            "human_verified_by": None,
            "human_verified_at": None,
            "verification_notes": None,
            "updated_at": now,
        }
        built.append(payload)
        child_nodes = item.get("children") or []
        if child_nodes:
            built.extend(
                _build_nodes(
                    law_version_id=law_version_id,
                    version_effective_from=version_effective_from,
                    version_effective_to=version_effective_to,
                    nodes=child_nodes,
                    parent_id=node_id,
                    path_tokens=current_path,
                )
            )
    return built


def seed_initial_coverage(repo: LawCorpusRepository) -> None:
    rows = []
    for record in INITIAL_COVERAGE:
        payload = deepcopy(record)
        payload["id"] = _coverage_id(record["category"])
        rows.append(payload)
    repo.upsert_rows("corpus_coverage", rows)


def ingest() -> dict[str, Any]:
    repo = _repo()
    payload = _load_payload()

    law = payload["law"]
    version = payload["version"]

    law_id = _law_id(law)
    law_row = {
        "id": law_id,
        **law,
        "updated_at": utcnow().isoformat(),
    }
    repo.upsert_rows("laws", law_row)

    law_version_id = _version_id(law_id, int(version["version_number"]))
    version_row = {
        "id": law_version_id,
        "law_id": law_id,
        **version,
    }
    repo.upsert_rows("law_versions", version_row)

    node_rows = _build_nodes(
        law_version_id=law_version_id,
        version_effective_from=version["effective_from"],
        version_effective_to=version.get("effective_to"),
        nodes=payload["structure"],
    )
    repo.upsert_rows("structural_nodes", node_rows)
    seed_initial_coverage(repo)

    return {
        "law_id": law_id,
        "law_version_id": law_version_id,
        "node_count": len(node_rows),
    }


if __name__ == "__main__":
    result = ingest()
    print(json.dumps(result, indent=2))
