from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PLAYBOOK_PATH = ROOT / "backend" / "app" / "routers" / "playbook.py"
NEGOTIATION_PATH = ROOT / "backend" / "app" / "routers" / "negotiation.py"
CHAT_PATH = ROOT / "backend" / "app" / "routers" / "chat.py"
SCHEMAS_PATH = ROOT / "backend" / "app" / "schemas.py"


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
    start = source.index("# 2. Fetch Playbook rules from Qdrant")
    end = source.index("# 3. Fetch prior rounds context")
    snippet = source[start:end]

    assert '"company_rules"' in snippet
    assert "async_qdrant_scroll(" in snippet
    assert "scroll_filter=" not in snippet
    assert 'claims.get("sub", "")' not in snippet


def test_chat_playbook_queries_do_not_add_legacy_user_filters():
    source = _read(CHAT_PATH)

    playbook_start = source.index('playbook_task = async_qdrant_search(')
    playbook_end = source.index("try:", playbook_start)
    playbook_snippet = source[playbook_start:playbook_end]
    assert '"company_rules"' in playbook_snippet
    assert "qdrant_client" in playbook_snippet
    assert "query_filter=None" in playbook_snippet
    assert "user_id" not in playbook_snippet

    fallback_start = source.index("# ── Strategy 3: Qdrant vector chunk reconstruction (lossy fallback) ──")
    fallback_end = source.index("# =====================================================================", fallback_start)
    fallback_snippet = source[fallback_start:fallback_end]
    assert 'FieldCondition(key="tenant_id"' not in fallback_snippet
