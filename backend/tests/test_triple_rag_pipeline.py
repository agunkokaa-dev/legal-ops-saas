from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GRAPH_PATH = ROOT / "graph.py"
CONTRACTS_PATH = ROOT / "app" / "routers" / "contracts.py"
REVIEW_PATH = ROOT / "app" / "routers" / "review.py"


def _read(path: Path) -> str:
    return path.read_text()


def test_contract_state_and_graph_include_rag_prefetch_node():
    source = _read(GRAPH_PATH)

    assert "tenant_id: str" in source
    assert "playbook_rules: list[str]" in source
    assert "national_law_excerpts: list[str]" in source
    assert "def rag_prefetch_node" in source
    assert 'workflow.add_node("rag_prefetch", rag_prefetch_node)' in source
    assert 'workflow.add_edge("ingestion", "rag_prefetch")' in source
    assert 'workflow.add_edge("rag_prefetch", "compliance")' in source
    assert 'workflow.add_edge("ingestion", "compliance")' not in source


def test_rag_prefetch_is_qdrant_only_and_tenant_scoped_for_playbook():
    source = _read(GRAPH_PATH)
    start = source.index("# 2b. Triple RAG Prefetch Node")
    end = source.index("# 3. Agent 02", start)
    snippet = source[start:end]

    assert "client.embeddings.create" not in snippet
    assert "query_points" not in snippet
    assert 'collection_name="company_rules"' in snippet
    assert 'FieldCondition(key="tenant_id"' in snippet
    assert "LAW_QDRANT_ACTIVE_ALIAS" in snippet

    law_start = snippet.index("def _fetch_national_law_excerpts")
    law_snippet = snippet[law_start:]
    assert 'FieldCondition(key="tenant_id"' not in law_snippet


def test_compliance_and_risk_use_prefetched_context_without_law_embedding():
    source = _read(GRAPH_PATH)
    compliance_start = source.index("def compliance_agent")
    risk_start = source.index("def risk_agent")
    compliance_snippet = source[compliance_start:risk_start]
    risk_snippet = source[risk_start:source.index("# ==========================================", risk_start + 1)]

    assert "law_retrieval_embedding" not in compliance_snippet
    assert "client.embeddings.create" not in compliance_snippet
    assert 'state.get("playbook_rules", [])' in compliance_snippet
    assert 'state.get("national_law_excerpts", [])' in compliance_snippet
    assert "compliance_v2_triple_rag" in compliance_snippet

    assert 'state.get("playbook_rules", [])' in risk_snippet
    assert 'state.get("national_law_excerpts", [])' in risk_snippet
    assert "risk_v2_triple_rag" in risk_snippet


def test_graph_invocations_pass_tenant_and_empty_rag_defaults():
    contracts_source = _read(CONTRACTS_PATH)
    review_source = _read(REVIEW_PATH)

    assert '"tenant_id": tenant_id' in contracts_source
    assert '"playbook_rules": []' in contracts_source
    assert '"national_law_excerpts": []' in contracts_source
    assert '"total_agents": 7' in contracts_source

    assert '"tenant_id": tenant_id' in review_source
    assert '"playbook_rules": []' in review_source
    assert '"national_law_excerpts": []' in review_source
