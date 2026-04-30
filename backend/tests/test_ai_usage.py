from types import SimpleNamespace
import unittest

from app.ai_usage import estimate_cost, extract_anthropic_usage, extract_openai_usage, log_ai_usage_sync


class FakeTable:
    def __init__(self):
        self.rows = []

    def insert(self, payload):
        self.rows.append(payload)
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeSupabase:
    def __init__(self):
        self.table_obj = FakeTable()

    def table(self, name):
        assert name == "ai_usage_events"
        return self.table_obj


class AIUsageTests(unittest.TestCase):
    def test_estimate_cost_known_model(self):
        self.assertEqual(estimate_cost("gpt-4o-mini", 1000, 500), 0.00045)

    def test_extract_usage_helpers(self):
        openai_response = SimpleNamespace(usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5))
        anthropic_response = SimpleNamespace(usage=SimpleNamespace(input_tokens=7, output_tokens=3))

        self.assertEqual(extract_openai_usage(openai_response), (10, 5))
        self.assertEqual(extract_anthropic_usage(anthropic_response), (7, 3))

    def test_log_ai_usage_sync_writes_payload(self):
        fake = FakeSupabase()

        log_ai_usage_sync(
            fake,
            "tenant-1",
            "ingestion",
            "gpt-4o-mini",
            100,
            50,
            123,
            contract_id="00000000-0000-0000-0000-000000000001",
            cache_hit=True,
            metadata={"source": "test"},
        )

        row = fake.table_obj.rows[0]
        self.assertEqual(row["tenant_id"], "tenant-1")
        self.assertEqual(row["workflow"], "ingestion")
        self.assertIs(row["cache_hit"], True)
        self.assertEqual(row["metadata"], {"source": "test"})

    def test_log_ai_usage_sync_skips_missing_tenant(self):
        fake = FakeSupabase()

        log_ai_usage_sync(fake, None, "ingestion", "gpt-4o-mini", 1, 1, 1)

        self.assertEqual(fake.table_obj.rows, [])


if __name__ == "__main__":
    unittest.main()
