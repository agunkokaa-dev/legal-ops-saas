"""
arq worker entrypoint for durable background jobs.

Run locally with:
    arq worker.WorkerSettings
"""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import suppress
from datetime import datetime, timedelta, timezone

from arq import cron

from app.config import admin_supabase, init_qdrant_collections
from app.event_bus import SSEEvent, event_bus
from app.job_queue import close_pool, get_redis_settings, set_worker_heartbeat


async def _heartbeat_loop() -> None:
    while True:
        await set_worker_heartbeat({"pid": os.getpid()})
        await asyncio.sleep(30)


async def run_pipeline(
    ctx: dict,
    contract_id: str,
    version_id: str,
    tenant_id: str,
    matter_id: str | None,
    filename: str,
    text_content: str,
    log_id: str,
) -> dict:
    from app.routers.contracts import process_contract_background

    return await process_contract_background(
        contract_id=contract_id,
        version_id=version_id,
        tenant_id=tenant_id,
        matter_id=matter_id,
        filename=filename,
        text_content=text_content,
        existing_log_id=log_id,
    )


async def run_diff(
    ctx: dict,
    contract_id: str,
    tenant_id: str,
    v1_version_id: str | None,
    v2_version_id: str | None,
    log_id: str,
) -> dict:
    from app.routers.negotiation import process_smart_diff_background

    return await process_smart_diff_background(
        contract_id=contract_id,
        tenant_id=tenant_id,
        v1_version_id=v1_version_id,
        v2_version_id=v2_version_id,
        existing_log_id=log_id,
    )


async def run_bilingual_sync(
    ctx: dict,
    contract_id: str,
    clause_id: str,
    tenant_id: str,
    source_language: str,
    source_text: str,
    log_id: str,
) -> dict:
    from app.routers.bilingual import process_bilingual_sync_background

    return await process_bilingual_sync_background(
        contract_id=contract_id,
        clause_id=clause_id,
        tenant_id=tenant_id,
        source_language=source_language,
        source_text=source_text,
        existing_log_id=log_id,
    )


async def run_bilingual_validate(
    ctx: dict,
    contract_id: str,
    tenant_id: str,
    log_id: str,
) -> dict:
    from app.routers.bilingual import process_bilingual_validate_background

    return await process_bilingual_validate_background(
        contract_id=contract_id,
        tenant_id=tenant_id,
        existing_log_id=log_id,
    )


async def run_signing_completion(
    ctx: dict,
    session_id: str,
    contract_id: str,
    tenant_id: str,
    provider: str,
    provider_document_id: str,
    log_id: str,
) -> dict:
    from app.routers.signing import process_signing_completion_background

    return await process_signing_completion_background(
        session_id=session_id,
        contract_id=contract_id,
        tenant_id=tenant_id,
        provider=provider,
        provider_document_id=provider_document_id,
        existing_log_id=log_id,
    )


async def recover_stale_jobs(ctx: dict) -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()

    stale_contracts = admin_supabase.table("contracts").select("id, tenant_id, status, title, updated_at") \
        .in_("status", ["Queued", "Processing"]) \
        .lt("updated_at", cutoff) \
        .execute()

    for contract in stale_contracts.data or []:
        contract_id = contract["id"]
        tenant_id = contract["tenant_id"]
        title = contract.get("title") or "Contract"

        logs = admin_supabase.table("task_execution_logs").select("id, status, input_metadata") \
            .eq("contract_id", contract_id) \
            .in_("status", ["queued", "running", "retrying"]) \
            .order("created_at", desc=True) \
            .execute()

        for log in logs.data or []:
            metadata = dict(log.get("input_metadata") or {})
            metadata["stale_recovered_at"] = datetime.now(timezone.utc).isoformat()
            admin_supabase.table("task_execution_logs").update({
                "status": "failed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error_type": "StaleJobRecovery",
                "error_message": "Job exceeded stale timeout and was marked failed by recovery cron.",
                "input_metadata": metadata,
            }).eq("id", log["id"]).execute()

        admin_supabase.table("contracts").update({
            "status": "Failed",
            "draft_revisions": {
                "error_summary": "Background job stalled and was marked failed by recovery. Please retry.",
                "recovered_at": datetime.now(timezone.utc).isoformat(),
            },
        }).eq("id", contract_id).eq("tenant_id", tenant_id).execute()

        await event_bus.publish(SSEEvent(
            event_type="pipeline.failed",
            tenant_id=tenant_id,
            contract_id=contract_id,
            data={"error": "Job recovery marked the stalled pipeline as failed."},
        ))
        await event_bus.publish(SSEEvent(
            event_type="contract.status_changed",
            tenant_id=tenant_id,
            contract_id=contract_id,
            data={
                "contract_id": contract_id,
                "contract_title": title,
                "old_status": contract.get("status"),
                "new_status": "Failed",
                "message": f"{title} stalled and was marked failed by recovery.",
            },
        ))


class WorkerSettings:
    functions = [
        run_pipeline,
        run_diff,
        run_bilingual_sync,
        run_bilingual_validate,
        run_signing_completion,
    ]

    cron_jobs = [
        cron(recover_stale_jobs, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
    ]

    redis_settings = get_redis_settings()
    max_jobs = 5
    job_timeout = 60 * 5
    max_tries = 3
    keep_result = 60 * 60
    health_check_interval = 30

    @staticmethod
    async def on_startup(ctx: dict) -> None:
        init_qdrant_collections()
        await event_bus.startup()
        await set_worker_heartbeat({"pid": os.getpid(), "status": "starting"})
        ctx["heartbeat_task"] = asyncio.create_task(_heartbeat_loop())
        print(json.dumps({
            "worker": "started",
            "pid": os.getpid(),
            "redis_host": WorkerSettings.redis_settings.host,
            "redis_port": WorkerSettings.redis_settings.port,
            "max_jobs": WorkerSettings.max_jobs,
        }))

    @staticmethod
    async def on_shutdown(ctx: dict) -> None:
        heartbeat_task = ctx.get("heartbeat_task")
        if heartbeat_task:
            heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat_task
        await close_pool()
        await event_bus.close()
        print(json.dumps({"worker": "stopped", "pid": os.getpid()}))
