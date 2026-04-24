import asyncio
import unittest
from types import SimpleNamespace

from app.services.v3_builder import build_v3_merged_text


class FakeQuery:
    def __init__(self, client: "FakeSupabase", table_name: str):
        self.client = client
        self.table_name = table_name
        self._filters: list[tuple[str, str, object]] = []
        self._order: tuple[str, bool] | None = None
        self._select_fields = "*"

    def select(self, fields: str = "*"):
        self._select_fields = fields
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

    def _filtered_rows(self) -> list[dict]:
        rows = [dict(row) for row in self.client.tables.get(self.table_name, [])]
        for operator, key, value in self._filters:
            if operator == "eq":
                rows = [row for row in rows if row.get(key) == value]
            elif operator == "gt":
                rows = [row for row in rows if (row.get(key) or 0) > value]

        if self._order is not None:
            order_key, desc = self._order
            rows.sort(key=lambda row: row.get(order_key) or "", reverse=desc)

        return rows

    def _project(self, rows: list[dict]) -> list[dict]:
        if self._select_fields == "*":
            return rows
        keys = [field.strip() for field in self._select_fields.split(",")]
        return [{key: row.get(key) for key in keys} for row in rows]

    def execute(self):
        return SimpleNamespace(data=self._project(self._filtered_rows()))


class FakeSupabase:
    def __init__(self, tables: dict[str, list[dict]]):
        self.tables = {name: [dict(row) for row in rows] for name, rows in tables.items()}

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(self, table_name)


def coords_for(text: str, snippet: str) -> dict[str, object]:
    start = text.index(snippet)
    end = start + len(snippet)
    return {"start_char": start, "end_char": end, "source_text": snippet}


def make_deviation(
    *,
    deviation_id: str,
    title: str,
    v1_text: str,
    v2_text: str,
    v2_coordinates: dict[str, object] | None,
    category: str = "Modified",
    severity: str = "warning",
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


class V3BuilderTests(unittest.TestCase):
    maxDiff = None

    def make_supabase(
        self,
        *,
        v1_text: str,
        v2_text: str,
        deviations: list[dict],
        issues: list[dict],
        batna_fallbacks: list[dict] | None = None,
    ) -> FakeSupabase:
        return FakeSupabase({
            "contract_versions": [
                {
                    "id": "version-1",
                    "tenant_id": "tenant-1",
                    "contract_id": "contract-1",
                    "version_number": 1,
                    "raw_text": v1_text,
                    "uploaded_filename": "V1.md",
                    "pipeline_output": {},
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
                            "deviations": deviations,
                            "batna_fallbacks": batna_fallbacks or [],
                            "risk_delta": 5.0,
                            "summary": "Test diff summary.",
                        }
                    },
                },
            ],
            "negotiation_issues": issues,
        })

    def build(self, supabase: FakeSupabase) -> tuple[str, dict]:
        return asyncio.run(build_v3_merged_text("contract-1", "tenant-1", supabase))

    def test_all_accepted_returns_v2_unchanged(self):
        v1_text = "Payment due in 30 days."
        v2_text = "Payment due in 45 days."
        deviation = make_deviation(
            deviation_id="issue-1",
            title="Payment term extended",
            v1_text=v1_text,
            v2_text=v2_text,
            v2_coordinates=coords_for(v2_text, v2_text),
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation],
            issues=[{
                "id": "issue-1",
                "finding_id": "dev-1",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "version_id": "version-2",
                "status": "accepted",
            }],
        )

        merged_text, summary = self.build(supabase)
        self.assertEqual(merged_text, v2_text)
        self.assertEqual(summary["accepted"], 1)
        self.assertEqual(summary["applied_changes"], 0)

    def test_all_rejected_returns_v1_for_those_segments(self):
        v1_text = "Payment due in 30 days."
        v2_text = "Payment due in 45 days."
        deviation = make_deviation(
            deviation_id="issue-1",
            title="Payment term extended",
            v1_text=v1_text,
            v2_text=v2_text,
            v2_coordinates=coords_for(v2_text, v2_text),
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation],
            issues=[{
                "id": "issue-1",
                "finding_id": "dev-1",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "version_id": "version-2",
                "status": "rejected",
            }],
        )

        merged_text, summary = self.build(supabase)
        self.assertEqual(merged_text, v1_text)
        self.assertEqual(summary["rejected"], 1)
        self.assertEqual(summary["rejected_replacements"], 1)

    def test_countered_uses_batna_fallback(self):
        v1_text = "Vendor liability cap is 12 months of fees."
        v2_text = "Vendor liability is unlimited."
        fallback = "Vendor liability cap is 18 months of fees."
        deviation = make_deviation(
            deviation_id="issue-1",
            title="Liability cap removed",
            v1_text=v1_text,
            v2_text=v2_text,
            v2_coordinates=coords_for(v2_text, v2_text),
            severity="critical",
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation],
            issues=[{
                "id": "issue-1",
                "finding_id": "dev-1",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "version_id": "version-2",
                "status": "countered",
                "suggested_revision": fallback,
            }],
            batna_fallbacks=[
                make_batna_fallback(
                    deviation_id="issue-1",
                    fallback_clause=fallback,
                )
            ],
        )

        merged_text, summary = self.build(supabase)
        self.assertEqual(merged_text, fallback)
        self.assertEqual(summary["countered"], 1)
        self.assertEqual(summary["countered_replacements"], 1)

    def test_reverse_order_prevents_coordinate_shift(self):
        v1_text = "Alpha short. Beta short."
        v2_text = "Alpha long. Beta long."
        deviation_a = make_deviation(
            deviation_id="issue-a",
            title="Alpha changed",
            v1_text="Alpha short.",
            v2_text="Alpha long.",
            v2_coordinates=coords_for(v2_text, "Alpha long."),
        )
        deviation_b = make_deviation(
            deviation_id="issue-b",
            title="Beta changed",
            v1_text="Beta short.",
            v2_text="Beta long.",
            v2_coordinates=coords_for(v2_text, "Beta long."),
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation_a, deviation_b],
            issues=[
                {
                    "id": "issue-a",
                    "finding_id": "dev-a",
                    "contract_id": "contract-1",
                    "tenant_id": "tenant-1",
                    "version_id": "version-2",
                    "status": "countered",
                    "suggested_revision": "Alpha replacement with much longer text.",
                },
                {
                    "id": "issue-b",
                    "finding_id": "dev-b",
                    "contract_id": "contract-1",
                    "tenant_id": "tenant-1",
                    "version_id": "version-2",
                    "status": "rejected",
                },
            ],
            batna_fallbacks=[
                make_batna_fallback(
                    deviation_id="issue-a",
                    fallback_clause="Alpha replacement with much longer text.",
                )
            ],
        )

        merged_text, _ = self.build(supabase)
        self.assertEqual(merged_text, "Alpha replacement with much longer text. Beta short.")

    def test_deterministic_same_input_same_output(self):
        v1_text = "Termination requires 30 days notice."
        v2_text = "Termination requires 60 days notice."
        deviation = make_deviation(
            deviation_id="issue-1",
            title="Termination notice increased",
            v1_text=v1_text,
            v2_text=v2_text,
            v2_coordinates=coords_for(v2_text, v2_text),
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation],
            issues=[{
                "id": "issue-1",
                "finding_id": "dev-1",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "version_id": "version-2",
                "status": "rejected",
            }],
        )

        first = self.build(supabase)
        second = self.build(supabase)
        self.assertEqual(first, second)

    def test_handles_deviation_without_coordinates(self):
        v1_text = "Governing law is Indonesia."
        v2_text = "Governing law is Singapore."
        deviation = make_deviation(
            deviation_id="issue-1",
            title="Governing law changed",
            v1_text=v1_text,
            v2_text=v2_text,
            v2_coordinates=None,
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation],
            issues=[{
                "id": "issue-1",
                "finding_id": "dev-1",
                "contract_id": "contract-1",
                "tenant_id": "tenant-1",
                "version_id": "version-2",
                "status": "rejected",
            }],
        )

        merged_text, summary = self.build(supabase)
        self.assertEqual(merged_text, v2_text)
        self.assertEqual(summary["skipped_missing_coordinates"], 1)

    def test_empty_issues_returns_v2_unchanged(self):
        v1_text = "Services begin on 1 May."
        v2_text = "Services begin on 15 May."
        deviation = make_deviation(
            deviation_id="issue-1",
            title="Start date changed",
            v1_text=v1_text,
            v2_text=v2_text,
            v2_coordinates=coords_for(v2_text, v2_text),
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation],
            issues=[],
        )

        merged_text, summary = self.build(supabase)
        self.assertEqual(merged_text, v2_text)
        self.assertEqual(summary["open"], 1)
        self.assertEqual(summary["applied_changes"], 0)

    def test_filters_stale_issue_rows_and_matches_by_title(self):
        v1_text = "Specification A. Payment in 30 days."
        v2_text = "Specification B. Payment in 45 days."
        deviation_a = make_deviation(
            deviation_id="active-dev-a",
            title="Specification Expansion",
            v1_text="Specification A.",
            v2_text="Specification B.",
            v2_coordinates=coords_for(v2_text, "Specification B."),
        )
        deviation_b = make_deviation(
            deviation_id="active-dev-b",
            title="Payment Milestones Added",
            v1_text="Payment in 30 days.",
            v2_text="Payment in 45 days.",
            v2_coordinates=coords_for(v2_text, "Payment in 45 days."),
        )
        supabase = self.make_supabase(
            v1_text=v1_text,
            v2_text=v2_text,
            deviations=[deviation_a, deviation_b],
            issues=[
                {
                    "id": "legacy-1",
                    "finding_id": "001",
                    "title": "Project Schedule Defined",
                    "contract_id": "contract-1",
                    "tenant_id": "tenant-1",
                    "version_id": "version-2",
                    "status": "open",
                },
                {
                    "id": "legacy-2",
                    "finding_id": "002",
                    "title": "Scope of Work Expanded",
                    "contract_id": "contract-1",
                    "tenant_id": "tenant-1",
                    "version_id": "version-2",
                    "status": "under_review",
                },
                {
                    "id": "issue-a",
                    "finding_id": "11",
                    "title": "Specification Expansion",
                    "contract_id": "contract-1",
                    "tenant_id": "tenant-1",
                    "version_id": "version-2",
                    "status": "accepted",
                },
                {
                    "id": "issue-b",
                    "finding_id": "12",
                    "title": "Payment Milestones Added",
                    "contract_id": "contract-1",
                    "tenant_id": "tenant-1",
                    "version_id": "version-2",
                    "status": "rejected",
                },
            ],
        )

        merged_text, summary = self.build(supabase)
        self.assertEqual(merged_text, "Specification B. Payment in 30 days.")
        self.assertEqual(summary["accepted"], 1)
        self.assertEqual(summary["rejected"], 1)
        self.assertEqual(summary["open"], 0)
        self.assertEqual(summary["under_review"], 0)


if __name__ == "__main__":
    unittest.main()
