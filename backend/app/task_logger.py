# backend/app/task_logger.py

import traceback
import time
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from app.config import admin_supabase  # The global admin client


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
    ):
        self.tenant_id = tenant_id
        self.task_type = task_type
        self.start_time = time.time()
        self.agent_progress = []
        self._current_agent_start = None
        
        # Insert the initial "running" record
        record = {
            "tenant_id": tenant_id,
            "task_type": task_type,
            "contract_id": contract_id,
            "version_id": version_id,
            "status": "running",
            "input_metadata": input_metadata or {},
            "attempt_number": attempt_number,
            "max_attempts": max_attempts,
            "parent_task_id": parent_task_id,
            "agent_progress": [],
        }
        
        result = admin_supabase.table("task_execution_logs").insert(record).execute()
        self.log_id = result.data[0]["id"]
    
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
        
        admin_supabase.table("task_execution_logs").update({
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "agent_progress": self.agent_progress,
            "result_summary": result_summary or {},
        }).eq("id", self.log_id).execute()
    
    def fail(self, error: Exception):
        """Call when the entire task fails."""
        duration_ms = int((time.time() - self.start_time) * 1000)
        
        admin_supabase.table("task_execution_logs").update({
            "status": "failed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": duration_ms,
            "error_type": type(error).__name__,
            "error_message": str(error)[:2000],
            "error_traceback": traceback.format_exc()[:5000],
            "agent_progress": self.agent_progress,
        }).eq("id", self.log_id).execute()
    
    def mark_retrying(self):
        """Call before spawning a retry attempt."""
        admin_supabase.table("task_execution_logs").update({
            "status": "retrying",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", self.log_id).execute()
    
    def _sync_progress(self):
        """Persist agent_progress to database (called after each agent state change)."""
        try:
            admin_supabase.table("task_execution_logs").update({
                "agent_progress": self.agent_progress,
            }).eq("id", self.log_id).execute()
        except Exception:
            pass  # Don't let logging failures break the pipeline
