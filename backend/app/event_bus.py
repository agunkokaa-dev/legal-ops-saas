import asyncio
import json
import os
import uuid
from collections import defaultdict
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel
from redis.asyncio import Redis


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")


@dataclass
class SSEEvent:
    event_type: str
    tenant_id: str
    data: dict
    contract_id: Optional[str] = None
    event_id: str = field(default_factory=lambda: f"evt_{uuid.uuid4().hex[:12]}")
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_payload(self) -> dict:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "contract_id": self.contract_id,
            "tenant_id": self.tenant_id,
            "timestamp": self.timestamp,
            "data": self.data,
        }

    @classmethod
    def from_payload(cls, payload: dict) -> "SSEEvent":
        return cls(
            event_type=payload["event_type"],
            tenant_id=payload["tenant_id"],
            contract_id=payload.get("contract_id"),
            timestamp=payload.get("timestamp", datetime.now(timezone.utc).isoformat()),
            event_id=payload.get("event_id", f"evt_{uuid.uuid4().hex[:12]}"),
            data=payload.get("data") or {},
        )

    def format_sse(self) -> str:
        payload = json.dumps({
            "event_id": self.event_id,
            "event_type": self.event_type,
            "contract_id": self.contract_id,
            "timestamp": self.timestamp,
            "data": self.data,
        }, default=str)
        return "\n".join((
            f"id: {self.event_id}",
            f"event: {self.event_type}",
            f"data: {payload}",
            "",
            "",
        ))


class ContractRoundFinalizedEvent(BaseModel):
    contract_id: str
    tenant_id: str
    version_from: str
    version_to: str
    round_number: int
    finalized_at: str


class EventBus:
    """
    Redis-backed pub/sub bus with in-process fan-out.

    Each process keeps only local subscriber queues. Cross-worker delivery happens
    through Redis tenant channels, and one listener task per tenant fans messages
    back into the local queues for connected SSE clients on that worker.
    """

    def __init__(self, redis_url: str = REDIS_URL, keepalive_interval: float = 15.0, queue_size: int = 100):
        self._redis_url = redis_url
        self._keepalive_interval = keepalive_interval
        self._queue_size = queue_size

        self._contract_subscribers: dict[str, list[asyncio.Queue[SSEEvent]]] = defaultdict(list)
        self._tenant_subscribers: dict[str, list[asyncio.Queue[SSEEvent]]] = defaultdict(list)
        self._contract_tenants: dict[str, str] = {}
        self._tenant_listener_tasks: dict[str, asyncio.Task] = {}

        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._redis: Optional[Redis] = None

    @property
    def keepalive_interval(self) -> float:
        return self._keepalive_interval

    def _bind_loop(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        if self._loop is None or self._loop.is_closed():
            self._loop = loop

    def _tenant_channel(self, tenant_id: str) -> str:
        return f"tenant_events:{tenant_id}"

    async def _get_redis(self) -> Redis:
        if self._redis is None:
            self._redis = Redis.from_url(self._redis_url, decode_responses=True)
        return self._redis

    async def startup(self) -> None:
        self._bind_loop()
        redis = await self._get_redis()
        await redis.ping()

    async def publish(self, event: SSEEvent) -> None:
        self._bind_loop()
        redis = await self._get_redis()
        await redis.publish(self._tenant_channel(event.tenant_id), json.dumps(event.to_payload(), default=str))

    def publish_sync(self, event: SSEEvent) -> None:
        if self._loop and not self._loop.is_closed():
            future = asyncio.run_coroutine_threadsafe(self.publish(event), self._loop)
            future.result(timeout=5)

    def subscribe_contract(self, contract_id: str, tenant_id: str) -> asyncio.Queue[SSEEvent]:
        self._bind_loop()
        queue: asyncio.Queue[SSEEvent] = asyncio.Queue(maxsize=self._queue_size)
        self._contract_subscribers[contract_id].append(queue)
        self._contract_tenants[contract_id] = tenant_id
        self._ensure_tenant_listener(tenant_id)
        return queue

    def subscribe_tenant(self, tenant_id: str) -> asyncio.Queue[SSEEvent]:
        self._bind_loop()
        queue: asyncio.Queue[SSEEvent] = asyncio.Queue(maxsize=self._queue_size)
        self._tenant_subscribers[tenant_id].append(queue)
        self._ensure_tenant_listener(tenant_id)
        return queue

    def unsubscribe_contract(self, contract_id: str, queue: asyncio.Queue[SSEEvent]) -> None:
        subscribers = self._contract_subscribers.get(contract_id, [])
        if queue in subscribers:
            subscribers.remove(queue)
        if not subscribers and contract_id in self._contract_subscribers:
            del self._contract_subscribers[contract_id]
            tenant_id = self._contract_tenants.pop(contract_id, None)
            if tenant_id:
                self._stop_tenant_listener_if_unused(tenant_id)

    def unsubscribe_tenant(self, tenant_id: str, queue: asyncio.Queue[SSEEvent]) -> None:
        subscribers = self._tenant_subscribers.get(tenant_id, [])
        if queue in subscribers:
            subscribers.remove(queue)
        if not subscribers and tenant_id in self._tenant_subscribers:
            del self._tenant_subscribers[tenant_id]
            self._stop_tenant_listener_if_unused(tenant_id)

    def _ensure_tenant_listener(self, tenant_id: str) -> None:
        if not self._loop or self._loop.is_closed():
            return

        task = self._tenant_listener_tasks.get(tenant_id)
        if task and not task.done():
            return

        self._tenant_listener_tasks[tenant_id] = self._loop.create_task(self._tenant_listener_loop(tenant_id))

    def _tenant_has_subscribers(self, tenant_id: str) -> bool:
        if self._tenant_subscribers.get(tenant_id):
            return True
        return any(mapped_tenant == tenant_id for mapped_tenant in self._contract_tenants.values())

    def _stop_tenant_listener_if_unused(self, tenant_id: str) -> None:
        if self._tenant_has_subscribers(tenant_id):
            return

        task = self._tenant_listener_tasks.pop(tenant_id, None)
        if task and not task.done():
            task.cancel()

    async def _tenant_listener_loop(self, tenant_id: str) -> None:
        pubsub = None
        try:
            while self._tenant_has_subscribers(tenant_id):
                try:
                    redis = await self._get_redis()
                    pubsub = redis.pubsub()
                    await pubsub.subscribe(self._tenant_channel(tenant_id))

                    async for message in pubsub.listen():
                        if message.get("type") != "message":
                            continue

                        raw_data = message.get("data")
                        if not raw_data:
                            continue

                        payload = json.loads(raw_data)
                        self._fan_out_local(SSEEvent.from_payload(payload))

                        if not self._tenant_has_subscribers(tenant_id):
                            break

                    await pubsub.unsubscribe(self._tenant_channel(tenant_id))
                    await pubsub.close()
                    pubsub = None
                except asyncio.CancelledError:
                    raise
                except Exception:
                    if pubsub is not None:
                        try:
                            await pubsub.close()
                        except Exception:
                            pass
                        pubsub = None
                    await asyncio.sleep(1)
        except asyncio.CancelledError:
            if pubsub is not None:
                try:
                    await pubsub.unsubscribe(self._tenant_channel(tenant_id))
                    await pubsub.close()
                except Exception:
                    pass
            raise
        finally:
            current_task = self._tenant_listener_tasks.get(tenant_id)
            if current_task is asyncio.current_task():
                self._tenant_listener_tasks.pop(tenant_id, None)

    def _fan_out_local(self, event: SSEEvent) -> None:
        if event.contract_id:
            dead_contract_queues: list[asyncio.Queue[SSEEvent]] = []
            for queue in self._contract_subscribers.get(event.contract_id, []):
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    dead_contract_queues.append(queue)
            for queue in dead_contract_queues:
                self.unsubscribe_contract(event.contract_id, queue)

        dead_tenant_queues: list[asyncio.Queue[SSEEvent]] = []
        for queue in self._tenant_subscribers.get(event.tenant_id, []):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                dead_tenant_queues.append(queue)
        for queue in dead_tenant_queues:
            self.unsubscribe_tenant(event.tenant_id, queue)

    def get_stats(self) -> dict:
        return {
            "backend": "redis",
            "redis_url": self._redis_url,
            "contract_channels": len(self._contract_subscribers),
            "contract_subscribers": sum(len(v) for v in self._contract_subscribers.values()),
            "tenant_channels": len(self._tenant_subscribers),
            "tenant_subscribers": sum(len(v) for v in self._tenant_subscribers.values()),
            "tenant_listener_tasks": len([task for task in self._tenant_listener_tasks.values() if not task.done()]),
            "keepalive_interval": self._keepalive_interval,
        }

    async def close(self) -> None:
        listener_tasks = list(self._tenant_listener_tasks.values())
        self._tenant_listener_tasks.clear()

        for task in listener_tasks:
            if not task.done():
                task.cancel()

        for task in listener_tasks:
            with suppress(asyncio.CancelledError):
                await task

        self._contract_subscribers.clear()
        self._tenant_subscribers.clear()
        self._contract_tenants.clear()

        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None


event_bus = EventBus()
