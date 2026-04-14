-- Migration: durable Redis-backed job queue support

ALTER TABLE task_execution_logs
ADD COLUMN IF NOT EXISTS arq_job_id TEXT;

CREATE INDEX IF NOT EXISTS idx_task_logs_arq_job
ON task_execution_logs(arq_job_id)
WHERE arq_job_id IS NOT NULL;

COMMENT ON COLUMN task_execution_logs.status IS
    'Valid values: queued (in Redis queue), running (worker executing), completed, failed, retrying';
