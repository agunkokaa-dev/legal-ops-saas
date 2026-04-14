import importlib.util
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEPENDENCIES_PATH = ROOT / "app" / "dependencies.py"


class FakeQueryBuilder:
    def __init__(self, table_name: str):
        self.table_name = table_name
        self.operation = None
        self.args = ()
        self.kwargs = {}
        self.payload = None
        self.filters: list[tuple[str, object]] = []

    def select(self, *args, **kwargs):
        self.operation = "select"
        self.args = args
        self.kwargs = kwargs
        return self

    def insert(self, payload, *args, **kwargs):
        self.operation = "insert"
        self.payload = payload
        self.args = args
        self.kwargs = kwargs
        return self

    def update(self, payload, *args, **kwargs):
        self.operation = "update"
        self.payload = payload
        self.args = args
        self.kwargs = kwargs
        return self

    def upsert(self, payload, *args, **kwargs):
        self.operation = "upsert"
        self.payload = payload
        self.args = args
        self.kwargs = kwargs
        return self

    def delete(self, *args, **kwargs):
        self.operation = "delete"
        self.args = args
        self.kwargs = kwargs
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def execute(self):
        return types.SimpleNamespace(data=[])


class FakeSupabaseClient:
    def __init__(self):
        self.builders: list[FakeQueryBuilder] = []
        self.rpc_calls: list[tuple[str, dict]] = []

    def table(self, table_name: str):
        builder = FakeQueryBuilder(table_name)
        self.builders.append(builder)
        return builder

    def rpc(self, function_name: str, params: dict, *args, **kwargs):
        self.rpc_calls.append((function_name, params))
        return types.SimpleNamespace(data={"function_name": function_name, "params": params})


def _install_dependency_stubs():
    fake_fastapi = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    def Depends(value):
        return value

    def Header(default=None):
        return default

    class Request:
        def __init__(self):
            self.state = types.SimpleNamespace()

    fake_fastapi.Depends = Depends
    fake_fastapi.Header = Header
    fake_fastapi.HTTPException = HTTPException
    fake_fastapi.Request = Request

    fake_supabase = types.ModuleType("supabase")
    fake_supabase.Client = FakeSupabaseClient
    fake_supabase.create_client = lambda *args, **kwargs: FakeSupabaseClient()

    fake_client_options_mod = types.ModuleType("supabase.lib.client_options")

    class ClientOptions:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    fake_client_options_mod.ClientOptions = ClientOptions

    fake_qdrant_models = types.ModuleType("qdrant_client.http.models")

    class FakePointStruct:
        def __init__(self, id=None, vector=None, payload=None):
            self.id = id
            self.vector = vector
            self.payload = payload or {}

    class FakeFieldCondition:
        def __init__(self, key=None, match=None):
            self.key = key
            self.match = match

    class FakeMatchValue:
        def __init__(self, value=None):
            self.value = value

    class FakeFilter:
        def __init__(self, must=None, should=None, must_not=None):
            self.must = must or []
            self.should = should
            self.must_not = must_not

    fake_qdrant_models.FieldCondition = FakeFieldCondition
    fake_qdrant_models.Filter = FakeFilter
    fake_qdrant_models.MatchValue = FakeMatchValue
    fake_qdrant_models.PointStruct = FakePointStruct

    fake_qdrant_http = types.ModuleType("qdrant_client.http")
    fake_qdrant_http.models = types.SimpleNamespace(FilterSelector=object)

    fake_config = types.ModuleType("app.config")
    fake_config.CLERK_PEM_KEY = "fake-pem"
    fake_config.SUPABASE_URL = "https://example.supabase.co"
    fake_config.SUPABASE_ANON_KEY = "anon-key"
    fake_config.admin_supabase = FakeSupabaseClient()
    fake_config.qdrant = types.SimpleNamespace()

    sys.modules["fastapi"] = fake_fastapi
    sys.modules["supabase"] = fake_supabase
    sys.modules["supabase.lib.client_options"] = fake_client_options_mod
    sys.modules["qdrant_client.http.models"] = fake_qdrant_models
    sys.modules["qdrant_client.http"] = fake_qdrant_http
    sys.modules["app.config"] = fake_config


def _load_dependencies_module():
    _install_dependency_stubs()
    spec = importlib.util.spec_from_file_location("deps_tenant_supabase_under_test", DEPENDENCIES_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class TenantSupabaseTests(unittest.TestCase):
    def setUp(self):
        self.deps = _load_dependencies_module()
        self.raw = FakeSupabaseClient()
        self.wrapper = self.deps.TenantSupabaseClient(self.raw, "tenant_A")

    def test_select_auto_injects_tenant_filter(self):
        query = self.wrapper.table("contracts").select("*").eq("id", "contract_1")

        self.assertEqual(query.operation, "select")
        self.assertEqual(query.filters[0], ("tenant_id", "tenant_A"))
        self.assertIn(("id", "contract_1"), query.filters)

    def test_insert_validates_tenant_id_match(self):
        with self.assertRaisesRegex(ValueError, "Tenant ID mismatch: expected 'tenant_A', got 'tenant_B'"):
            self.wrapper.table("contracts").insert({"tenant_id": "tenant_B", "id": "contract_1"})

    def test_insert_auto_injects_tenant_id(self):
        query = self.wrapper.table("contract_obligations").insert({"contract_id": "contract_1"})

        self.assertEqual(query.operation, "insert")
        self.assertEqual(query.payload["tenant_id"], "tenant_A")
        self.assertEqual(query.payload["contract_id"], "contract_1")

    def test_update_auto_injects_tenant_filter(self):
        query = self.wrapper.table("contracts").update({"status": "Reviewed"}).eq("id", "contract_1")

        self.assertEqual(query.operation, "update")
        self.assertEqual(query.payload, {"status": "Reviewed"})
        self.assertEqual(query.filters[0], ("tenant_id", "tenant_A"))
        self.assertIn(("id", "contract_1"), query.filters)

    def test_delete_auto_injects_tenant_filter(self):
        query = self.wrapper.table("contracts").delete().eq("id", "contract_1")

        self.assertEqual(query.operation, "delete")
        self.assertEqual(query.filters[0], ("tenant_id", "tenant_A"))
        self.assertIn(("id", "contract_1"), query.filters)

    def test_raw_access_logs_warning(self):
        with self.assertLogs("pariana.dependencies", level="WARNING") as log_context:
            returned = self.wrapper.raw

        self.assertIs(returned, self.raw)
        self.assertTrue(
            any("TenantSupabaseClient.raw accessed" in entry for entry in log_context.output)
        )

    def test_upsert_validates_rows(self):
        with self.assertRaisesRegex(ValueError, "Tenant ID mismatch: expected 'tenant_A', got 'tenant_B'"):
            self.wrapper.table("negotiation_rounds").upsert(
                [{"tenant_id": "tenant_A", "round_number": 1}, {"tenant_id": "tenant_B", "round_number": 2}],
                on_conflict="contract_id,round_number",
            )

    def test_rpc_injects_tenant_id(self):
        self.wrapper.rpc("refresh_contract_metrics", {"contract_id": "contract_1"})

        self.assertEqual(
            self.raw.rpc_calls,
            [("refresh_contract_metrics", {"contract_id": "contract_1", "tenant_id": "tenant_A"})],
        )


if __name__ == "__main__":
    unittest.main()
