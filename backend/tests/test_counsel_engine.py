import asyncio
import copy
import importlib
import json
import sys
import types
import unittest
from enum import Enum
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


PROMPTS_PATH = ROOT / "app" / "counsel_prompts.py"
NEGOTIATION_PATH = ROOT / "app" / "routers" / "negotiation.py"
DEBATE_GRAPH_PATH = ROOT / "app" / "debate" / "graph.py"
ROOT_GRAPH_PATH = ROOT / "graph.py"
JOB_QUEUE_PATH = ROOT / "app" / "job_queue.py"
WORKER_PATH = ROOT / "worker.py"


def _read(path: Path) -> str:
    return path.read_text()


def load_counsel_engine_module():
    class DummyEmbeddings:
        def create(self, *args, **kwargs):
            return types.SimpleNamespace(data=[types.SimpleNamespace(embedding=[0.1, 0.2, 0.3])])

    class DummyOpenAI:
        def __init__(self):
            self.embeddings = DummyEmbeddings()

    class DummyQdrant:
        def query_points(self, **kwargs):
            return types.SimpleNamespace(points=[])

    class Filter:
        def __init__(self, must=None, should=None, must_not=None):
            self.must = must or []
            self.should = should
            self.must_not = must_not

    class FieldCondition:
        def __init__(self, key, match):
            self.key = key
            self.match = match

    class MatchValue:
        def __init__(self, value):
            self.value = value

    qdrant_pkg = types.ModuleType("qdrant_client")
    qdrant_http_pkg = types.ModuleType("qdrant_client.http")
    qdrant_models = types.ModuleType("qdrant_client.http.models")
    qdrant_models.Filter = Filter
    qdrant_models.FieldCondition = FieldCondition
    qdrant_models.MatchValue = MatchValue

    config_module = types.ModuleType("app.config")
    config_module.ANTHROPIC_API_KEY = "test-key"
    config_module.NATIONAL_LAWS_COLLECTION = "id_national_laws"
    config_module.openai_client = DummyOpenAI()
    config_module.qdrant = DummyQdrant()

    dependencies_module = types.ModuleType("app.dependencies")
    dependencies_module.TenantQdrantClient = object

    review_schemas_module = types.ModuleType("app.review_schemas")

    class CounselSessionType(str, Enum):
        DEVIATION = "deviation"
        GENERAL_STRATEGY = "general_strategy"

    review_schemas_module.CounselSessionType = CounselSessionType

    token_budget_module = types.ModuleType("app.token_budget")

    def allocate_budget(*, inputs, **kwargs):
        return {name: (text, len(str(text))) for name, text in inputs.items()}

    token_budget_module.allocate_budget = allocate_budget

    patched_modules = {
        "qdrant_client": qdrant_pkg,
        "qdrant_client.http": qdrant_http_pkg,
        "qdrant_client.http.models": qdrant_models,
        "app.config": config_module,
        "app.dependencies": dependencies_module,
        "app.review_schemas": review_schemas_module,
        "app.token_budget": token_budget_module,
    }
    originals = {name: sys.modules.get(name) for name in patched_modules}

    try:
        for name, module in patched_modules.items():
            sys.modules[name] = module
        sys.modules.pop("app.counsel_engine", None)
        return importlib.import_module("app.counsel_engine")
    finally:
        for name, original in originals.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, store, table_name):
        self.store = store
        self.table_name = table_name
        self._action = "select"
        self._payload = None
        self._filters = []
        self._order_field = None
        self._order_desc = False
        self._limit = None

    def select(self, *_args, **_kwargs):
        self._action = "select"
        return self

    def insert(self, payload, *_args, **_kwargs):
        self._action = "insert"
        self._payload = payload
        return self

    def update(self, payload, *_args, **_kwargs):
        self._action = "update"
        self._payload = payload
        return self

    def eq(self, key, value):
        self._filters.append(("eq", key, value))
        return self

    def lt(self, key, value):
        self._filters.append(("lt", key, value))
        return self

    def gt(self, key, value):
        self._filters.append(("gt", key, value))
        return self

    def is_(self, key, value):
        self._filters.append(("is", key, value))
        return self

    def order(self, field, desc=False):
        self._order_field = field
        self._order_desc = desc
        return self

    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        rows = self.store.setdefault(self.table_name, [])

        if self._action == "insert":
            inserted = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = [copy.deepcopy(row) for row in inserted]
            rows.extend(inserted)
            return FakeResult(inserted)

        filtered = [row for row in rows if self._matches(row)]

        if self._action == "update":
            updated = []
            for row in filtered:
                row.update(copy.deepcopy(self._payload))
                updated.append(copy.deepcopy(row))
            return FakeResult(updated)

        if self._order_field:
            filtered = sorted(
                filtered,
                key=lambda row: row.get(self._order_field),
                reverse=self._order_desc,
            )
        if self._limit is not None:
            filtered = filtered[: self._limit]
        return FakeResult(copy.deepcopy(filtered))

    def _matches(self, row):
        for op, key, value in self._filters:
            current = row.get(key)
            if op == "eq" and current != value:
                return False
            if op == "lt" and not (current < value):
                return False
            if op == "gt" and not (current > value):
                return False
            if op == "is":
                if value == "null" and current is not None:
                    return False
                if value != "null" and current is None:
                    return False
        return True


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, table_name):
        return FakeQuery(self.tables, table_name)


def collect_async(async_iterable):
    async def _collect():
        return [item async for item in async_iterable]

    return asyncio.run(_collect())


def parse_sse(chunks):
    payloads = []
    for chunk in chunks:
        assert chunk.startswith("data: "), chunk
        payloads.append(json.loads(chunk[len("data: "):].strip()))
    return payloads


class CounselEngineTests(unittest.TestCase):
    def test_prompt_builders_include_deviation_batna_and_verdict(self):
        import app.counsel_prompts as prompts

        context = prompts.build_deviation_context(
            {
                "title": "Liability Cap Removed",
                "category": "Modified",
                "severity": "critical",
                "v1_text": "Liability capped at fees paid.",
                "v2_text": "No limitation of liability applies.",
                "impact_analysis": "Unlimited downside exposure.",
                "playbook_violation": "Liability cap required.",
                "counterparty_intent": "Shift tail risk to us.",
                "debate_verdict": {
                    "original_severity": "warning",
                    "final_severity": "critical",
                    "consensus_level": "majority",
                    "verdict_reasoning": "The removal creates materially higher exposure.",
                },
            },
            {
                "fallback_clause": "Cap liability at 12 months fees.",
                "reasoning": "Matches a defensible middle ground.",
                "leverage_points": ["Market standard", "Budget certainty"],
            },
        )

        self.assertIn("Liability Cap Removed", context)
        self.assertIn("Cap liability at 12 months fees.", context)
        self.assertIn("Original severity: warning -> Final: critical", context)

    def test_handle_counsel_message_no_diff_result_is_graceful(self):
        module = load_counsel_engine_module()
        supabase = FakeSupabase({
            "contract_versions": [
                {
                    "id": "v2",
                    "contract_id": "contract-1",
                    "version_number": 2,
                    "raw_text": "V2 text",
                    "risk_score": 55,
                    "risk_level": "High",
                    "pipeline_output": {},
                }
            ],
            "debate_sessions": [],
        })

        payloads = parse_sse(collect_async(module.handle_counsel_message(
            message="What should we do?",
            contract_id="contract-1",
            tenant_id="tenant-1",
            session_id=None,
            session_type="general_strategy",
            deviation_id=None,
            supabase=supabase,
            qdrant_client=object(),
        )))

        self.assertEqual(payloads[0]["type"], "error")
        self.assertEqual(payloads[-1]["type"], "done")
        self.assertEqual(supabase.tables["debate_sessions"], [])

    def test_handle_counsel_message_persists_history_across_turns(self):
        module = load_counsel_engine_module()

        async def fake_reference_context(**_kwargs):
            return "Playbook: cap liability.", "Law: UU PDP Article 46."

        stream_calls = []

        async def fake_stream_completion(*, system_prompt, messages):
            stream_calls.append({
                "system_prompt": system_prompt,
                "messages": copy.deepcopy(messages),
            })
            yield "Counsel answer."

        module._load_reference_context = fake_reference_context
        module._stream_counsel_completion = fake_stream_completion

        supabase = FakeSupabase({
            "contracts": [
                {
                    "id": "contract-1",
                    "title": "Master Services Agreement",
                    "contract_value": 5000000,
                    "currency": "IDR",
                    "jurisdiction": "Indonesia",
                    "governing_law": "Indonesian law",
                    "status": "Negotiating",
                }
            ],
            "contract_versions": [
                {
                    "id": "v1",
                    "contract_id": "contract-1",
                    "version_number": 1,
                    "raw_text": "Version one text",
                    "risk_score": 25,
                    "risk_level": "Medium",
                    "pipeline_output": {},
                },
                {
                    "id": "v2",
                    "contract_id": "contract-1",
                    "version_number": 2,
                    "raw_text": "Version two text",
                    "risk_score": 60,
                    "risk_level": "High",
                    "pipeline_output": {
                        "diff_result": {
                            "deviations": [
                                {
                                    "deviation_id": "issue-1",
                                    "title": "Liability Cap Removed",
                                    "category": "Modified",
                                    "severity": "critical",
                                    "v1_text": "Liability capped at fees paid.",
                                    "v2_text": "No limitation of liability applies.",
                                    "impact_analysis": "Unlimited downside exposure.",
                                    "playbook_violation": "Liability cap required.",
                                    "counterparty_intent": "Shift risk to us.",
                                }
                            ],
                            "batna_fallbacks": [
                                {
                                    "deviation_id": "issue-1",
                                    "fallback_clause": "Cap liability at 12 months fees.",
                                    "reasoning": "Balanced fallback.",
                                    "leverage_points": ["Market standard"],
                                }
                            ],
                            "risk_delta": 35,
                            "summary": "Counterparty materially increased our exposure.",
                        }
                    },
                },
            ],
            "negotiation_rounds": [
                {
                    "round_number": 1,
                    "diff_snapshot": {"summary": "Initial counterparty markup."},
                    "concession_analysis": {"pattern": "Counterparty is firm on liability."},
                    "created_at": "2026-04-16T00:00:00+00:00",
                }
            ],
            "debate_sessions": [],
        })

        first_payloads = parse_sse(collect_async(module.handle_counsel_message(
            message="Give me the overall strategy.",
            contract_id="contract-1",
            tenant_id="tenant-1",
            session_id=None,
            session_type="general_strategy",
            deviation_id=None,
            supabase=supabase,
            qdrant_client=object(),
        )))

        self.assertEqual(first_payloads[0]["type"], "session_started")
        self.assertEqual(first_payloads[1]["type"], "chunk")
        self.assertEqual(first_payloads[-1]["type"], "done")

        session_id = first_payloads[0]["session_id"]
        session_rows = supabase.tables["debate_sessions"]
        self.assertEqual(len(session_rows), 1)
        self.assertEqual(session_rows[0]["session_kind"], "counsel")
        self.assertEqual(session_rows[0]["status"], "completed")
        self.assertEqual(len(session_rows[0]["messages"]), 2)

        second_payloads = parse_sse(collect_async(module.handle_counsel_message(
            message="What concessions can we offer?",
            contract_id="contract-1",
            tenant_id="tenant-1",
            session_id=session_id,
            session_type="general_strategy",
            deviation_id=None,
            supabase=supabase,
            qdrant_client=object(),
        )))

        self.assertEqual(second_payloads[0]["type"], "session_started")
        self.assertEqual(second_payloads[-1]["type"], "done")
        self.assertEqual(len(supabase.tables["debate_sessions"][0]["messages"]), 4)
        self.assertEqual(len(stream_calls), 2)
        self.assertEqual(
            [message["content"] for message in stream_calls[1]["messages"]],
            [
                "Give me the overall strategy.",
                "Counsel answer.",
                "What concessions can we offer?",
            ],
        )

    def test_auto_debate_defaults_are_disabled(self):
        self.assertIn("enable_debate: bool = False", _read(ROOT_GRAPH_PATH))
        self.assertIn('Query(default=False, description="Enable multi-agent debate protocol")', _read(NEGOTIATION_PATH))
        self.assertIn("enable_debate: bool = False", _read(JOB_QUEUE_PATH))
        self.assertIn("enable_debate: bool = False", _read(WORKER_PATH))

    def test_debate_queries_are_filtered_to_debate_rows(self):
        negotiation_source = _read(NEGOTIATION_PATH)
        debate_graph_source = _read(DEBATE_GRAPH_PATH)

        self.assertIn('.eq("session_kind", "debate")', negotiation_source)
        self.assertIn('.eq("session_kind", "debate")', debate_graph_source)

    def test_counsel_routes_are_present(self):
        negotiation_source = _read(NEGOTIATION_PATH)

        self.assertIn('@router.post("/{contract_id}/counsel")', negotiation_source)
        self.assertIn('@router.get("/{contract_id}/counsel/sessions")', negotiation_source)
        self.assertIn('@router.get("/{contract_id}/counsel/sessions/{session_id}")', negotiation_source)


if __name__ == "__main__":
    unittest.main()
