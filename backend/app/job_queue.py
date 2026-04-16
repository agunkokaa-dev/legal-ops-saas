"""
Durable Redis-backed job queue helpers.

FastAPI endpoints enqueue work into Redis and a separate arq worker executes it.
Every job is logged to task_execution_logs before enqueue so failures are visible
even if Redis is unavailable.
"""

from __future__ import annotations

import os
import json
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.config import admin_supabase
from app.event_bus import SSEEvent, event_bus


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
WORKER_HEARTBEAT_KEY = "jobs:worker:heartbeat"
DEFAULT_JOB_TTL_SECONDS = 60 * 60

_pool: Optional[ArqRedis] = None


class QueueEnqueueError(RuntimeError):
    """Raised when a job log is created but Redis enqueue fails."""

    def __init__(self, message: str, *, log_id: Optional[str] = None):
        super().__init__(message)
        self.log_id = log_id


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_redis_settings() -> RedisSettings:
    parsed = urlparse(REDIS_URL)
    database = 0
    if parsed.path and parsed.path != "/":
        try:
            database = int(parsed.path.lstrip("/"))
        except ValueError:
            database = 0

    return RedisSettings(
        host=parsed.hostname or "redis",
        port=parsed.port or 6379,
        database=database,
        username=parsed.username,
        password=parsed.password,
        ssl=parsed.scheme == "rediss",
    )


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(get_redis_settings())
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None


async def set_worker_heartbeat(payload: Optional[dict[str, Any]] = None, ttl_seconds: int = 90) -> None:
    pool = await get_pool()
    heartbeat_payload = {
        "timestamp": utcnow_iso(),
        **(payload or {}),
    }
    await pool.set(WORKER_HEARTBEAT_KEY, json.dumps(heartbeat_payload), ex=ttl_seconds)


async def get_worker_heartbeat() -> Optional[str]:
    pool = await get_pool()
    return await pool.get(WORKER_HEARTBEAT_KEY)


def _insert_task_log(
    *,
    tenant_id: str,
    task_type: str,
    contract_id: Optional[str] = None,
    version_id: Optional[str] = None,
    input_metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    result = admin_supabase.table("task_execution_logs").insert({
        "tenant_id": tenant_id,
        "task_type": task_type,
        "contract_id": contract_id,
        "version_id": version_id,
        "status": "queued",
        "input_metadata": {
            **(input_metadata or {}),
            "enqueued_at": utcnow_iso(),
        },
    }).execute()
    return result.data[0]


def update_task_log(
    log_id: str,
    *,
    status: Optional[str] = None,
    input_metadata: Optional[dict[str, Any]] = None,
    result_summary: Optional[dict[str, Any]] = None,
    error: Optional[Exception] = None,
    arq_job_id: Optional[str] = None,
) -> None:
    payload: dict[str, Any] = {}
    if status is not None:
        payload["status"] = status
    if input_metadata is not None:
        payload["input_metadata"] = input_metadata
    if result_summary is not None:
        payload["result_summary"] = result_summary
    if arq_job_id is not None:
        payload["arq_job_id"] = arq_job_id
    if error is not None:
        payload["error_type"] = type(error).__name__
        payload["error_message"] = str(error)[:2000]
    if payload:
        admin_supabase.table("task_execution_logs").update(payload).eq("id", log_id).execute()


async def _enqueue_with_log(
    *,
    function_name: str,
    task_type: str,
    tenant_id: str,
    contract_id: Optional[str] = None,
    version_id: Optional[str] = None,
    input_metadata: Optional[dict[str, Any]] = None,
    job_kwargs: Optional[dict[str, Any]] = None,
    job_id: Optional[str] = None,
    queued_event_type: Optional[str] = None,
    queued_event_data: Optional[dict[str, Any]] = None,
) -> dict[str, str]:
    log_row = _insert_task_log(
        tenant_id=tenant_id,
        task_type=task_type,
        contract_id=contract_id,
        version_id=version_id,
        input_metadata=input_metadata,
    )
    log_id = str(log_row["id"])
    merged_metadata = dict(log_row.get("input_metadata") or {})

    try:
        pool = await get_pool()
        job = await pool.enqueue_job(
            function_name,
            **(job_kwargs or {}),
            log_id=log_id,
            _job_id=job_id,
        )
        if job is None:
            raise RuntimeError(f"Redis rejected duplicate or expired enqueue for {function_name}")

        merged_metadata["arq_job_id"] = job.job_id
        update_task_log(log_id, input_metadata=merged_metadata, arq_job_id=job.job_id)

        if queued_event_type:
            await event_bus.publish(SSEEvent(
                event_type=queued_event_type,
                contract_id=contract_id,
                tenant_id=tenant_id,
                data={
                    **(queued_event_data or {}),
                    "job_id": job.job_id,
                    "log_id": log_id,
                },
            ))

        return {"job_id": job.job_id, "log_id": log_id}
    except Exception as exc:
        merged_metadata["enqueue_error"] = str(exc)
        merged_metadata["enqueue_failed_at"] = utcnow_iso()
        update_task_log(log_id, input_metadata=merged_metadata, error=exc)
        raise QueueEnqueueError(str(exc), log_id=log_id) from exc


async def enqueue_pipeline(
    *,
    contract_id: str,
    version_id: str,
    tenant_id: str,
    matter_id: Optional[str],
    filename: str,
    text_content: str,
) -> dict[str, str]:
    return await _enqueue_with_log(
        function_name="run_pipeline",
        task_type="pipeline_ingestion",
        tenant_id=tenant_id,
        contract_id=contract_id,
        version_id=version_id,
        input_metadata={
            "filename": filename,
            "text_length": len(text_content),
            "matter_id": matter_id,
        },
        job_kwargs={
            "contract_id": contract_id,
            "version_id": version_id,
            "tenant_id": tenant_id,
            "matter_id": matter_id,
            "filename": filename,
            "text_content": text_content,
        },
        job_id=f"pipeline:{contract_id}:{version_id}",
        queued_event_type="pipeline.queued",
        queued_event_data={"message": "Job queued for processing"},
    )


async def enqueue_smart_diff(
    *,
    contract_id: str,
    tenant_id: str,
    v1_version_id: Optional[str] = None,
    v2_version_id: Optional[str] = None,
    enable_debate: bool = False,
) -> dict[str, str]:
    job_key = f"diff:{contract_id}:{v1_version_id or 'auto'}:{v2_version_id or 'auto'}:{int(enable_debate)}"
    return await _enqueue_with_log(
        function_name="run_diff",
        task_type="smart_diff",
        tenant_id=tenant_id,
        contract_id=contract_id,
        version_id=v2_version_id,
        input_metadata={
            "v1_version_id": v1_version_id,
            "v2_version_id": v2_version_id,
            "enable_debate": enable_debate,
        },
        job_kwargs={
            "contract_id": contract_id,
            "tenant_id": tenant_id,
            "v1_version_id": v1_version_id,
            "v2_version_id": v2_version_id,
            "enable_debate": enable_debate,
        },
        job_id=job_key,
        queued_event_type="diff.queued",
        queued_event_data={"message": "Smart Diff queued"},
    )


async def enqueue_bilingual_sync(
    *,
    contract_id: str,
    clause_id: str,
    tenant_id: str,
    source_language: str,
    source_text: str,
) -> dict[str, str]:
    return await _enqueue_with_log(
        function_name="run_bilingual_sync",
        task_type="bilingual_sync",
        tenant_id=tenant_id,
        contract_id=contract_id,
        input_metadata={
            "clause_id": clause_id,
            "source_language": source_language,
            "text_length": len(source_text),
        },
        job_kwargs={
            "contract_id": contract_id,
            "clause_id": clause_id,
            "tenant_id": tenant_id,
            "source_language": source_language,
            "source_text": source_text,
        },
        job_id=f"bilingual-sync:{clause_id}",
    )


async def enqueue_bilingual_validate(
    *,
    contract_id: str,
    tenant_id: str,
) -> dict[str, str]:
    return await _enqueue_with_log(
        function_name="run_bilingual_validate",
        task_type="bilingual_validate",
        tenant_id=tenant_id,
        contract_id=contract_id,
        input_metadata={},
        job_kwargs={
            "contract_id": contract_id,
            "tenant_id": tenant_id,
        },
        job_id=f"bilingual-validate:{contract_id}",
    )


async def enqueue_signing_completion(
    *,
    session_id: str,
    contract_id: str,
    tenant_id: str,
    provider: str,
    provider_document_id: str,
) -> dict[str, str]:
    return await _enqueue_with_log(
        function_name="run_signing_completion",
        task_type="signing_completion",
        tenant_id=tenant_id,
        contract_id=contract_id,
        input_metadata={
            "session_id": session_id,
            "provider": provider,
            "provider_document_id": provider_document_id,
        },
        job_kwargs={
            "session_id": session_id,
            "contract_id": contract_id,
            "tenant_id": tenant_id,
            "provider": provider,
            "provider_document_id": provider_document_id,
        },
        job_id=f"signing-complete:{session_id}",
    )


async def enqueue_debate(
    *,
    contract_id: str,
    tenant_id: str,
    debate_session_id: str,
    deviation_id: str,
) -> dict[str, str]:
    return await _enqueue_with_log(
        function_name="run_debate",
        task_type="debate_protocol",
        tenant_id=tenant_id,
        contract_id=contract_id,
        input_metadata={
            "debate_session_id": debate_session_id,
            "deviation_id": deviation_id,
        },
        job_kwargs={
            "debate_session_id": debate_session_id,
            "contract_id": contract_id,
            "tenant_id": tenant_id,
        },
        job_id=f"debate:{contract_id}:{deviation_id}",
    )
