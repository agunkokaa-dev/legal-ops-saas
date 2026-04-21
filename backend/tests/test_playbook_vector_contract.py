from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAYBOOK_PATH = ROOT / "app" / "routers" / "playbook.py"
NEGOTIATION_PATH = ROOT / "app" / "routers" / "negotiation.py"
CHAT_PATH = ROOT / "app" / "routers" / "chat.py"
SCHEMAS_PATH = ROOT / "app" / "schemas.py"


def _read(path: Path) -> str:
    return path.read_text()


def test_playbook_vector_payload_uses_tenant_id_only():
    source = _read(PLAYBOOK_PATH)

    assert '"tenant_id": tenant_id' in source
    assert '"user_id": tenant_id' not in source
    assert "get_tenant_qdrant" in source
    assert "TenantQdrantClient" in source


def test_playbook_vectorize_request_no_longer_requires_user_id():
    source = _read(SCHEMAS_PATH)
    start = source.index("class PlaybookVectorizeRequest")
    end = source.index("class ExtractObligationsRequest")
    schema_block = source[start:end]

    assert "user_id:" not in schema_block


def test_negotiation_playbook_scroll_relies_on_tenant_wrapper():
    source = _read(NEGOTIATION_PATH)
    start = source.index("def fetch_rules():")
    end = source.index("prior_rounds_context = None", start)
    snippet = source[start:end]

    assert '"company_rules"' in snippet
    assert "qdrant.scroll(" in snippet
    assert "scroll_filter=Filter" in snippet
    assert 'FieldCondition(key="tenant_id"' in snippet


def test_chat_clause_assistant_uses_contextual_retrieval_tools():
    source = _read(CHAT_PATH)

    assert "CLAUSE_ASSISTANT_TOOLS" in source
    assert '"name": "search_playbook_rules"' in source
    assert '"name": "search_national_laws"' in source
    assert '"name": "get_graph_dependencies"' in source
    assert "law_service.search_playbook_rules(" in source
    assert "LawSearchRequest(" in source
    assert "build_law_retrieval_service" in source
    assert "user_id" not in source

    fallback_start = source.index("# ── Strategy 3: Qdrant vector chunk reconstruction (lossy fallback) ──")
    fallback_end = source.index("# =====================================================================", fallback_start)
    fallback_snippet = source[fallback_start:fallback_end]
    assert 'FieldCondition(key="tenant_id"' not in fallback_snippet
