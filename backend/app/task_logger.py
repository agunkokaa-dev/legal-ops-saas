# backend/app/task_logger.py

import traceback
import time
from datetime import datetime, timezone
from typing import Optional


def _insert_task_log_row(record: dict) -> dict:
    # CROSS-TENANT: task execution logs are system-level operational records, not tenant-owned business tables.
    from app.config import admin_supabase

    result = admin_supabase.table("task_execution_logs").insert(record).execute()
    return result.data[0]


def _update_task_log_row(log_id: str, payload: dict) -> None:
    if not payload:
        return

    # CROSS-TENANT: task execution logs are system-level operational records, not tenant-owned business tables.
    from app.config import admin_supabase

    admin_supabase.table("task_execution_logs").update(payload).eq("id", log_id).execute()


class TaskLogger:
    """
    Lifecycle logger for background tasks.
    
    Usage:
        logger = TaskLogger(
            tenant_id="tenant_123",
            task_type="pipeline_ingestion",
            contract_id="contract_456",
            input_metadata={"filename": "contract.pdf", "text_length": 45230}
        )
        ...
    """
    
    def __init__(
        self,
        tenant_id: str,
        task_type: str,
        contract_id: Optional[str] = None,
        version_id: Optional[str] = None,
        input_metadata: Optional[dict] = None,
        parent_task_id: Optional[str] = None,
        attempt_number: int = 1,
        max_attempts: int = 3,
        existing_log_id: Optional[str] = None,
        initial_status: str = "running",
    ):
        self.tenant_id = tenant_id
        self.task_type = task_type
        self.start_time = time.time()
        self.agent_progress = []
        self._current_agent_start = None
        self.input_metadata = input_metadata or {}
        self.contract_id = contract_id
        self.version_id = version_id
        self.parent_task_id = parent_task_id
        self.attempt_number = attempt_number
        self.max_attempts = max_attempts

        if existing_log_id is not None:
            self.log_id = str(existing_log_id)
            _update_task_log_row(self.log_id, {
                "tenant_id": tenant_id,
                "task_type": task_type,
                "contract_id": contract_id,
                "version_id": version_id,
                "status": initial_status,
                "input_metadata": self.input_metadata,
                "attempt_number": attempt_number,
                "max_attempts": max_attempts,
                "parent_task_id": parent_task_id,
                "agent_progress": [],
                "started_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "duration_ms": None,
                "error_type": None,
                "error_message": None,
                "error_traceback": None,
                "result_summary": {},
            })
            return
        
        # Insert the initial "running" record
        record = {
            "tenant_id": tenant_id,
            "task_type": task_type,
            "contract_id": contract_id,
            "version_id": version_id,
            "status": initial_status,
            "input_metadata": self.input_metadata,
            "attempt_number": attempt_number,
            "max_attempts": max_attempts,
            "parent_task_id": parent_task_id,
            "agent_progress": [],
        }
        
        self.log_id = _insert_task_log_row(record)["id"]
    
    def log_agent_start(self, agent_name: str):
        """Call before each agent runs."""
        self._current_agent_start = time.time()
        self.agent_progress.append({
            "agent": agent_name,
            "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
        self._sync_progress()
    
    def log_agent_complete(self, agent_name: str, metadata: Optional[dict] = None):
        """Call after each agent succeeds."""
        duration = int((time.time() - self._current_agent_start) * 1000) if self._current_agent_start else 0
        
        # Update the last entry in agent_progress
        for entry in reversed(self.agent_progress):
            if entry["agent"] == agent_name:
                entry["status"] = "completed"
                entry["duration_ms"] = duration
                if metadata:
                    entry["metadata"] = metadata
                break
        
        self._sync_progress()
    
    def log_agent_failed(self, agent_name: str, error: Exception, used_fallback: bool = True):
        """Call when an agent fails but pipeline continues with fallback defaults."""
        duration = int((time.time() - self._current_agent_start) * 1000) if self._current_agent_start else 0
        
        for entry in reversed(self.agent_progress):
            if entry["agent"] == agent_name:
                entry["status"] = "failed_with_fallback" if used_fallback else "failed"
                entry["duration_ms"] = duration
                entry["error"] = str(error)[:500]  # Truncate to avoid huge payloads
                break
        
        self._sync_progress()
    
    def log_agent_skipped(self, agent_name: str, reason: str = ""):
        """Call when an agent is skipped."""
        self.agent_progress.append({
            "agent": agent_name,
            "status": "skipped",
            "reason": reason,
        })
        self._sync_progress()
    
    def complete(self, result_summary: Optional[dict] = None):
        """Call when the entire task succeeds."""
        duration_ms = int((time.time() - self.start_time) * 1000)
        
        _update_task_log_row(self.log_id, {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "agent_progress": self.agent_progress,
            "result_summary": result_summary or {},
        })
    
    def fail(self, error: Exception):
        """Call when the entire task fails."""
        duration_ms = int((time.time() - self.start_time) * 1000)
        
        _update_task_log_row(self.log_id, {
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "error_type": type(error).__name__,
            "error_message": str(error)[:2000],
            "error_traceback": traceback.format_exc()[:5000],
            "agent_progress": self.agent_progress,
        })
    
    def mark_retrying(self):
        """Call before spawning a retry attempt."""
        _update_task_log_row(self.log_id, {
            "status": "retrying",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })

    def update_input_metadata(self, values: dict):
        """Merge additional metadata into the task log."""
        self.input_metadata.update(values or {})
        try:
            _update_task_log_row(self.log_id, {
                "input_metadata": self.input_metadata,
            })
        except Exception:
            pass
    
    def _sync_progress(self):
        """Persist agent_progress to database (called after each agent state change)."""
        try:
            _update_task_log_row(self.log_id, {
                "agent_progress": self.agent_progress,
            })
        except Exception:
            pass  # Don't let logging failures break the pipeline
