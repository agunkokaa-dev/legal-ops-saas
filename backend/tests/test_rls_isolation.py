import importlib.util
import os
import sys
import types
import unittest
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEPENDENCIES_PATH = ROOT / "backend" / "app" / "dependencies.py"
MIGRATION_PATH = ROOT / "backend" / "migrations" / "015_harden_clerk_rls.sql"
ZERO_TRUST_MIGRATION_PATH = ROOT / "backend" / "migrations" / "016_zero_trust_rls_lockdown.sql"


@dataclass
class FakeMatchValue:
    value: str


@dataclass
class FakeFieldCondition:
    key: str
    match: FakeMatchValue


@dataclass
class FakeFilter:
    must: list = field(default_factory=list)
    should: list | None = None
    must_not: list | None = None


@dataclass
class FakeFilterSelector:
    filter: FakeFilter


@dataclass
class FakePointStruct:
    id: str
    vector: list[float]
    payload: dict


class FakeSupabaseComponent:
    def __init__(self):
        self.auth_calls: list[str] = []

    def auth(self, token: str):
        self.auth_calls.append(token)


class FakeSupabaseClient:
    def __init__(self):
        self.postgrest = FakeSupabaseComponent()
        self.storage = FakeSupabaseComponent()
        self.options = types.SimpleNamespace(headers={})


class FakeRawQdrant:
    def __init__(self):
        self.last_query = None
        self.last_upsert = None

    def query_points(self, **kwargs):
        self.last_query = kwargs
        return types.SimpleNamespace(points=[])

    def search(self, **kwargs):
        return []

    def scroll(self, **kwargs):
        return ([], None)

    def upsert(self, **kwargs):
        self.last_upsert = kwargs
        return {"status": "ok"}

    def delete(self, **kwargs):
        return {"status": "ok"}


def install_dependency_stubs():
    raw_qdrant = FakeRawQdrant()
    create_client_calls: list[dict] = []

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

    def create_client(url, key, options=None):
        create_client_calls.append({"url": url, "key": key, "options": options})
        return FakeSupabaseClient()

    fake_supabase.create_client = create_client
    fake_supabase.Client = FakeSupabaseClient

    fake_client_options_mod = types.ModuleType("supabase.lib.client_options")

    class ClientOptions:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    fake_client_options_mod.ClientOptions = ClientOptions

    fake_qdrant_models = types.ModuleType("qdrant_client.http.models")
    fake_qdrant_models.FieldCondition = FakeFieldCondition
    fake_qdrant_models.Filter = FakeFilter
    fake_qdrant_models.MatchValue = FakeMatchValue
    fake_qdrant_models.PointStruct = FakePointStruct

    fake_qdrant_http = types.ModuleType("qdrant_client.http")
    fake_qdrant_http.models = types.SimpleNamespace(FilterSelector=FakeFilterSelector)

    fake_config = types.ModuleType("app.config")
    fake_config.CLERK_PEM_KEY = "fake-pem"
    fake_config.SUPABASE_URL = "https://example.supabase.co"
    fake_config.SUPABASE_ANON_KEY = "anon-key"
    fake_config.admin_supabase = FakeSupabaseClient()
    fake_config.qdrant = raw_qdrant

    sys.modules["fastapi"] = fake_fastapi
    sys.modules["supabase"] = fake_supabase
    sys.modules["supabase.lib.client_options"] = fake_client_options_mod
    sys.modules["qdrant_client.http.models"] = fake_qdrant_models
    sys.modules["qdrant_client.http"] = fake_qdrant_http
    sys.modules["app.config"] = fake_config

    return raw_qdrant, create_client_calls


def load_dependencies_module():
    raw_qdrant, create_client_calls = install_dependency_stubs()
    spec = importlib.util.spec_from_file_location("deps_under_test", DEPENDENCIES_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module, raw_qdrant, create_client_calls


class RLSIsolationTests(unittest.TestCase):
    def test_supabase_rls_client_forwards_clerk_jwt_via_anon_client(self):
        deps, _raw_qdrant, create_client_calls = load_dependencies_module()

        client = deps._create_rls_supabase_client("clerk-jwt-123")

        self.assertTrue(create_client_calls, "create_client() should be called")
        call = create_client_calls[0]
        self.assertEqual(call["url"], "https://example.supabase.co")
        self.assertEqual(call["key"], "anon-key")
        self.assertEqual(call["options"].headers["Authorization"], "Bearer clerk-jwt-123")
        self.assertEqual(call["options"].headers["apikey"], "anon-key")
        self.assertIsInstance(client, FakeSupabaseClient)

    def test_tenant_qdrant_wrapper_enforces_tenant_filter_and_payload(self):
        deps, raw_qdrant, _create_client_calls = load_dependencies_module()

        wrapper = deps.TenantQdrantClient("tenant_A", raw_qdrant)

        wrapper.query_points(collection_name="contracts_vectors", query=[0.1, 0.2], limit=5)
        query_filter = raw_qdrant.last_query["query_filter"]

        self.assertIsInstance(query_filter, FakeFilter)
        self.assertTrue(
            any(
                isinstance(condition, FakeFieldCondition)
                and condition.key == "tenant_id"
                and condition.match.value == "tenant_A"
                for condition in query_filter.must
            )
        )

        point = FakePointStruct(id="rule-1", vector=[0.3], payload={"rule_text": "No cap carve-out"})
        wrapper.upsert(collection_name="company_rules", points=[point])
        upsert_point = raw_qdrant.last_upsert["points"][0]
        self.assertEqual(upsert_point.payload["tenant_id"], "tenant_A")

        with self.assertRaises(ValueError):
            wrapper.upsert(
                collection_name="company_rules",
                points=[FakePointStruct(id="rule-2", vector=[0.4], payload={"tenant_id": "tenant_B"})],
            )

    def test_migration_hardens_rls_with_force_and_clerk_claim_helpers(self):
        sql = MIGRATION_PATH.read_text()

        self.assertIn("create or replace function app.current_tenant_id()", sql)
        self.assertIn("auth.jwt()->>'tenant_id'", sql)
        self.assertIn("auth.jwt()->>'org_id'", sql)
        self.assertIn("auth.jwt()->>'sub'", sql)
        self.assertIn("force row level security", sql.lower())
        self.assertIn("sub_tasks_tenant_isolation", sql)
        self.assertIn("company_playbooks_select", sql)

    def test_zero_trust_migration_locks_rls_to_org_id_and_storage_paths(self):
        sql = ZERO_TRUST_MIGRATION_PATH.read_text()

        self.assertIn("create or replace function app.current_org_id()", sql)
        self.assertIn("tenant_id = (auth.jwt()->>'org_id')::text", sql)
        self.assertNotIn("auth.jwt()->>'sub'", sql)
        self.assertIn("force row level security", sql.lower())
        self.assertIn("zero_trust_task_template_items", sql)
        self.assertIn("zero_trust_sub_tasks", sql)
        self.assertIn("storage.foldername(name)", sql)

    @unittest.skipUnless(
        os.getenv("PARIANA_PG_DSN"),
        "Set PARIANA_PG_DSN and install a Postgres driver to run the DB-level RLS assertion.",
    )
    def test_database_rls_blocks_cross_tenant_reads_without_eq(self):
        self.skipTest("Install psycopg in CI and execute the live Postgres RLS assertion there.")


if __name__ == "__main__":
    unittest.main()
