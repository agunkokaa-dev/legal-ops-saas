from __future__ import annotations

from datetime import date
from pathlib import Path
from types import SimpleNamespace
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.laws.schemas import LawSearchContext, LawSearchFilter, LawSearchRequest
from app.laws.service import LawRetrievalService


class DummyOpenAI:
    class embeddings:
        @staticmethod
        def create(*, input: str, model: str):
            return SimpleNamespace(data=[SimpleNamespace(embedding=[0.1, 0.2, 0.3])])


class FakeQdrant:
    def __init__(self, points):
        self._points = points

    def query_points(self, **kwargs):
        return SimpleNamespace(points=self._points)


class FakeRepo:
    def __init__(
        self,
        *,
        node_legal_status: str = "berlaku",
        effective_to: str | None = None,
        verification_status: str = "unreviewed",
        include_graph_reference: bool = False,
    ):
        self.law = {
            "id": "law-1",
            "short_name": "UU PDP",
            "full_name": "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi",
            "category": "data_protection",
            "law_type": "UU",
            "legal_status": node_legal_status,
            "official_source_url": "https://example.com",
        }
        self.version = {
            "id": "version-1",
            "law_id": "law-1",
            "version_number": 1,
            "effective_from": "2022-10-17",
            "effective_to": effective_to,
        }
        self.node = {
            "id": "node-1",
            "law_version_id": "version-1",
            "node_type": "pasal",
            "identifier": "Pasal 56",
            "identifier_normalized": "pasal_56",
            "body": "Transfer Data Pribadi ke luar wilayah hukum Republik Indonesia.",
            "legal_status": node_legal_status,
            "legal_status_notes": "Watch the status note.",
            "legal_status_source_url": "https://example.com/status",
            "effective_from": "2022-10-17",
            "effective_to": effective_to,
            "verification_status": verification_status,
            "human_verified_at": None,
            "contract_relevance": "high",
            "contract_types": ["saas"],
            "topic_tags": ["cross_border_transfer"],
            "parent_id": None,
        }
        self.graph_node = {
            "id": "node-graph",
            "law_version_id": "version-1",
            "node_type": "pasal",
            "identifier": "Pasal 57",
            "identifier_normalized": "pasal_57",
            "body": "Pengendali Data Pribadi wajib memastikan perlindungan setara.",
            "legal_status": node_legal_status,
            "legal_status_notes": None,
            "legal_status_source_url": None,
            "effective_from": "2022-10-17",
            "effective_to": effective_to,
            "verification_status": verification_status,
            "human_verified_at": None,
            "contract_relevance": "high",
            "contract_types": ["saas"],
            "topic_tags": ["cross_border_transfer"],
            "parent_id": None,
        }
        self.active_collection = "id_national_laws_active"
        self.qdrant = FakeQdrant(
            [
                SimpleNamespace(
                    score=0.83,
                    payload={
                        "schema_version": 2,
                        "structural_node_id": "node-1",
                    },
                )
            ]
        )
        self.references = [
            {
                "id": "ref-1",
                "source_node_id": "node-1",
                "target_node_id": "node-graph",
                "target_law_short": "UU PDP",
                "target_identifier": "Pasal 57",
                "reference_context": "Pasal 56 merujuk kewajiban perlindungan transfer lintas batas.",
                "reference_type": "direct",
            }
        ] if include_graph_reference else []

    def list_laws_catalog(self):
        return [self.law]

    def list_coverage(self):
        return [
            {
                "category": "data_protection",
                "coverage_level": "in_progress",
                "category_label_en": "Data Protection",
            }
        ]

    def get_law_by_reference(self, **kwargs):
        return [self.law]

    def get_version_as_of(self, law_id, effective_as_of):
        return self.version

    def find_pasal_node(self, **kwargs):
        return self.node

    def find_node_in_version(self, **kwargs):
        return self.node

    def get_version(self, version_id):
        return self.version

    def get_law(self, law_id):
        return self.law

    def get_parent_chain(self, node):
        return []

    def get_nodes_by_ids(self, node_ids):
        rows = []
        if "node-1" in node_ids:
            rows.append(self.node)
        if "node-graph" in node_ids:
            rows.append(self.graph_node)
        return rows

    def get_node(self, node_id):
        if node_id == "node-1":
            return self.node
        if node_id == "node-graph":
            return self.graph_node
        return None

    def get_article_siblings(self, node):
        return []

    def get_pasal_references_for_source_nodes(self, source_node_ids):
        if "node-1" in source_node_ids:
            return self.references
        return []


@pytest.mark.asyncio
async def test_exact_lookup_includes_partial_revocation_with_warning():
    repo = FakeRepo(node_legal_status="sebagian_dicabut")
    service = LawRetrievalService(repository=repo, openai_client=DummyOpenAI(), anthropic_client_factory=None)

    response = await service.citation_lookup("UU PDP Pasal 56", effective_as_of=date(2026, 4, 18))

    assert response["resolution_status"] == "resolved"
    assert response["results"][0]["legal_status"] == "sebagian_dicabut"
    assert response["results"][0]["warning_note"]


@pytest.mark.asyncio
async def test_historical_exact_lookup_returns_pre_revocation_version():
    repo = FakeRepo(node_legal_status="dicabut", effective_to="2025-01-01")
    service = LawRetrievalService(repository=repo, openai_client=DummyOpenAI(), anthropic_client_factory=None)

    historical = await service.citation_lookup("UU PDP Pasal 56", effective_as_of=date(2024, 12, 31))
    current = await service.citation_lookup("UU PDP Pasal 56", effective_as_of=date(2026, 4, 18))

    assert historical["resolution_status"] == "resolved"
    assert current["resolution_status"] == "not_currently_citable"


@pytest.mark.asyncio
async def test_search_response_never_marks_seeded_content_verified():
    repo = FakeRepo(verification_status="unreviewed")
    service = LawRetrievalService(repository=repo, openai_client=DummyOpenAI(), anthropic_client_factory=None)

    response = await service.search(
        LawSearchRequest(
            query="perlindungan data pribadi transfer luar negeri",
            filters=LawSearchFilter(category="data_protection"),
            effective_as_of=date(2026, 4, 18),
            limit=5,
        )
    )

    assert response.results
    assert response.results[0].verification_status == "unreviewed"
    assert response.results[0].human_verified_at is None


@pytest.mark.asyncio
async def test_unknown_law_short_filter_value_is_rejected():
    repo = FakeRepo()
    service = LawRetrievalService(repository=repo, openai_client=DummyOpenAI(), anthropic_client_factory=None)

    with pytest.raises(ValueError):
        await service.search(
            LawSearchRequest(
                query="perlindungan data",
                filters=LawSearchFilter(law_short="UU UNKNOWN"),
            )
        )


@pytest.mark.asyncio
async def test_query_expansion_falls_back_without_structured_parser():
    repo = FakeRepo()
    service = LawRetrievalService(repository=repo, openai_client=DummyOpenAI(), anthropic_client_factory=None)

    expanded = await service.expand_query(
        "privacy transfer obligation",
        context=LawSearchContext(
            source_type="war_room_deviation",
            playbook_violation="Cross-border transfer requires equivalent safeguards.",
        ),
    )

    assert expanded.normalized_query == "privacy transfer obligation"
    assert expanded.category_hint == "data_protection"
    assert expanded.playbook_terms == ["Cross-border transfer requires equivalent safeguards."]


@pytest.mark.asyncio
async def test_search_promotes_graph_reference_over_semantic_seed():
    repo = FakeRepo(include_graph_reference=True)
    service = LawRetrievalService(repository=repo, openai_client=DummyOpenAI(), anthropic_client_factory=None)

    response = await service.search(
        LawSearchRequest(
            query="privacy transfer safeguards",
            filters=LawSearchFilter(category="data_protection"),
            effective_as_of=date(2026, 4, 18),
            limit=5,
        )
    )

    assert response.results
    assert response.results[0].node_id == "node-graph"
    assert response.results[0].retrieval_path == "graph"
    assert response.results[0].reference_type == "direct"
