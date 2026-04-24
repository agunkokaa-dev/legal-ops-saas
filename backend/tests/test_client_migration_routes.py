from pathlib import Path


BASE = Path(__file__).resolve().parent.parent / "app"

TASKS_PATH = BASE / "routers" / "tasks.py"
TEMPLATES_PATH = BASE / "routers" / "templates.py"
CONTRACTS_PATH = BASE / "routers" / "contracts.py"
PLAYBOOK_PATH = BASE / "routers" / "playbook.py"
SCHEMAS_PATH = BASE / "schemas.py"


def _read(path: Path) -> str:
    return path.read_text()


def test_tasks_router_exposes_task_prefixed_crud_routes():
    source = _read(TASKS_PATH)

    assert '@router.get("/tasks")' in source
    assert '@router.post("/tasks")' in source
    assert '@router.get("/tasks/{task_id}")' in source
    assert '@router.patch("/tasks/{task_id}")' in source
    assert '@router.delete("/tasks/{task_id}")' in source
    assert '@router.patch("/tasks/sub-tasks/{sub_task_id}")' in source
    assert '@router.delete("/tasks/attachments/{attachment_id}")' in source


def test_tasks_router_supports_legacy_personal_task_compatibility():
    source = _read(TASKS_PATH)

    assert "def _get_allowed_task_tenant_ids" in source
    assert '.in_("tenant_id", allowed_tenant_ids)' in source
    assert "def get_cross_tenant_tasks_admin_client" in source
    assert "Depends(get_cross_tenant_tasks_admin_client)" in source


def test_templates_router_supports_list_and_delete():
    source = _read(TEMPLATES_PATH)

    assert '@router.get("/templates")' in source
    assert '@router.delete("/templates/{template_id}")' in source


def test_contracts_router_uses_canonical_contract_patch_route():
    source = _read(CONTRACTS_PATH)

    assert '@router.patch("/contracts/{contract_id}")' in source
    assert '@router.patch("/{contract_id}")' not in source


def test_playbook_rules_are_server_owned():
    source = _read(PLAYBOOK_PATH)

    assert '@router.get("/rules")' in source
    assert '@router.post("/rules")' in source
    assert '"user_id": tenant_id' not in source


def test_schema_contracts_drop_legacy_user_id_fields():
    source = _read(SCHEMAS_PATH)

    playbook_start = source.index("class PlaybookVectorizeRequest")
    extract_start = source.index("class ExtractObligationsRequest")
    extract_end = source.index("# --- SOP Template Engine Models ---")

    assert "user_id:" not in source[playbook_start:extract_start]
    assert "user_id:" not in source[extract_start:extract_end]
