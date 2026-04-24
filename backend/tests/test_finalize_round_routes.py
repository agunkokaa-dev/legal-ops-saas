import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.review_schemas import FinalizeRoundRequest
from app.routers import contracts, negotiation


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

    def delete(self):
        self._operation = "delete"
        return self

    def eq(self, key: str, value):
        self._filters.append(("eq", key, value))
        return self

    def gt(self, key: str, value):
        self._filters.append(("gt", key, value))
        return self

    def order(self, key: str, desc: bool = False):
        self._order = (key, desc)
        return self

    def limit(self, count: int):
        self._limit = count
        return self

    def _matches(self, row: dict) -> bool:
        for operator, key, value in self._filters:
            if operator == "eq" and row.get(key) != value:
                return False
            if operator == "gt" and (row.get(key) or 0) <= value:
                return False
        return True

    def _filtered_rows(self) -> list[dict]:
        rows = [dict(row) for row in self.client.tables.get(self.table_name, [])]
        rows = [row for row in rows if self._matches(row)]
        if self._order is not None:
            key, desc = self._order
            rows.sort(key=lambda row: row.get(key) or "", reverse=desc)
        if self._limit is not None:
            rows = rows[:self._limit]
        return rows

    def _project(self, rows: list[dict]) -> list[dict]:
        if self._select_fields == "*":
            return rows
        keys = [field.strip() for field in self._select_fields.split(",")]
        return [{key: row.get(key) for key in keys} for row in rows]

    def execute(self):
        table = self.client.tables.setdefault(self.table_name, [])

        if self._operation == "select":
            return SimpleNamespace(data=self._project(self._filtered_rows()))

        if self._operation == "insert":
            payload_rows = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for row in payload_rows:
                cloned = dict(row)
                table.append(cloned)
                inserted.append(dict(cloned))
            return SimpleNamespace(data=inserted)

        if self._operation == "update":
            updated = []
            for row in table:
                if not self._matches(row):
                    continue
                row.update(dict(self._payload))
                updated.append(dict(row))
            return SimpleNamespace(data=updated)

        if self._operation == "delete":
            kept = []
            deleted = []
            for row in table:
                if self._matches(row):
                    deleted.append(dict(row))
                else:
                    kept.append(row)
            self.client.tables[self.table_name] = kept
            return SimpleNamespace(data=deleted)

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


def coords_for(text: str, snippet: str) -> dict[str, object]:
    start = text.index(snippet)
    end = start + len(snippet)
    return {"start_char": start, "end_char": end, "source_text": snippet}


def make_deviation(
    *,
    deviation_id: str,
    title: str,
    severity: str,
    v1_text: str,
    v2_text: str,
    v2_coordinates: dict[str, object] | None,
    category: str = "Modified",
    impact_analysis: str | None = None,
) -> dict[str, object]:
    return {
        "deviation_id": deviation_id,
        "title": title,
        "category": category,
        "severity": severity,
        "v1_text": v1_text,
        "v2_text": v2_text,
        "v2_coordinates": v2_coordinates,
        "impact_analysis": impact_analysis or f"Test impact analysis for {title.lower()}.",
    }


def make_batna_fallback(
    *,
    deviation_id: str,
    fallback_clause: str,
    reasoning: str = "Test reasoning for BATNA fallback.",
    leverage_points: list[str] | None = None,
) -> dict[str, object]:
    return {
        "deviation_id": deviation_id,
        "fallback_clause": fallback_clause,
        "reasoning": reasoning,
        "leverage_points": leverage_points or ["Point 1", "Point 2"],
    }


async def read_streaming_body(response) -> bytes:
    return b"".join([chunk async for chunk in response.body_iterator])


class FinalizeRoundRouteTests(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.request = SimpleNamespace()
        self.claims = {"verified_tenant_id": "tenant-1", "sub": "user-1"}
        self.preview_handler = unwrap_async_handler(negotiation.preview_finalize_round)
        self.finalize_handler = unwrap_async_handler(negotiation.finalize_negotiation_round)
        self.export_handler = unwrap_async_handler(contracts.export_contract_version)

    def make_supabase(self, *, contract_status: str = "Reviewed", issues: list[dict], existing_versions: list[dict] | None = None):
        v1_text = (
            "Payment due in 30 days. Liability cap is 12 months of fees. "
            "Confidentiality obligations survive for 3 years after termination. "
            "Each party must maintain commercially reasonable security controls."
        )
        v2_text = (
            "Payment due in 45 days. Liability is unlimited. "
            "Confidentiality obligations survive for 3 years after termination. "
            "Each party must maintain commercially reasonable security controls."
        )
        payment_v2 = "Payment due in 45 days."
        liability_v2 = "Liability is unlimited."

        base_versions = [
            {
                "id": "version-1",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_number": 1,
                "raw_text": v1_text,
                "uploaded_filename": "V1.md",
                "pipeline_output": {},
                "created_at": "2026-04-20T10:00:00+00:00",
            },
            {
                "id": "version-2",
                "tenant_id": "tenant-1",
                "contract_id": "contract-1",
                "version_number": 2,
                "raw_text": v2_text,
                "uploaded_filename": "V2.md",
                "pipeline_output": {
                    "diff_result": {
                        "deviations": [
                            make_deviation(
                                deviation_id="issue-payment",
                                title="Payment term extended",
                                severity="warning",
                                v1_text="Payment due in 30 days.",
                                v2_text=payment_v2,
                                v2_coordinates=coords_for(v2_text, payment_v2),
                            ),
                            make_deviation(
                                deviation_id="issue-liability",
                                title="Liability cap removed",
                                severity="critical",
                                v1_text="Liability cap is 12 months of fees.",
                                v2_text=liability_v2,
                                v2_coordinates=coords_for(v2_text, liability_v2),
                            ),
                        ],
                        "batna_fallbacks": [
                            make_batna_fallback(
                                deviation_id="issue-liability",
                                fallback_clause="Liability cap is 18 months of fees.",
                            )
                        ],
                        "risk_delta": 8.0,
                        "summary": "Test diff summary for finalize round routes.",
                    }
                },
                "risk_score": 54.0,
                "risk_level": "High",
                "created_at": "2026-04-20T11:00:00+00:00",
            },
        ]

        versions = base_versions + list(existing_versions or [])
        return FakeSupabase({
            "contracts": [{
                "id": "contract-1",
                "tenant_id": "tenant-1",
                "title": "Master Services Agreement",
                "matter_id": "matter-1",
                "status": contract_status,
                "latest_version_id": "version-2",
                "version_count": 2,
            }],
            "contract_versions": versions,
            "negotiation_issues": issues,
            "activity_logs": [],
        })

    def run_preview(self, supabase):
        return asyncio.run(self.preview_handler(
            self.request,
            "contract-1",
            self.claims,
            supabase,
        ))

    def run_finalize(self, supabase, body: FinalizeRoundRequest):
        async def _run():
            with patch("app.routers.negotiation.publish_negotiation_event") as publish_mock:
                async def _no_op(*args, **kwargs):
                    return None
                publish_mock.side_effect = _no_op
                return await self.finalize_handler(
                    self.request,
                    "contract-1",
                    body,
                    self.claims,
                    supabase,
                )
        return asyncio.run(_run())

    def test_finalize_preview_returns_correct_counts(self):
        supabase = self.make_supabase(
            issues=[
                {
                    "id": "issue-payment",
                    "finding_id": "dev-payment",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "rejected",
                    "severity": "warning",
                    "title": "Payment term extended",
                },
                {
                    "id": "issue-liability",
                    "finding_id": "dev-liability",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "open",
                    "severity": "critical",
                    "title": "Liability cap removed",
                    "suggested_revision": "Liability cap is 18 months of fees.",
                },
            ],
        )

        preview = self.run_preview(supabase)
        self.assertFalse(preview.can_finalize)
        self.assertEqual(preview.decisions_summary["rejected"], 1)
        self.assertEqual(preview.decisions_summary["open"], 1)
        self.assertEqual(len(preview.blocking_issues), 1)
        self.assertGreater(preview.v2_text_length, 0)

    def test_finalize_with_open_issues_without_allow_partial_fails(self):
        supabase = self.make_supabase(
            issues=[
                {
                    "id": "issue-payment",
                    "finding_id": "dev-payment",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "accepted",
                },
                {
                    "id": "issue-liability",
                    "finding_id": "dev-liability",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "open",
                },
            ],
        )

        with self.assertRaises(HTTPException) as ctx:
            self.run_finalize(supabase, FinalizeRoundRequest(allow_partial=False))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_finalize_with_allow_partial_succeeds(self):
        supabase = self.make_supabase(
            issues=[
                {
                    "id": "issue-payment",
                    "finding_id": "dev-payment",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "rejected",
                },
                {
                    "id": "issue-liability",
                    "finding_id": "dev-liability",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "open",
                    "suggested_revision": "Liability cap is 18 months of fees.",
                },
            ],
        )

        result = self.run_finalize(supabase, FinalizeRoundRequest(allow_partial=True))
        self.assertEqual(result.version_number, 3)
        self.assertEqual(result.next_action, "export_and_send")

    def test_finalize_creates_new_version_with_correct_fields(self):
        supabase = self.make_supabase(
            issues=[
                {
                    "id": "issue-payment",
                    "finding_id": "dev-payment",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "rejected",
                },
                {
                    "id": "issue-liability",
                    "finding_id": "dev-liability",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "countered",
                    "suggested_revision": "Liability cap is 18 months of fees.",
                },
            ],
        )

        self.run_finalize(supabase, FinalizeRoundRequest(allow_partial=False))
        created_version = max(supabase.tables["contract_versions"], key=lambda row: row["version_number"])
        self.assertEqual(created_version["source"], "internal_finalized")
        self.assertEqual(created_version["parent_version_id"], "version-2")
        self.assertEqual(created_version["finalized_by"], "user-1")
        self.assertIn("Finalized", created_version["uploaded_filename"])

    def test_finalize_updates_contract_status_to_awaiting_counterparty(self):
        supabase = self.make_supabase(
            issues=[
                {
                    "id": "issue-payment",
                    "finding_id": "dev-payment",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "rejected",
                },
                {
                    "id": "issue-liability",
                    "finding_id": "dev-liability",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "accepted",
                },
            ],
        )

        result = self.run_finalize(supabase, FinalizeRoundRequest(allow_partial=False))
        contract_row = supabase.tables["contracts"][0]
        self.assertEqual(contract_row["status"], "Awaiting_Counterparty")
        self.assertEqual(contract_row["latest_version_id"], result.version_id)
        self.assertEqual(contract_row["version_count"], 3)

    def test_finalize_is_idempotent_within_10_seconds(self):
        recent_version = {
            "id": "version-3",
            "tenant_id": "tenant-1",
            "contract_id": "contract-1",
            "version_number": 3,
            "raw_text": "Recent finalized text",
            "uploaded_filename": "V3_Finalized_recent.md",
            "pipeline_output": {},
            "source": "internal_finalized",
            "parent_version_id": "version-2",
            "finalized_at": (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat(),
            "finalized_by": "user-1",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        supabase = self.make_supabase(
            contract_status="Awaiting_Counterparty",
            issues=[
                {
                    "id": "issue-payment",
                    "finding_id": "dev-payment",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "rejected",
                },
                {
                    "id": "issue-liability",
                    "finding_id": "dev-liability",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "accepted",
                },
            ],
            existing_versions=[recent_version],
        )

        result = self.run_finalize(supabase, FinalizeRoundRequest(allow_partial=False))
        self.assertEqual(result.version_id, "version-3")
        self.assertEqual(result.decisions_summary["idempotent"], 1)

    def test_finalize_rejects_no_op_change(self):
        supabase = self.make_supabase(
            issues=[
                {
                    "id": "issue-payment",
                    "finding_id": "dev-payment",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "accepted",
                },
                {
                    "id": "issue-liability",
                    "finding_id": "dev-liability",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_id": "version-2",
                    "status": "accepted",
                },
            ],
        )

        with self.assertRaises(HTTPException) as ctx:
            self.run_finalize(supabase, FinalizeRoundRequest(allow_partial=False))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_export_docx_returns_valid_docx_file(self):
        supabase = self.make_supabase(issues=[])

        async def _run():
            with patch("app.routers.contracts._render_docx_bytes", return_value=b"PK\x03\x04mock-docx"):
                response = await self.export_handler(
                    self.request,
                    "contract-1",
                    "version-2",
                    "docx",
                    self.claims,
                    supabase,
                )
                body = await read_streaming_body(response)
                return response, body

        response, body = asyncio.run(_run())
        self.assertEqual(response.media_type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        self.assertTrue(body.startswith(b"PK\x03\x04"))

    def test_export_pdf_returns_valid_pdf_file(self):
        supabase = self.make_supabase(issues=[])

        async def _run():
            with patch("app.routers.contracts._render_pdf_bytes", return_value=b"%PDF-1.4\nmock-pdf"):
                response = await self.export_handler(
                    self.request,
                    "contract-1",
                    "version-2",
                    "pdf",
                    self.claims,
                    supabase,
                )
                body = await read_streaming_body(response)
                return response, body

        response, body = asyncio.run(_run())
        self.assertEqual(response.media_type, "application/pdf")
        self.assertTrue(body.startswith(b"%PDF-1.4"))

    def test_export_rejects_invalid_format(self):
        supabase = self.make_supabase(issues=[])

        async def _run():
            return await self.export_handler(
                self.request,
                "contract-1",
                "version-2",
                "txt",
                self.claims,
                supabase,
            )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_run())
        self.assertEqual(ctx.exception.status_code, 400)

    def test_export_enforces_tenant_isolation(self):
        supabase = FakeSupabase({
            "contracts": [{
                "id": "contract-1",
                "tenant_id": "tenant-2",
                "title": "Other Tenant Contract",
            }],
            "contract_versions": [{
                "id": "version-2",
                "tenant_id": "tenant-2",
                "contract_id": "contract-1",
                "version_number": 2,
                "raw_text": "Other tenant text",
            }],
        })

        async def _run():
            return await self.export_handler(
                self.request,
                "contract-1",
                "version-2",
                "pdf",
                self.claims,
                supabase,
            )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_run())
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
