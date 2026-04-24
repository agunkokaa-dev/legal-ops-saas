import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.routers import sse


def unwrap_async_handler(handler):
    target = handler
    while hasattr(target, "__wrapped__"):
        target = target.__wrapped__
    return target


def make_request(path: str):
    return SimpleNamespace(url=SimpleNamespace(path=path))


class FakeQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class FakeSupabase:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def table(self, _table_name: str):
        return FakeQuery(self._rows)


@pytest.mark.asyncio
async def test_tenant_stream_accepts_sse_session_and_invalidates_on_close(monkeypatch):
    tenant_handler = unwrap_async_handler(sse.stream_tenant_events)
    mock_redis = object()
    invalidate_mock = AsyncMock()
    queue: asyncio.Queue = asyncio.Queue()

    monkeypatch.setattr(sse, "_get_sse_session_redis", AsyncMock(return_value=mock_redis))
    monkeypatch.setattr(
        sse,
        "validate_sse_session",
        AsyncMock(return_value={"tenant_id": "tenant-1", "issued_at": 0}),
    )
    monkeypatch.setattr(sse, "invalidate_sse_session", invalidate_mock)
    monkeypatch.setattr(sse.event_bus, "subscribe_tenant", MagicMock(return_value=queue))
    monkeypatch.setattr(sse.event_bus, "unsubscribe_tenant", MagicMock())

    response = await tenant_handler(
        request=make_request("/api/v1/events/tenant/stream"),
        sse_token="a" * 64,
        token=None,
    )

    first_chunk = await anext(response.body_iterator)
    assert "Tenant SSE connection established" in first_chunk

    await response.body_iterator.aclose()
    invalidate_mock.assert_awaited_once_with(mock_redis, "a" * 64)


@pytest.mark.asyncio
async def test_tenant_stream_legacy_query_token_still_works(monkeypatch):
    tenant_handler = unwrap_async_handler(sse.stream_tenant_events)
    invalidate_mock = AsyncMock()
    queue: asyncio.Queue = asyncio.Queue()

    monkeypatch.setattr(
        sse,
        "verify_sse_token",
        MagicMock(return_value={"verified_tenant_id": "tenant-legacy"}),
    )
    monkeypatch.setattr(sse, "invalidate_sse_session", invalidate_mock)
    monkeypatch.setattr(sse.event_bus, "subscribe_tenant", MagicMock(return_value=queue))
    monkeypatch.setattr(sse.event_bus, "unsubscribe_tenant", MagicMock())

    response = await tenant_handler(
        request=make_request("/api/v1/events/tenant/stream"),
        sse_token=None,
        token="legacy-jwt",
    )

    first_chunk = await anext(response.body_iterator)
    assert "Tenant SSE connection established" in first_chunk

    await response.body_iterator.aclose()
    invalidate_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_contract_stream_new_path_uses_tenant_admin_client(monkeypatch):
    contract_handler = unwrap_async_handler(sse.stream_contract_events)
    mock_redis = object()
    invalidate_mock = AsyncMock()
    queue: asyncio.Queue = asyncio.Queue()
    tenant_supabase = FakeSupabase([
        {
            "id": "contract-1",
            "tenant_id": "tenant-1",
            "title": "Contract 1",
            "status": "Reviewed",
        }
    ])
    legacy_client_mock = MagicMock(side_effect=AssertionError("legacy RLS client should not be used"))

    monkeypatch.setattr(sse, "_get_sse_session_redis", AsyncMock(return_value=mock_redis))
    monkeypatch.setattr(
        sse,
        "validate_sse_session",
        AsyncMock(return_value={"tenant_id": "tenant-1", "issued_at": 0}),
    )
    monkeypatch.setattr(sse, "invalidate_sse_session", invalidate_mock)
    monkeypatch.setattr(sse, "get_tenant_admin_supabase", MagicMock(return_value=tenant_supabase))
    monkeypatch.setattr(sse, "_create_rls_supabase_client", legacy_client_mock)
    monkeypatch.setattr(sse.event_bus, "subscribe_contract", MagicMock(return_value=queue))
    monkeypatch.setattr(sse.event_bus, "unsubscribe_contract", MagicMock())

    response = await contract_handler(
        request=make_request("/api/v1/events/contracts/contract-1/stream"),
        contract_id="contract-1",
        sse_token="b" * 64,
        token=None,
    )

    first_chunk = await anext(response.body_iterator)
    assert "SSE connection established" in first_chunk
    assert "contract-1" in first_chunk

    await response.body_iterator.aclose()
    legacy_client_mock.assert_not_called()
    invalidate_mock.assert_awaited_once_with(mock_redis, "b" * 64)
