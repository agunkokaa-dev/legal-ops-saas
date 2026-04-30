import unittest

from app.review_schemas import (
    ReviewFinding,
    assess_pipeline_output_quality,
    create_sentinel_finding,
    resolve_contract_status,
)


class EmptyOutputGuardTests(unittest.TestCase):
    def test_all_agents_empty_returns_quality_empty(self):
        quality, sentinels = assess_pipeline_output_quality({})

        self.assertEqual(quality.value, "empty")
        self.assertEqual(len(sentinels), 4)

    def test_partial_agents_empty_returns_quality_partial(self):
        quality, sentinels = assess_pipeline_output_quality({
            "compliance_findings_v2": [{"issue": "Missing clause"}],
            "risk_score": 42,
            "risk_flags_v2": [{"flag": "Liability cap missing"}],
            "draft_revisions_v2": [{"original_issue": "Revise payment term"}],
        })

        self.assertEqual(quality.value, "partial")
        self.assertGreaterEqual(len(sentinels), 1)

    def test_all_agents_populated_returns_quality_complete(self):
        quality, sentinels = assess_pipeline_output_quality({
            "compliance_findings_v2": [{"issue": "Missing clause"}],
            "risk_score": 42,
            "risk_flags_v2": [{"flag": "Liability cap missing"}],
            "draft_revisions_v2": [{"original_issue": "Revise payment term"}],
            "obligations_v2": [{"description": "Pay invoice"}],
            "classified_clauses_v2": [{"clause_type": "Termination"}],
        })

        self.assertEqual(quality.value, "complete")
        self.assertEqual(sentinels, [])

    def test_sentinel_finding_format(self):
        sentinel = create_sentinel_finding(
            "Compliance Agent",
            "Analisis kepatuhan tidak menghasilkan temuan.",
        )

        parsed = ReviewFinding(**sentinel)
        self.assertEqual(parsed.category, "system_warning")
        self.assertEqual(parsed.severity, "warning")
        self.assertIsNone(parsed.coordinates)
        self.assertTrue(parsed.is_sentinel)

    def test_empty_pipeline_sets_review_incomplete_status(self):
        self.assertEqual(resolve_contract_status("empty"), "Review_Incomplete")

    def test_partial_pipeline_still_sets_reviewed_status(self):
        self.assertEqual(resolve_contract_status("partial"), "Reviewed")

    def test_sentinel_findings_prepended_to_findings(self):
        _quality, sentinels = assess_pipeline_output_quality({})
        regular_finding = ReviewFinding(
            severity="warning",
            category="Risk",
            title="Regular Finding",
            description="Normal finding",
        ).model_dump()

        combined = sentinels + [regular_finding]

        self.assertTrue(combined[0]["is_sentinel"])
        self.assertEqual(combined[-1]["title"], "Regular Finding")

    def test_rerun_clears_previous_sentinels(self):
        first_quality, first_sentinels = assess_pipeline_output_quality({})
        second_quality, second_sentinels = assess_pipeline_output_quality({
            "compliance_findings_v2": [{"issue": "Missing clause"}],
            "risk_score": 42,
            "risk_flags_v2": [{"flag": "Liability cap missing"}],
            "draft_revisions_v2": [{"original_issue": "Revise payment term"}],
            "obligations_v2": [{"description": "Pay invoice"}],
            "classified_clauses_v2": [{"clause_type": "Termination"}],
        })

        self.assertEqual(first_quality.value, "empty")
        self.assertGreater(len(first_sentinels), 0)
        self.assertEqual(second_quality.value, "complete")
        self.assertEqual(second_sentinels, [])


if __name__ == "__main__":
    unittest.main()
