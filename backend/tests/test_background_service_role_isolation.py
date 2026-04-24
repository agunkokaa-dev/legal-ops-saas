from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
DEPENDENCIES_PATH = BACKEND_DIR / "app" / "dependencies.py"
NEGOTIATION_PATH = BACKEND_DIR / "app" / "routers" / "negotiation.py"


class FakeQueryBuilder:
    def __init__(self, client: "FakeSupabaseClient", table_name: str):
        self.client = client
        self.table_name = table_name
        self.operation = "select"
        self.payload = None
        self.kwargs: dict = {}
        self.filters: list[tuple[str, str, object]] = []
        self.ordering: tuple[str, bool] | None = None
        self.limit_count: int | None = None
        self.select_fields = "*"
        self.single_row = False

    def select(self, fields: str = "*", *args, **kwargs):
        self.operation = "select"
        self.select_fields = fields
        self.kwargs = kwargs
        return self

    def insert(self, payload, *args, **kwargs):
        self.operation = "insert"
        self.payload = payload
        self.kwargs = kwargs
        return self

    def update(self, payload, *args, **kwargs):
        self.operation = "update"
        self.payload = payload
        self.kwargs = kwargs
        return self

    def upsert(self, payload, *args, **kwargs):
        self.operation = "upsert"
        self.payload = payload
        self.kwargs = kwargs
        return self

    def delete(self, *args, **kwargs):
        self.operation = "delete"
        self.kwargs = kwargs
        return self

    def eq(self, key: str, value):
        self.filters.append(("eq", key, value))
        return self

    def gt(self, key: str, value):
        self.filters.append(("gt", key, value))
        return self

    def in_(self, key: str, values):
        self.filters.append(("in", key, set(values)))
        return self

    def order(self, key: str, desc: bool = False):
        self.ordering = (key, desc)
        return self

    def limit(self, count: int):
        self.limit_count = count
        return self

    def single(self):
        self.single_row = True
        self.limit_count = 1
        return self

    def execute(self):
        if self.operation == "select":
            rows = self._apply_filters([dict(row) for row in self.client.tables.get(self.table_name, [])])
            rows = self._apply_projection(rows)
            data = rows[0] if self.single_row else rows
            return types.SimpleNamespace(data=data)

        if self.operation == "insert":
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            inserted = []
            table = self.client.tables.setdefault(self.table_name, [])
            for row in payload_rows:
                table.append(dict(row))
                inserted.append(dict(row))
            return types.SimpleNamespace(data=inserted if not self.single_row else inserted[0])

        if self.operation == "update":
            updated = []
            table = self.client.tables.setdefault(self.table_name, [])
            for row in table:
                if self._matches(row):
                    row.update(dict(self.payload))
                    updated.append(dict(row))
            data = updated[0] if self.single_row and updated else (updated if not self.single_row else None)
            return types.SimpleNamespace(data=data)

        if self.operation == "upsert":
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            upserted = []
            table = self.client.tables.setdefault(self.table_name, [])
            conflict_columns = [item.strip() for item in str(self.kwargs.get("on_conflict") or "").split(",") if item.strip()]

            for incoming in payload_rows:
                existing = None
                for row in table:
                    if (
                        conflict_columns
                        and all(row.get(column) == incoming.get(column) for column in conflict_columns)
                        and self._matches(row)
                    ):
                        existing = row
                        break
                if existing is None:
                    new_row = dict(incoming)
                    table.append(new_row)
                    upserted.append(dict(new_row))
                else:
                    existing.update(dict(incoming))
                    upserted.append(dict(existing))

            data = upserted[0] if self.single_row and upserted else (upserted if not self.single_row else None)
            return types.SimpleNamespace(data=data)

        if self.operation == "delete":
            deleted = []
            table = self.client.tables.setdefault(self.table_name, [])
            remaining = []
            for row in table:
                if self._matches(row):
                    deleted.append(dict(row))
                else:
                    remaining.append(row)
            self.client.tables[self.table_name] = remaining
            data = deleted[0] if self.single_row and deleted else (deleted if not self.single_row else None)
            return types.SimpleNamespace(data=data)

        raise AssertionError(f"Unsupported operation {self.operation}")

    def _apply_filters(self, rows: list[dict]) -> list[dict]:
        filtered = [row for row in rows if self._matches(row)]
        if self.ordering is not None:
            key, desc = self.ordering
            filtered.sort(key=lambda row: row.get(key) or 0, reverse=desc)
        if self.limit_count is not None:
            filtered = filtered[:self.limit_count]
        return filtered

    def _apply_projection(self, rows: list[dict]) -> list[dict]:
        if self.select_fields == "*":
            return rows
        keys = [field.strip() for field in self.select_fields.split(",")]
        return [{key: row.get(key) for key in keys} for row in rows]

    def _matches(self, row: dict) -> bool:
        for operator, key, value in self.filters:
            if operator == "eq" and row.get(key) != value:
                return False
            if operator == "gt" and not ((row.get(key) or 0) > value):
                return False
            if operator == "in" and row.get(key) not in value:
                return False
        return True


class FakeSupabaseClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables = {name: [dict(row) for row in rows] for name, rows in (tables or {}).items()}

    def table(self, table_name: str) -> FakeQueryBuilder:
        return FakeQueryBuilder(self, table_name)

    def rpc(self, function_name: str, params: dict, *args, **kwargs):
        return types.SimpleNamespace(data={"function_name": function_name, "params": params})


class BackgroundIsolationTests(unittest.TestCase):
    MODULE_NAMES = [
        "fastapi",
        "fastapi.responses",
        "supabase",
        "supabase.lib.client_options",
        "qdrant_client.http.models",
        "qdrant_client.http",
        "app",
        "app.config",
        "app.counsel_engine",
        "app.debate",
        "app.debate.graph",
        "app.debate.schemas",
        "app.schemas",
        "app.review_schemas",
        "app.pipeline_output_schema",
        "app.task_logger",
        "app.rate_limiter",
        "app.token_budget",
        "app.event_bus",
        "app.services",
        "app.services.v3_builder",
        "app.dependencies",
        "app.routers",
        "app.routers.negotiation",
        "graph",
        "pydantic",
    ]

    def setUp(self):
        self._original_modules = {name: sys.modules.get(name) for name in self.MODULE_NAMES}
        self._install_stubs()
        self.deps = self._load_module("app.dependencies", DEPENDENCIES_PATH)
        self.negotiation = self._load_module("app.routers.negotiation", NEGOTIATION_PATH)

    def tearDown(self):
        for name, original in self._original_modules.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original

    def _load_module(self, module_name: str, path: Path):
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module

    def _install_stubs(self) -> None:
        app_module = types.ModuleType("app")
        app_module.__path__ = []  # type: ignore[attr-defined]
        sys.modules["app"] = app_module

        routers_module = types.ModuleType("app.routers")
        routers_module.__path__ = []  # type: ignore[attr-defined]
        sys.modules["app.routers"] = routers_module

        debate_pkg = types.ModuleType("app.debate")
        debate_pkg.__path__ = []  # type: ignore[attr-defined]
        sys.modules["app.debate"] = debate_pkg

        services_pkg = types.ModuleType("app.services")
        services_pkg.__path__ = []  # type: ignore[attr-defined]
        sys.modules["app.services"] = services_pkg

        fastapi = types.ModuleType("fastapi")

        class HTTPException(Exception):
            def __init__(self, status_code: int, detail: str):
                super().__init__(detail)
                self.status_code = status_code
                self.detail = detail

        def Depends(value):
            return value

        def Header(default=None):
            return default

        def Query(default=None, **kwargs):
            return default

        class Request:
            def __init__(self):
                self.state = types.SimpleNamespace()

        class APIRouter:
            def get(self, *args, **kwargs):
                return lambda fn: fn

            post = patch = delete = get

        fastapi.APIRouter = APIRouter
        fastapi.Depends = Depends
        fastapi.Header = Header
        fastapi.HTTPException = HTTPException
        fastapi.Query = Query
        fastapi.Request = Request
        sys.modules["fastapi"] = fastapi

        fastapi_responses = types.ModuleType("fastapi.responses")
        fastapi_responses.JSONResponse = type("JSONResponse", (), {})
        fastapi_responses.StreamingResponse = type("StreamingResponse", (), {})
        sys.modules["fastapi.responses"] = fastapi_responses

        supabase = types.ModuleType("supabase")
        supabase.Client = FakeSupabaseClient
        supabase.create_client = lambda *args, **kwargs: FakeSupabaseClient()
        sys.modules["supabase"] = supabase

        client_options_mod = types.ModuleType("supabase.lib.client_options")

        class ClientOptions:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        client_options_mod.ClientOptions = ClientOptions
        sys.modules["supabase.lib.client_options"] = client_options_mod

        qdrant_models = types.ModuleType("qdrant_client.http.models")

        class FieldCondition:
            def __init__(self, key=None, match=None):
                self.key = key
                self.match = match

        class MatchValue:
            def __init__(self, value=None):
                self.value = value

        class Filter:
            def __init__(self, must=None, should=None, must_not=None):
                self.must = must or []
                self.should = should
                self.must_not = must_not

        class PointStruct:
            def __init__(self, id=None, vector=None, payload=None):
                self.id = id
                self.vector = vector
                self.payload = payload or {}

        qdrant_models.FieldCondition = FieldCondition
        qdrant_models.Filter = Filter
        qdrant_models.MatchValue = MatchValue
        qdrant_models.PointStruct = PointStruct
        sys.modules["qdrant_client.http.models"] = qdrant_models

        qdrant_http = types.ModuleType("qdrant_client.http")
        qdrant_http.models = types.SimpleNamespace(FilterSelector=object)
        sys.modules["qdrant_client.http"] = qdrant_http

        pydantic = types.ModuleType("pydantic")
        pydantic.BaseModel = type("BaseModel", (), {})
        sys.modules["pydantic"] = pydantic

        class DummyQdrant:
            def scroll(self, *args, **kwargs):
                return [], None

        config = types.ModuleType("app.config")
        config.CLERK_PEM_KEY = "fake-pem"
        config.SUPABASE_URL = "https://example.supabase.co"
        config.SUPABASE_ANON_KEY = "anon-key"
        config.admin_supabase = FakeSupabaseClient()
        config.qdrant = DummyQdrant()
        config.openai_client = object()
        config.COLLECTION_NAME = "contracts_vectors"
        sys.modules["app.config"] = config

        counsel_engine = types.ModuleType("app.counsel_engine")
        counsel_engine.handle_counsel_message = lambda *args, **kwargs: None
        sys.modules["app.counsel_engine"] = counsel_engine

        debate_graph = types.ModuleType("app.debate.graph")
        debate_graph.run_debate_and_persist = lambda *args, **kwargs: None
        sys.modules["app.debate.graph"] = debate_graph

        debate_schemas = types.ModuleType("app.debate.schemas")
        debate_schemas.DebateSessionCreate = type("DebateSessionCreate", (), {})
        debate_schemas.DebateSessionResponse = type("DebateSessionResponse", (), {})
        sys.modules["app.debate.schemas"] = debate_schemas

        schemas = types.ModuleType("app.schemas")
        schemas.EscalateIssueRequest = type("EscalateIssueRequest", (), {})
        schemas.DiffRequest = type("DiffRequest", (), {})
        sys.modules["app.schemas"] = schemas

        review_schemas = types.ModuleType("app.review_schemas")
        review_schemas.BlockingIssue = type("BlockingIssue", (), {})
        review_schemas.CounselRequest = type("CounselRequest", (), {})
        review_schemas.FinalizePreviewResponse = type("FinalizePreviewResponse", (), {})
        review_schemas.FinalizeRoundRequest = type("FinalizeRoundRequest", (), {})
        review_schemas.FinalizeRoundResponse = type("FinalizeRoundResponse", (), {})
        review_schemas.SmartDiffResult = type("SmartDiffResult", (), {})
        sys.modules["app.review_schemas"] = review_schemas

        pipeline_output_schema = types.ModuleType("app.pipeline_output_schema")
        pipeline_output_schema.PipelineOutput = type("PipelineOutput", (), {})
        pipeline_output_schema.parse_pipeline_output = (
            lambda value: types.SimpleNamespace(**dict(value or {}))
        )
        pipeline_output_schema.serialize_pipeline_output = lambda value: dict(vars(value))
        sys.modules["app.pipeline_output_schema"] = pipeline_output_schema

        task_logger = types.ModuleType("app.task_logger")
        task_logger.TaskLogger = type("TaskLogger", (), {})
        sys.modules["app.task_logger"] = task_logger

        rate_limiter = types.ModuleType("app.rate_limiter")

        class DummyLimiter:
            def limit(self, *_args, **_kwargs):
                return lambda fn: fn

        rate_limiter.limiter = DummyLimiter()
        sys.modules["app.rate_limiter"] = rate_limiter

        token_budget = types.ModuleType("app.token_budget")
        token_budget.allocate_budget = lambda *args, **kwargs: {}
        sys.modules["app.token_budget"] = token_budget

        event_bus = types.ModuleType("app.event_bus")
        event_bus.ContractRoundFinalizedEvent = type("ContractRoundFinalizedEvent", (), {})

        class SSEEvent:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

        class DummyEventBus:
            async def publish(self, _event):
                return None

        event_bus.SSEEvent = SSEEvent
        event_bus.event_bus = DummyEventBus()
        sys.modules["app.event_bus"] = event_bus

        v3_builder = types.ModuleType("app.services.v3_builder")
        v3_builder.build_v3_merged_text = lambda *args, **kwargs: ""
        v3_builder.resolve_active_round_context = lambda *args, **kwargs: {}
        sys.modules["app.services.v3_builder"] = v3_builder

        graph = types.ModuleType("graph")

        async def run_smart_diff_with_debate(*args, **kwargs):
            return {}

        graph.run_smart_diff_with_debate = run_smart_diff_with_debate
        sys.modules["graph"] = graph

    def test_execute_diff_and_persist_stays_tenant_isolated_in_background_flow(self):
        """
        Integration-style isolation test for the Smart Diff background persistence hotspot.

        This hotspot was chosen because `_execute_diff_and_persist()` reads and writes
        multiple tenant-scoped tables under the privileged background path:
        `contract_versions`, `negotiation_issues`, and `negotiation_rounds`.
        """
        fake_raw = FakeSupabaseClient({
            "contract_versions": [
                {
                    "id": "tenant-a-v1",
                    "tenant_id": "tenant_A",
                    "contract_id": "shared-contract",
                    "version_number": 1,
                    "raw_text": "Tenant A version 1",
                    "risk_score": 12.0,
                    "pipeline_output": {},
                },
                {
                    "id": "tenant-a-v2",
                    "tenant_id": "tenant_A",
                    "contract_id": "shared-contract",
                    "version_number": 2,
                    "raw_text": "Tenant A version 2",
                    "risk_score": 18.0,
                    "pipeline_output": {},
                },
                {
                    "id": "tenant-b-v19",
                    "tenant_id": "tenant_B",
                    "contract_id": "shared-contract",
                    "version_number": 19,
                    "raw_text": "Tenant B version 19",
                    "risk_score": 77.0,
                    "pipeline_output": {"diff_result": {"summary": "tenant B old diff"}},
                },
                {
                    "id": "tenant-b-v20",
                    "tenant_id": "tenant_B",
                    "contract_id": "shared-contract",
                    "version_number": 20,
                    "raw_text": "Tenant B version 20",
                    "risk_score": 82.0,
                    "pipeline_output": {"diff_result": {"summary": "tenant B latest diff"}},
                },
            ],
            "negotiation_rounds": [
                {
                    "tenant_id": "tenant_A",
                    "contract_id": "shared-contract",
                    "round_number": 1,
                    "diff_snapshot": {"summary": "Tenant A prior round"},
                    "concession_analysis": {},
                },
                {
                    "tenant_id": "tenant_B",
                    "contract_id": "shared-contract",
                    "round_number": 1,
                    "diff_snapshot": {"summary": "TENANT B SECRET"},
                    "concession_analysis": {},
                },
            ],
            "negotiation_issues": [
                {
                    "id": "tenant-b-issue",
                    "tenant_id": "tenant_B",
                    "contract_id": "shared-contract",
                    "version_id": "tenant-b-v20",
                    "finding_id": "tenant-b-dev",
                    "title": "Tenant B issue",
                    "created_at": "2026-04-20T00:00:00+00:00",
                }
            ],
        })

        captured: dict[str, object] = {}

        def fake_allocate_budget(*, inputs, **kwargs):
            return {
                "v1_text": (inputs["v1_text"], 10),
                "v2_text": (inputs["v2_text"], 11),
                "playbook_rules": (inputs["playbook_rules"], 3),
                "prior_rounds": (inputs["prior_rounds"], 4),
            }

        async def fake_run_smart_diff_with_debate(**kwargs):
            captured.update(kwargs)
            return {
                "deviations": [
                    {
                        "deviation_id": "tenant-a-dev-1",
                        "title": "Liability cap removed",
                        "impact_analysis": "Tenant A regression only.",
                        "severity": "critical",
                        "category": "Modified",
                        "v2_coordinates": {"start_char": 10, "end_char": 20},
                    }
                ],
                "batna_fallbacks": [
                    {
                        "deviation_id": "tenant-a-dev-1",
                        "fallback_clause": "Restore the liability cap.",
                    }
                ],
                "risk_delta": 7,
            }

        self.negotiation.allocate_budget = fake_allocate_budget
        self.negotiation.run_smart_diff_with_debate = fake_run_smart_diff_with_debate
        self.negotiation.qdrant = types.SimpleNamespace(scroll=lambda **kwargs: ([], None))

        tenant_sb = self.deps.TenantSupabaseClient(fake_raw, "tenant_A")
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            result = loop.run_until_complete(
                self.negotiation._execute_diff_and_persist(
                    contract_id="shared-contract",
                    tenant_id="tenant_A",
                    supabase_client=tenant_sb,
                )
            )
        finally:
            asyncio.set_event_loop(None)
            loop.close()
 

        self.assertEqual(result["v1_version_id"], "tenant-a-v1")
        self.assertEqual(result["v2_version_id"], "tenant-a-v2")
        self.assertEqual(captured["v1_text"], "Tenant A version 1")
        self.assertEqual(captured["v2_text"], "Tenant A version 2")
        self.assertEqual(captured["tenant_id"], "tenant_A")
        self.assertIn("Tenant A prior round", captured["prior_rounds"])
        self.assertNotIn("TENANT B SECRET", captured["prior_rounds"])

        tenant_a_version = next(
            row for row in fake_raw.tables["contract_versions"] if row["id"] == "tenant-a-v2"
        )
        tenant_b_version = next(
            row for row in fake_raw.tables["contract_versions"] if row["id"] == "tenant-b-v20"
        )
        self.assertIn("diff_result", tenant_a_version["pipeline_output"])
        self.assertEqual(
            tenant_b_version["pipeline_output"],
            {"diff_result": {"summary": "tenant B latest diff"}},
        )

        inserted_issues = [
            row for row in fake_raw.tables["negotiation_issues"]
            if row["tenant_id"] == "tenant_A"
        ]
        self.assertEqual(len(inserted_issues), 1)
        self.assertEqual(inserted_issues[0]["finding_id"], "tenant-a-dev-1")

        tenant_b_issues = [
            row for row in fake_raw.tables["negotiation_issues"]
            if row["tenant_id"] == "tenant_B"
        ]
        self.assertEqual(len(tenant_b_issues), 1)
        self.assertEqual(tenant_b_issues[0]["id"], "tenant-b-issue")

        tenant_b_rounds = [
            row for row in fake_raw.tables["negotiation_rounds"]
            if row["tenant_id"] == "tenant_B"
        ]
        self.assertEqual(len(tenant_b_rounds), 1)
        self.assertEqual(tenant_b_rounds[0]["diff_snapshot"]["summary"], "TENANT B SECRET")


if __name__ == "__main__":
    unittest.main()
