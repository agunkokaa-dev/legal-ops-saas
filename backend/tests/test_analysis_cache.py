import asyncio
import json
import unittest
from unittest.mock import patch

from app import analysis_cache


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.set_calls = []

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, ex=None):
        self.values[key] = value
        self.set_calls.append((key, value, ex))


class AnalysisCacheTests(unittest.TestCase):
    def test_build_cache_key_includes_tenant_and_hashes_document(self):
        key_a = analysis_cache.build_cache_key("tenant-a", "workflow", "same text")
        key_b = analysis_cache.build_cache_key("tenant-b", "workflow", "same text")

        self.assertIn("tenant:tenant-a", key_a)
        self.assertIn("tenant:tenant-b", key_b)
        self.assertNotEqual(key_a, key_b)
        self.assertNotIn("same text", key_a)

    def test_sync_cache_roundtrip(self):
        fake = FakeRedis()

        with patch.object(analysis_cache, "get_redis_sync", return_value=fake):
            analysis_cache.set_cached_analysis_sync("key", {"ok": True})

            self.assertEqual(analysis_cache.get_cached_analysis_sync("key"), {"ok": True})
            self.assertEqual(fake.set_calls[0][2], analysis_cache.CACHE_TTL_SECONDS)

    def test_sync_cache_ignores_invalid_json(self):
        fake = FakeRedis()
        fake.values["bad"] = "{"

        with patch.object(analysis_cache, "get_redis_sync", return_value=fake):
            self.assertIsNone(analysis_cache.get_cached_analysis_sync("bad"))

    def test_async_cache_roundtrip(self):
        class AsyncFakeRedis(FakeRedis):
            async def get(self, key):
                return self.values.get(key)

            async def set(self, key, value, ex=None):
                self.values[key] = value
                self.set_calls.append((key, value, ex))

        fake = AsyncFakeRedis()

        async def fake_get_redis():
            return fake

        async def run():
            with patch.object(analysis_cache, "get_redis", fake_get_redis):
                await analysis_cache.set_cached_analysis("key", {"nested": {"value": 1}})
                self.assertEqual(json.loads(fake.values["key"]), {"nested": {"value": 1}})
                self.assertEqual(
                    await analysis_cache.get_cached_analysis("key"),
                    {"nested": {"value": 1}},
                )

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
