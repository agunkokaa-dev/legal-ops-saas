import asyncio
import json
import os
import sys
import types
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace


ROOT = os.path.dirname(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.environ.setdefault("SIGNING_PROVIDER", "mock")


def install_import_stubs():
    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str = ""):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class Response:
        def __init__(self, content=b"", media_type=None, headers=None):
            self.content = content
            self.media_type = media_type
            self.headers = headers or {}

    class JSONResponse(Response):
        def __init__(self, status_code=200, content=None, headers=None):
            super().__init__(content=content, headers=headers)
            self.status_code = status_code

    class StreamingResponse(Response):
        pass

    class APIRouter:
        def get(self, *args, **kwargs):
            return self._decorator

        def post(self, *args, **kwargs):
            return self._decorator

        def patch(self, *args, **kwargs):
            return self._decorator

        def _decorator(self, fn):
            return fn

    def Depends(value=None):
        return value

    def Query(default=None, **kwargs):
        return default

    def Header(default=None, **kwargs):
        return default

    class Request:
        def __init__(self, body=b""):
            self._body = body
            self.state = SimpleNamespace()
            self.headers = {}

        async def body(self):
            return self._body

    fastapi = types.ModuleType("fastapi")
    fastapi.APIRouter = APIRouter
    fastapi.HTTPException = HTTPException
    fastapi.Depends = Depends
    fastapi.Query = Query
    fastapi.Header = Header
    fastapi.Request = Request
    fastapi.Response = Response
    sys.modules.setdefault("fastapi", fastapi)

    fastapi_responses = types.ModuleType("fastapi.responses")
    fastapi_responses.JSONResponse = JSONResponse
    fastapi_responses.StreamingResponse = StreamingResponse
    sys.modules.setdefault("fastapi.responses", fastapi_responses)

    class BaseModel:
        def __init__(self, **kwargs):
            for key, value in self.__class__.__dict__.items():
                if key.startswith("_") or callable(value):
                    continue
                setattr(self, key, value)
            for key, value in kwargs.items():
                setattr(self, key, value)

        def model_dump(self):
            return dict(self.__dict__)

    def Field(default=None, default_factory=None, **kwargs):
        if default_factory is not None:
            return default_factory()
        return default

    pydantic = types.ModuleType("pydantic")
    pydantic.BaseModel = BaseModel
    pydantic.Field = Field
    sys.modules.setdefault("pydantic", pydantic)

    class DummyLimiter:
        def limit(self, *_args, **_kwargs):
            def decorator(fn):
                return fn
            return decorator

    rate_limiter = types.ModuleType("app.rate_limiter")
    rate_limiter.limiter = DummyLimiter()
    rate_limiter.rate_limit_exceeded_handler = lambda request, exc: None
    sys.modules.setdefault("app.rate_limiter", rate_limiter)

    dependencies = types.ModuleType("app.dependencies")

    async def verify_clerk_token(*args, **kwargs):
        return {}

    async def get_tenant_supabase():
        return None

    dependencies.verify_clerk_token = verify_clerk_token
    dependencies.get_tenant_supabase = get_tenant_supabase
    sys.modules.setdefault("app.dependencies", dependencies)

    event_bus_module = types.ModuleType("app.event_bus")

    class SSEEvent:
        def __init__(self, event_type, tenant_id, data, contract_id=None, **kwargs):
            self.event_type = event_type
            self.tenant_id = tenant_id
            self.data = data
            self.contract_id = contract_id

    class DummyEventBus:
        async def publish(self, _event):
            return None

        async def startup(self):
            return None

        async def close(self):
            return None

    event_bus_module.SSEEvent = SSEEvent
    event_bus_module.event_bus = DummyEventBus()
    sys.modules.setdefault("app.event_bus", event_bus_module)

    config = types.ModuleType("app.config")
    config.admin_supabase = None
    config.openai_client = object()
    config.qdrant = object()
    config.COLLECTION_NAME = "contracts_vectors"
    config.CLERK_PEM_KEY = "fake-pem"
    config.SUPABASE_URL = "http://fake.supabase"
    config.SUPABASE_ANON_KEY = "anon"
    sys.modules.setdefault("app.config", config)

    supabase = types.ModuleType("supabase")

    class Client:
        pass

    def create_client(*args, **kwargs):
        return None

    supabase.Client = Client
    supabase.create_client = create_client
    sys.modules.setdefault("supabase", supabase)

    schemas = types.ModuleType("app.schemas")
    schemas.EscalateIssueRequest = type("EscalateIssueRequest", (BaseModel,), {})
    schemas.DiffRequest = type("DiffRequest", (BaseModel,), {})
    sys.modules.setdefault("app.schemas", schemas)

    review_schemas = types.ModuleType("app.review_schemas")
    review_schemas.SmartDiffResult = dict
    sys.modules.setdefault("app.review_schemas", review_schemas)

    task_logger = types.ModuleType("app.task_logger")

    class TaskLogger:
        def __init__(self, *args, **kwargs):
            pass

        def complete(self, *args, **kwargs):
            return None

        def fail(self, *args, **kwargs):
            return None

    task_logger.TaskLogger = TaskLogger
    sys.modules.setdefault("app.task_logger", task_logger)

    token_budget = types.ModuleType("app.token_budget")
    token_budget.allocate_budget = lambda *args, **kwargs: {}
    sys.modules.setdefault("app.token_budget", token_budget)

    graph_module = types.ModuleType("graph")
    graph_module.run_smart_diff_agent = lambda *args, **kwargs: {}
    graph_module.fuzzy_find_substring = lambda *args, **kwargs: (-1, -1)
    graph_module.risk_agent = lambda *args, **kwargs: {}
    graph_module.run_presign_checklist_agent = lambda **kwargs: {
        "bilingual_required": True,
        "recommended_signature_type": "certified",
        "notes": ["Stubbed AI guidance for test harness."],
        "rationale": "Stubbed locally.",
    }
    sys.modules.setdefault("graph", graph_module)

    qdrant_models = types.ModuleType("qdrant_client.http.models")
    qdrant_models.Filter = object
    qdrant_models.FieldCondition = object
    qdrant_models.MatchValue = object
    sys.modules.setdefault("qdrant_client.http.models", qdrant_models)

    bilingual_schemas = types.ModuleType("app.bilingual_schemas")
    bilingual_schemas.ClauseSyncRequest = type("ClauseSyncRequest", (BaseModel,), {})
    bilingual_schemas.ClauseSyncResponse = type("ClauseSyncResponse", (BaseModel,), {})
    bilingual_schemas.ClauseUpdateRequest = type("ClauseUpdateRequest", (BaseModel,), {})
    bilingual_schemas.ClauseCreateRequest = type("ClauseCreateRequest", (BaseModel,), {})
    sys.modules.setdefault("app.bilingual_schemas", bilingual_schemas)

    bilingual_agent = types.ModuleType("app.bilingual_agent")

    class Report:
        def model_dump(self):
            return {"status": "ok"}

    bilingual_agent.run_bilingual_consistency_agent = lambda clauses: Report()
    sys.modules.setdefault("app.bilingual_agent", bilingual_agent)

    reportlab = types.ModuleType("reportlab")
    reportlab_lib = types.ModuleType("reportlab.lib")
    reportlab_pagesizes = types.ModuleType("reportlab.lib.pagesizes")
    reportlab_pagesizes.A4 = (595, 842)
    reportlab_pagesizes.letter = (612, 792)
    reportlab_colors = types.ModuleType("reportlab.lib.colors")
    reportlab_colors.darkslategray = "#2f4f4f"
    reportlab_colors.lightgrey = "#d3d3d3"
    reportlab_colors.black = "#000000"
    reportlab_styles = types.ModuleType("reportlab.lib.styles")

    def getSampleStyleSheet():
        return {
            "Heading1": {},
            "Heading2": {},
            "Heading3": {},
            "BodyText": {},
            "Normal": {},
        }

    class ParagraphStyle(dict):
        def __init__(self, name="", parent=None, **kwargs):
            super().__init__(**kwargs)
            self["name"] = name
            self["parent"] = parent or {}

    reportlab_styles.getSampleStyleSheet = getSampleStyleSheet
    reportlab_styles.ParagraphStyle = ParagraphStyle

    reportlab_platypus = types.ModuleType("reportlab.platypus")

    class SimpleDocTemplate:
        def __init__(self, buffer, *args, **kwargs):
            self.buffer = buffer

        def build(self, _story):
            self.buffer.write(b"%PDF-1.4\n%mock-reportlab\n")

    class Paragraph:
        def __init__(self, text, style):
            self.text = text
            self.style = style

    class Spacer:
        def __init__(self, width, height):
            self.width = width
            self.height = height

    class Table:
        def __init__(self, data, colWidths=None):
            self.data = data
            self.colWidths = colWidths

        def setStyle(self, _style):
            return None

    class TableStyle:
        def __init__(self, commands):
            self.commands = commands

    reportlab_platypus.SimpleDocTemplate = SimpleDocTemplate
    reportlab_platypus.Paragraph = Paragraph
    reportlab_platypus.Spacer = Spacer
    reportlab_platypus.Table = Table
    reportlab_platypus.TableStyle = TableStyle

    sys.modules.setdefault("reportlab", reportlab)
    sys.modules.setdefault("reportlab.lib", reportlab_lib)
    sys.modules.setdefault("reportlab.lib.pagesizes", reportlab_pagesizes)
    sys.modules.setdefault("reportlab.lib.colors", reportlab_colors)
    sys.modules.setdefault("reportlab.lib.styles", reportlab_styles)
    sys.modules.setdefault("reportlab.platypus", reportlab_platypus)


install_import_stubs()

from fastapi import Request  # noqa: E402
from app.routers import bilingual, negotiation, signing  # noqa: E402
from app.signing_providers import get_signing_provider  # noqa: E402


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FakeBucket:
    def __init__(self, files: dict[str, bytes]):
        self.files = files

    def upload(self, path: str, file: bytes, file_options=None):
        self.files[path] = bytes(file)
        return {"path": path}

    def download(self, path: str):
        if path not in self.files:
            raise FileNotFoundError(path)
        return self.files[path]


class FakeStorage:
    def __init__(self):
        self.files: dict[str, bytes] = {}

    def from_(self, _bucket: str):
        return FakeBucket(self.files)


class FakeQuery:
    def __init__(self, client, table_name: str):
        self.client = client
        self.table_name = table_name
        self._filters: list[tuple[str, str, object]] = []
        self._limit = None
        self._order_by = None
        self._order_desc = False
        self._single = False
        self._operation = "select"
        self._payload = None

    def select(self, _columns="*"):
        self._operation = "select"
        return self

    def insert(self, payload):
        self._operation = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._operation = "update"
        self._payload = payload
        return self

    def delete(self):
        self._operation = "delete"
        return self

    def eq(self, column, value):
        self._filters.append(("eq", column, value))
        return self

    def neq(self, column, value):
        self._filters.append(("neq", column, value))
        return self

    def in_(self, column, values):
        self._filters.append(("in", column, list(values)))
        return self

    def gt(self, column, value):
        self._filters.append(("gt", column, value))
        return self

    def order(self, column, desc=False):
        self._order_by = column
        self._order_desc = desc
        return self

    def limit(self, value):
        self._limit = value
        return self

    def single(self):
        self._single = True
        return self

    def _matches(self, row: dict) -> bool:
        for op, column, value in self._filters:
            row_value = row.get(column)
            if op == "eq" and row_value != value:
                return False
            if op == "neq" and row_value == value:
                return False
            if op == "in" and row_value not in value:
                return False
            if op == "gt" and not (row_value is not None and row_value > value):
                return False
        return True

    def _rows(self):
        rows = [row for row in self.client.data.setdefault(self.table_name, []) if self._matches(row)]
        if self._order_by:
            rows.sort(key=lambda row: row.get(self._order_by) or "", reverse=self._order_desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return rows

    def execute(self):
        table = self.client.data.setdefault(self.table_name, [])
        if self._operation == "select":
            rows = [dict(row) for row in self._rows()]
            if self._single:
                return SimpleNamespace(data=rows[0] if rows else None)
            return SimpleNamespace(data=rows)

        if self._operation == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for payload in payloads:
                row = dict(payload)
                row.setdefault("id", str(uuid.uuid4()))
                row.setdefault("created_at", row.get("initiated_at") or now_iso())
                table.append(row)
                inserted.append(dict(row))
            return SimpleNamespace(data=inserted)

        if self._operation == "update":
            updated = []
            for row in self._rows():
                row.update(dict(self._payload))
                row.setdefault("updated_at", now_iso())
                updated.append(dict(row))
            if self._single:
                return SimpleNamespace(data=updated[0] if updated else None)
            return SimpleNamespace(data=updated)

        if self._operation == "delete":
            rows = self._rows()
            remaining = [row for row in table if row not in rows]
            self.client.data[self.table_name] = remaining
            return SimpleNamespace(data=[dict(row) for row in rows])

        raise RuntimeError(f"Unsupported operation {self._operation}")


class FakeSupabase:
    def __init__(self, seed_data: dict[str, list[dict]]):
        self.data = {table: [dict(row) for row in rows] for table, rows in seed_data.items()}
        self.storage = FakeStorage()

    def table(self, name: str):
        return FakeQuery(self, name)


def build_request(body: dict | None = None, tenant_id: str = "tenant-e2e"):
    raw = json.dumps(body or {}).encode()
    request = Request(raw)
    request.state.tenant_id = tenant_id
    return request


def find_one(rows: list[dict], **conditions):
    for row in rows:
        if all(row.get(key) == value for key, value in conditions.items()):
            return row
    raise AssertionError(f"Row not found in dataset for {conditions}")


async def main():
    tenant_id = "tenant-e2e"
    user_id = "user-e2e"
    matter_id = "matter-1"
    contract_id = "contract-1"
    version_id = "version-2"
    issue_id = "issue-critical"
    matter_start_value = 1_000_000
    contract_value = 12_500_000

    long_id = ("Ini adalah klausul bilingual yang sangat panjang untuk pengujian PDF. " * 120).strip()
    long_en = ("This is a very long bilingual clause used to test PDF generation stability. " * 120).strip()

    fake = FakeSupabase({
        "contracts": [{
            "id": contract_id,
            "tenant_id": tenant_id,
            "matter_id": matter_id,
            "title": "Mock Bilingual Supply Agreement",
            "status": "Negotiating",
            "draft_revisions": {"latest_text": "# Final Draft\n\nExecution version ready for signing."},
            "contract_value": contract_value,
            "currency": "IDR",
            "risk_score": 71.0,
            "risk_level": "High",
            "jurisdiction": "Indonesia",
            "parties": {"party_a": "PT Nusantara", "party_b": "Global Co"},
        }],
        "contract_versions": [{
            "id": version_id,
            "tenant_id": tenant_id,
            "contract_id": contract_id,
            "version_number": 2,
            "uploaded_filename": "v2_counterparty.pdf",
            "raw_text": "# Supply Agreement\n\nCounterparty version text for signing flow.",
            "risk_score": 71.0,
            "risk_level": "High",
            "created_at": now_iso(),
        }],
        "negotiation_issues": [{
            "id": issue_id,
            "tenant_id": tenant_id,
            "contract_id": contract_id,
            "title": "Unlimited indemnity expansion",
            "status": "open",
            "severity": "critical",
            "linked_task_id": None,
            "reasoning_log": [],
            "created_at": now_iso(),
        }],
        "bilingual_clauses": [{
            "id": "clause-1",
            "tenant_id": tenant_id,
            "contract_id": contract_id,
            "status": "active",
            "clause_number": "1",
            "id_text": long_id,
            "en_text": long_en,
            "sync_status": "synced",
        }],
        "contract_obligations": [
            {
                "id": "ob-1",
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "description": "Deliver first milestone report",
                "due_date": "2026-05-01",
                "status": "pending",
            },
            {
                "id": "ob-2",
                "tenant_id": tenant_id,
                "contract_id": contract_id,
                "description": "Pay implementation fee",
                "due_date": "2026-05-05",
                "status": "pending",
            },
        ],
        "matters": [{
            "id": matter_id,
            "tenant_id": tenant_id,
            "industry": "banking",
            "total_contract_value": matter_start_value,
        }],
        "tasks": [],
        "signing_sessions": [],
        "signing_signers": [],
        "signing_audit_log": [],
        "activity_logs": [],
    })

    async def noop_publish(*args, **kwargs):
        return None

    negotiation.admin_supabase = fake
    signing.admin_supabase = fake
    bilingual.admin_supabase = fake
    signing._publish_signing_event = noop_publish
    negotiation.publish_negotiation_event = noop_publish

    claims = {"verified_tenant_id": tenant_id, "sub": user_id}

    print("1. Verifying finalize gate blocks unresolved critical issues...")
    blocked = await negotiation.finalize_for_signing(
        build_request(tenant_id=tenant_id),
        contract_id,
        claims=claims,
        supabase=fake,
    )
    assert blocked["blocked"] is True
    assert blocked["ready"] is False

    print("2. Resolving critical issue and finalizing for signing...")
    find_one(fake.data["negotiation_issues"], id=issue_id)["status"] = "accepted"
    finalized = await negotiation.finalize_for_signing(
        build_request(tenant_id=tenant_id),
        contract_id,
        claims=claims,
        supabase=fake,
    )
    assert finalized["ready"] is True
    contract_row = find_one(fake.data["contracts"], id=contract_id)
    assert contract_row["status"] == "Pending Approval"

    print("3. Verifying bilingual PDF generation succeeds...")
    pdf_bytes = await signing._generate_final_pdf(contract_id, tenant_id, contract_row, fake)
    assert pdf_bytes and pdf_bytes.startswith(b"%PDF"), "Expected generated PDF bytes"

    print("4. Running checklist and initiating signing session...")
    checklist = await signing.run_presign_checklist(
        build_request(tenant_id=tenant_id),
        contract_id,
        claims=claims,
        supabase=fake,
    )
    assert checklist["ready_to_sign"] is True

    initiate_payload = signing.InitiateSigningInput(
        signers=[
            signing.SignerInput(full_name="Ahmad Prasetyo", email="ahmad@example.com", role="pihak_pertama", signing_order_index=0),
            signing.SignerInput(full_name="Sarah Chen", email="sarah@example.com", role="pihak_kedua", signing_order_index=1),
        ],
        signing_order="sequential",
        signature_type="certified",
        require_emeterai=True,
        expires_in_days=7,
    )
    initiated = await signing.initiate_signing(
        build_request(tenant_id=tenant_id),
        contract_id,
        initiate_payload,
        claims=claims,
        supabase=fake,
    )
    assert initiated["status"] == "success"
    assert len(fake.data["signing_sessions"]) == 1
    assert len(fake.data["signing_signers"]) == 2
    session = fake.data["signing_sessions"][0]
    assert session["status"] == "pending_signatures"
    assert find_one(fake.data["contracts"], id=contract_id)["status"] == "Signing in Progress"

    print("5. Simulating provider-side signer completion webhooks...")
    provider = get_signing_provider()
    await provider.simulate_signer_action(session["provider_document_id"], "ahmad@example.com", "signed")
    await signing.handle_signing_webhook("mock", build_request({
        "event_type": "signer_viewed",
        "document_id": session["provider_document_id"],
        "signer_email": "ahmad@example.com",
    }, tenant_id=tenant_id))
    await signing.handle_signing_webhook("mock", build_request({
        "event_type": "signer_signed",
        "document_id": session["provider_document_id"],
        "signer_email": "ahmad@example.com",
        "certificate_serial": "CERT-1",
        "certificate_issuer": "Mock PSrE",
    }, tenant_id=tenant_id))
    assert find_one(fake.data["contracts"], id=contract_id)["status"] == "Partially Signed"

    await provider.simulate_signer_action(session["provider_document_id"], "sarah@example.com", "signed")
    await signing.handle_signing_webhook("mock", build_request({
        "event_type": "signer_viewed",
        "document_id": session["provider_document_id"],
        "signer_email": "sarah@example.com",
    }, tenant_id=tenant_id))
    await signing.handle_signing_webhook("mock", build_request({
        "event_type": "signer_signed",
        "document_id": session["provider_document_id"],
        "signer_email": "sarah@example.com",
        "certificate_serial": "CERT-2",
        "certificate_issuer": "Mock PSrE",
    }, tenant_id=tenant_id))

    print("6. Verifying execution cascade...")
    final_contract = find_one(fake.data["contracts"], id=contract_id)
    assert final_contract["status"] == "Executed"

    final_session = find_one(fake.data["signing_sessions"], id=session["id"])
    assert final_session["status"] == "completed"
    assert final_session.get("signed_document_path"), "Signed PDF should be stored"

    obligations = [row for row in fake.data["contract_obligations"] if row["contract_id"] == contract_id]
    assert obligations and all(row["status"] == "active" for row in obligations)

    created_tasks = [row for row in fake.data["tasks"] if row.get("matter_id") == matter_id]
    assert len(created_tasks) == 2

    matter = find_one(fake.data["matters"], id=matter_id)
    assert matter["total_contract_value"] == matter_start_value + contract_value

    activity_actions = {row.get("action") for row in fake.data["activity_logs"]}
    assert {"negotiation_finalized", "signing_initiated", "contract_executed"}.issubset(activity_actions)

    audit_types = {row.get("event_type") for row in fake.data["signing_audit_log"]}
    assert {"session_created", "signer_viewed", "signer_signed", "session_completed"}.issubset(audit_types)

    print("E2E mock signing flow passed.")
    print(json.dumps({
        "contract_status": final_contract["status"],
        "session_status": final_session["status"],
        "obligations_active": len(obligations),
        "tasks_created": len(created_tasks),
        "matter_total_contract_value": matter["total_contract_value"],
        "signed_document_path": final_session.get("signed_document_path"),
    }, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
