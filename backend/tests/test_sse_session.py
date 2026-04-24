import json
import time
from unittest.mock import AsyncMock

import pytest

from app.sse_session import (
    SSE_TOKEN_LENGTH,
    SSE_TOKEN_PREFIX,
    create_sse_session,
    invalidate_sse_session,
    validate_sse_session,
)


@pytest.mark.asyncio
class TestCreateSSESession:
    async def test_returns_correct_length_token(self):
        mock_redis = AsyncMock()
        token = await create_sse_session(mock_redis, "tenant_123")
        assert len(token) == SSE_TOKEN_LENGTH * 2
        assert all(char in "0123456789abcdef" for char in token)

    async def test_stores_tenant_id_in_redis(self):
        mock_redis = AsyncMock()
        token = await create_sse_session(mock_redis, "tenant_abc")
        args = mock_redis.set.call_args
        assert args[0][0] == f"{SSE_TOKEN_PREFIX}{token}"
        stored = json.loads(args[0][1])
        assert stored["tenant_id"] == "tenant_abc"
        assert args[1]["ex"] == 300

    async def test_stores_contract_id_when_provided(self):
        mock_redis = AsyncMock()
        await create_sse_session(mock_redis, "tenant_abc", "contract_xyz")
        stored = json.loads(mock_redis.set.call_args[0][1])
        assert stored["contract_id"] == "contract_xyz"

    async def test_rejects_empty_tenant_id(self):
        with pytest.raises(ValueError):
            await create_sse_session(AsyncMock(), "")

    async def test_rejects_none_tenant_id(self):
        with pytest.raises(ValueError):
            await create_sse_session(AsyncMock(), None)  # type: ignore[arg-type]

    async def test_tokens_are_unique(self):
        mock_redis = AsyncMock()
        tokens = {await create_sse_session(mock_redis, "tenant_abc") for _ in range(10)}
        assert len(tokens) == 10


@pytest.mark.asyncio
class TestValidateSSESession:
    async def test_valid_token_returns_payload(self):
        mock_redis = AsyncMock()
        payload = json.dumps({"tenant_id": "tenant_xyz", "issued_at": time.time()})
        mock_redis.get.return_value = payload
        result = await validate_sse_session(mock_redis, "a" * 64)
        assert result["tenant_id"] == "tenant_xyz"

    async def test_expired_returns_none(self):
        mock_redis = AsyncMock()
        mock_redis.get.return_value = None
        assert await validate_sse_session(mock_redis, "a" * 64) is None

    async def test_wrong_length_returns_none_without_redis_call(self):
        mock_redis = AsyncMock()
        assert await validate_sse_session(mock_redis, "short") is None
        mock_redis.get.assert_not_called()

    async def test_empty_token_returns_none(self):
        mock_redis = AsyncMock()
        assert await validate_sse_session(mock_redis, "") is None

    async def test_payload_with_contract_id(self):
        mock_redis = AsyncMock()
        payload = json.dumps({
            "tenant_id": "tenant_abc",
            "contract_id": "contract_xyz",
            "issued_at": time.time(),
        })
        mock_redis.get.return_value = payload
        result = await validate_sse_session(mock_redis, "b" * 64)
        assert result["contract_id"] == "contract_xyz"


@pytest.mark.asyncio
class TestInvalidateSSESession:
    async def test_deletes_correct_key(self):
        mock_redis = AsyncMock()
        token = "c" * 64
        await invalidate_sse_session(mock_redis, token)
        mock_redis.delete.assert_called_once_with(f"{SSE_TOKEN_PREFIX}{token}")

    async def test_handles_redis_error_gracefully(self):
        mock_redis = AsyncMock()
        mock_redis.delete.side_effect = Exception("Redis error")
        await invalidate_sse_session(mock_redis, "d" * 64)

    async def test_empty_token_is_no_op(self):
        mock_redis = AsyncMock()
        await invalidate_sse_session(mock_redis, "")
        mock_redis.delete.assert_not_called()
