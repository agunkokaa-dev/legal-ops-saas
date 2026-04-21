import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.routers import negotiation


class FakeQuery:
    def __init__(self, client: "FakeSupabase", table_name: str):
        self.client = client
        self.table_name = table_name
        self._operation = "select"
        self._payload = None
        self._filters: list[tuple[str, str, object]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None
        self._select_fields = "*"

    def select(self, fields: str = "*"):
        self._operation = "select"
        self._select_fields = fields
        return self

    def insert(self, payload):
        self._operation = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._operation = "update"
        self._payload = payload
        return self

    def eq(self, key: str, value):
        self._filters.append(("eq", key, value))
        return self

    def gt(self, key: str, value):
        self._filters.append(("gt", key, value))
        return self

    def in_(self, key: str, values):
        self._filters.append(("in", key, set(values)))
        return self

    def order(self, key: str, desc: bool = False):
        self._order = (key, desc)
        return self

    def limit(self, count: int):
        self._limit = count
        return self

    def _filtered_rows(self) -> list[dict]:
        rows = [dict(row) for row in self.client.tables.get(self.table_name, [])]
        for operator, key, value in self._filters:
            if operator == "eq":
                rows = [row for row in rows if row.get(key) == value]
            elif operator == "gt":
                rows = [row for row in rows if (row.get(key) or 0) > value]
            elif operator == "in":
                rows = [row for row in rows if row.get(key) in value]

        if self._order is not None:
            order_key, desc = self._order
            rows.sort(key=lambda row: row.get(order_key) or "", reverse=desc)

        if self._limit is not None:
            rows = rows[:self._limit]

        return rows

    def _project(self, rows: list[dict]) -> list[dict]:
        if self._select_fields == "*":
            return rows

        keys = [field.strip() for field in self._select_fields.split(",")]
        return [{key: row.get(key) for key in keys} for row in rows]

    def execute(self):
        if self._operation == "select":
            return SimpleNamespace(data=self._project(self._filtered_rows()))

        if self._operation == "insert":
            payload_rows = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            table = self.client.tables.setdefault(self.table_name, [])
            for row in payload_rows:
                table.append(dict(row))
                inserted.append(dict(row))
            return SimpleNamespace(data=inserted)

        if self._operation == "update":
            updated = []
            table = self.client.tables.setdefault(self.table_name, [])
            filters = self._filters
            for row in table:
                matches = True
                for operator, key, value in filters:
                    if operator == "eq" and row.get(key) != value:
                        matches = False
                        break
                    if operator == "in" and row.get(key) not in value:
                        matches = False
                        break
                if not matches:
                    continue
                row.update(dict(self._payload))
                updated.append(dict(row))
            return SimpleNamespace(data=updated)

        raise AssertionError(f"Unsupported operation {self._operation}")


class FakeSupabase:
    def __init__(self, tables: dict[str, list[dict]]):
        self.tables = {name: [dict(row) for row in rows] for name, rows in tables.items()}

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(self, table_name)


def unwrap_async_handler(handler):
    target = handler
    while hasattr(target, "__wrapped__"):
        target = target.__wrapped__
    return target


def test_ensure_negotiation_issues_creates_rows_and_rewrites_diff_ids():
    fake = FakeSupabase({
        "negotiation_issues": [],
    })
    diff_result = {
        "deviations": [
            {
                "deviation_id": "dev-1",
                "title": "Liability cap removed",
                "impact_analysis": "Unlimited downside exposure.",
                "severity": "critical",
                "category": "Modified",
                "v2_coordinates": {"start_char": 10, "end_char": 40},
                "playbook_violation": "Liability cap required.",
            },
            {
                "deviation_id": "dev-2",
                "title": "Termination softened",
                "impact_analysis": "Harder to exit for cause.",
                "severity": "warning",
                "category": "Modified",
            },
        ],
        "batna_fallbacks": [
            {
                "deviation_id": "dev-1",
                "fallback_clause": "Liability is capped at 12 months of fees.",
            }
        ],
        "debate_protocol": {
            "debate_results": [
                {"deviation_id": "dev-2", "debate_triggered": True}
            ]
        },
    }

    stats = negotiation._ensure_negotiation_issues(
        tenant_supabase_client=fake,
        contract_id="contract-1",
        tenant_id="tenant-1",
        version_id="version-2",
        diff_result=diff_result,
    )

    assert stats["created_count"] == 2
    assert len(fake.tables["negotiation_issues"]) == 2

    issue_ids_by_finding = {
        row["finding_id"]: row["id"]
        for row in fake.tables["negotiation_issues"]
    }
    assert diff_result["deviations"][0]["deviation_id"] == issue_ids_by_finding["dev-1"]
    assert diff_result["deviations"][1]["deviation_id"] == issue_ids_by_finding["dev-2"]
    assert diff_result["batna_fallbacks"][0]["deviation_id"] == issue_ids_by_finding["dev-1"]
    assert diff_result["debate_protocol"]["debate_results"][0]["deviation_id"] == issue_ids_by_finding["dev-2"]

    created_issue = next(
        row for row in fake.tables["negotiation_issues"]
        if row["finding_id"] == "dev-1"
    )
    assert created_issue["suggested_revision"] == "Liability is capped at 12 months of fees."
    assert created_issue["reasoning_log"][0]["action"] == "open"


def test_ensure_negotiation_issues_is_idempotent_and_reuses_existing_rows():
    fake = FakeSupabase({
        "negotiation_issues": [
            {
                "id": "issue-1",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_id": "version-2",
                "finding_id": "dev-1",
                "created_at": "2026-04-16T00:00:00+00:00",
            },
            {
                "id": "issue-2",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_id": "version-2",
                "finding_id": "dev-2",
                "created_at": "2026-04-16T00:00:01+00:00",
            },
        ],
    })
    diff_result = {
        "deviations": [
            {"deviation_id": "dev-1", "title": "Legacy finding id"},
            {"deviation_id": "issue-2", "title": "Already canonical"},
        ],
        "batna_fallbacks": [{"deviation_id": "dev-1", "fallback_clause": "Fallback"}],
        "debate_protocol": {"debate_results": [{"deviation_id": "issue-2"}]},
    }

    stats = negotiation._ensure_negotiation_issues(
        tenant_supabase_client=fake,
        contract_id="contract-1",
        tenant_id="tenant-1",
        version_id="version-2",
        diff_result=diff_result,
    )

    assert stats["created_count"] == 0
    assert len(fake.tables["negotiation_issues"]) == 2
    assert [item["deviation_id"] for item in diff_result["deviations"]] == ["issue-1", "issue-2"]
    assert diff_result["batna_fallbacks"][0]["deviation_id"] == "issue-1"


def test_list_negotiation_issues_filters_to_active_version_issue_ids():
    fake = FakeSupabase({
        "contract_versions": [
            {
                "id": "version-2",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "pipeline_output": {
                    "diff_result": {
                        "deviations": [
                            {"deviation_id": "issue-1"},
                            {"deviation_id": "issue-2"},
                        ]
                    }
                },
            }
        ],
        "negotiation_issues": [
            {
                "id": "issue-1",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_id": "version-2",
                "finding_id": "dev-1",
                "title": "Current issue",
                "status": "open",
                "severity": "warning",
                "linked_task_id": "task-1",
                "created_at": "2026-04-16T00:00:01+00:00",
            },
            {
                "id": "issue-2",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_id": "version-2",
                "finding_id": "dev-2",
                "title": "Current issue 2",
                "status": "under_review",
                "severity": "critical",
                "created_at": "2026-04-16T00:00:02+00:00",
            },
            {
                "id": "issue-old-1",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_id": "version-2",
                "finding_id": "dev-1",
                "title": "Orphan issue",
                "status": "open",
                "severity": "warning",
                "created_at": "2026-04-15T00:00:00+00:00",
            },
        ],
        "tasks": [
            {"id": "task-1", "tenant_id": "tenant-1", "status": "done"}
        ],
    })

    list_issues = unwrap_async_handler(negotiation.list_negotiation_issues)
    response = asyncio.run(list_issues(
        request=MagicMock(),
        contract_id="contract-1",
        version_id="version-2",
        claims={"verified_tenant_id": "tenant-1"},
        supabase=fake,
    ))

    assert response["total_issues"] == 2
    returned_ids = {issue["id"] for issue in response["issues"]}
    assert returned_ids == {"issue-1", "issue-2"}

    first_issue = next(issue for issue in response["issues"] if issue["id"] == "issue-1")
    assert first_issue["deviation_id"] == "issue-1"
    assert first_issue["linked_task_status"] == "done"


def test_list_negotiation_issues_falls_back_to_tenant_admin_client(monkeypatch):
    request_fake = FakeSupabase({
        "contract_versions": [],
        "negotiation_issues": [],
    })
    admin_fake = FakeSupabase({
        "contract_versions": [
            {
                "id": "version-2",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "pipeline_output": {
                    "diff_result": {
                        "deviations": [{"deviation_id": "issue-1"}]
                    }
                },
            }
        ],
        "negotiation_issues": [
            {
                "id": "issue-1",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_id": "version-2",
                "finding_id": "legacy-1",
                "title": "Current issue",
                "status": "open",
                "severity": "warning",
                "created_at": "2026-04-16T00:00:01+00:00",
            }
        ],
    })
    monkeypatch.setattr(negotiation, "get_tenant_admin_supabase", lambda tenant_id: admin_fake)

    list_issues = unwrap_async_handler(negotiation.list_negotiation_issues)
    response = asyncio.run(list_issues(
        request=MagicMock(),
        contract_id="contract-1",
        version_id="version-2",
        claims={"verified_tenant_id": "tenant-1"},
        supabase=request_fake,
    ))

    assert response["total_issues"] == 1
    assert response["issues"][0]["id"] == "issue-1"


def test_update_issue_status_falls_back_to_tenant_admin_client(monkeypatch):
    request_fake = FakeSupabase({
        "negotiation_issues": [],
        "negotiation_rounds": [],
        "contract_versions": [],
    })
    admin_fake = FakeSupabase({
        "negotiation_issues": [
            {
                "id": "issue-1",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_id": "version-2",
                "finding_id": "legacy-1",
                "title": "Current issue",
                "status": "open",
                "severity": "warning",
                "reasoning_log": [],
                "created_at": "2026-04-16T00:00:01+00:00",
            }
        ],
        "negotiation_rounds": [],
        "contract_versions": [],
        "activity_logs": [],
    })

    async def noop_publish(*args, **kwargs):
        return None

    monkeypatch.setattr(negotiation, "get_tenant_admin_supabase", lambda tenant_id: admin_fake)
    monkeypatch.setattr(negotiation, "publish_negotiation_event", noop_publish)

    update_issue = unwrap_async_handler(negotiation.update_issue_status)
    response = asyncio.run(update_issue(
        request=MagicMock(),
        contract_id="contract-1",
        issue_id="issue-1",
        payload=negotiation.UpdateIssueStatusRequest(
            status="countered",
            reason="Countered with BATNA fallback",
            actor="User",
        ),
        claims={"verified_tenant_id": "tenant-1", "sub": "user-1"},
        supabase=request_fake,
    ))

    assert response["status"] == "success"
    assert admin_fake.tables["negotiation_issues"][0]["status"] == "countered"


def test_get_smart_diff_returns_requested_version_when_version_id_is_provided():
    fake = FakeSupabase({
        "contract_versions": [
            {
                "id": "version-1",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "version_number": 1,
                "pipeline_output": {
                    "diff_result": {
                        "deviations": [{"deviation_id": "issue-1"}],
                        "summary": "Version 1 diff",
                    }
                },
            },
            {
                "id": "version-2",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "version_number": 2,
                "pipeline_output": {
                    "diff_result": {
                        "deviations": [{"deviation_id": "issue-2"}],
                        "summary": "Version 2 diff",
                    }
                },
            },
        ],
    })

    get_diff = unwrap_async_handler(negotiation.get_smart_diff)
    response = asyncio.run(get_diff(
        request=MagicMock(),
        contract_id="contract-1",
        version_id="version-1",
        claims={"verified_tenant_id": "tenant-1"},
        supabase=fake,
    ))

    assert response["summary"] == "Version 1 diff"
    assert response["deviations"][0]["deviation_id"] == "issue-1"
