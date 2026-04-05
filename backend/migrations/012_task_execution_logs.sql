-- Migration: Create task_execution_logs table for background task observability

CREATE TABLE IF NOT EXISTS task_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    
    -- What was being processed
    task_type TEXT NOT NULL,  -- 'pipeline_ingestion' | 'smart_diff' | 'obligation_extraction' | 'drafting_audit' | 'bilingual_sync' | 'bilingual_validate'
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    version_id UUID REFERENCES contract_versions(id) ON DELETE SET NULL,
    
    -- Lifecycle tracking
    status TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'completed' | 'failed' | 'retrying'
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,  -- Calculated: completed_at - started_at in milliseconds
    
    -- For pipeline_ingestion: track individual agent progress
    agent_progress JSONB DEFAULT '[]'::jsonb,
    
    -- Error details (only populated on failure)
    error_type TEXT,           -- Exception class name: 'OpenAIError', 'QdrantError', 'ValidationError', etc.
    error_message TEXT,        -- The actual error message string
    error_traceback TEXT,      -- Full Python traceback for debugging
    
    -- Retry tracking
    attempt_number INTEGER NOT NULL DEFAULT 1,  -- 1 = first attempt, 2 = first retry, etc.
    max_attempts INTEGER NOT NULL DEFAULT 3,
    parent_task_id UUID REFERENCES task_execution_logs(id),  -- Links retries to original task
    
    -- Context for debugging
    input_metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Result summary (only populated on success)
    result_summary JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_task_logs_tenant ON task_execution_logs(tenant_id);
CREATE INDEX idx_task_logs_contract ON task_execution_logs(contract_id);
CREATE INDEX idx_task_logs_status ON task_execution_logs(status);
CREATE INDEX idx_task_logs_type_status ON task_execution_logs(task_type, status);
CREATE INDEX idx_task_logs_started ON task_execution_logs(started_at DESC);
CREATE INDEX idx_task_logs_failed ON task_execution_logs(status, started_at DESC) WHERE status = 'failed';

-- RLS policy (even though backend bypasses it, defense-in-depth)
ALTER TABLE task_execution_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for task_execution_logs"
    ON task_execution_logs
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- Comment for documentation
COMMENT ON TABLE task_execution_logs IS 'Tracks lifecycle and errors of all background tasks (pipeline ingestion, smart diff, etc). Created as part of Phase 3.3 observability.';
