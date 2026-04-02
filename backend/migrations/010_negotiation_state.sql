-- ============================================================
-- Migration 010: Negotiation State Machine & Multi-Round Intelligence
-- Project: CLAUSE Legal Ops SaaS — Negotiation OS Upgrade
-- Date: 2026-04-02
-- Description:
--   1. Extends `negotiation_issues` table with workflow state tracking:
--      - status enum expanded to: open, under_review, accepted, rejected, countered, escalated, resolved, dismissed
--      - reasoning_log JSONB array for audit trail
--      - decided_by / decided_at for last decision tracking
--   2. Creates `negotiation_rounds` table for multi-round intelligence:
--      - Tracks V1→V2→V3 diff snapshots per round
--      - Stores AI-generated concession pattern analysis
--
-- EXECUTION: Run manually in the Supabase SQL Editor.
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. EXTEND negotiation_issues — Workflow State
-- ─────────────────────────────────────────────

-- Add reasoning_log: array of {action, actor, reason, timestamp} entries
ALTER TABLE negotiation_issues
    ADD COLUMN IF NOT EXISTS reasoning_log jsonb DEFAULT '[]'::jsonb;

-- Add decided_by: who made the last decision (user_id or display name)
ALTER TABLE negotiation_issues
    ADD COLUMN IF NOT EXISTS decided_by text;

-- Add decided_at: when the last decision was made
ALTER TABLE negotiation_issues
    ADD COLUMN IF NOT EXISTS decided_at timestamptz;

-- Update existing status values if needed (backward compatible)
-- The status column already exists as TEXT DEFAULT 'open'
-- New valid values: 'open', 'under_review', 'accepted', 'rejected', 'countered', 'escalated', 'resolved', 'dismissed'
-- We add a CHECK constraint for data integrity

-- First drop any existing constraint (safe if it doesn't exist)
DO $$
BEGIN
    ALTER TABLE negotiation_issues
        DROP CONSTRAINT IF EXISTS chk_negotiation_issue_status;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

ALTER TABLE negotiation_issues
    ADD CONSTRAINT chk_negotiation_issue_status
    CHECK (status IN ('open', 'under_review', 'accepted', 'rejected', 'countered', 'escalated', 'resolved', 'dismissed'));

COMMENT ON COLUMN negotiation_issues.reasoning_log IS
    'JSONB array of audit trail entries. Each entry: {action: string, actor: string, reason: string, timestamp: ISO8601}';

COMMENT ON COLUMN negotiation_issues.decided_by IS
    'User ID or display name of who made the last status decision';

COMMENT ON COLUMN negotiation_issues.decided_at IS
    'Timestamp of when the last status decision was made';


-- ─────────────────────────────────────────────
-- 2. CREATE negotiation_rounds TABLE
-- ─────────────────────────────────────────────
-- Tracks each V(N-1) → V(N) comparison round.
-- Enables multi-round concession pattern detection.

CREATE TABLE IF NOT EXISTS negotiation_rounds (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           text NOT NULL,
    contract_id         uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    round_number        integer NOT NULL DEFAULT 1,
    from_version_id     uuid REFERENCES contract_versions(id) ON DELETE SET NULL,
    to_version_id       uuid REFERENCES contract_versions(id) ON DELETE SET NULL,
    diff_snapshot       jsonb DEFAULT '{}'::jsonb,      -- Full SmartDiffResult cached
    concession_analysis jsonb DEFAULT '{}'::jsonb,      -- AI-generated concession patterns
    created_at          timestamptz DEFAULT now(),

    -- Prevent duplicate rounds per contract
    CONSTRAINT uq_negotiation_round UNIQUE (contract_id, round_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_negotiation_rounds_contract_id
    ON negotiation_rounds(contract_id);

CREATE INDEX IF NOT EXISTS idx_negotiation_rounds_tenant_id
    ON negotiation_rounds(tenant_id);

COMMENT ON TABLE negotiation_rounds IS
    'Tracks each V(N-1) → V(N) comparison round for multi-round concession intelligence. Stores diff snapshots and AI-generated pattern analysis.';


-- ─────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY — Clerk JWT Isolation
-- ─────────────────────────────────────────────

ALTER TABLE negotiation_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Strict Tenant Isolation for Negotiation Rounds"
    ON negotiation_rounds
    FOR ALL
    USING (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    );


-- ─────────────────────────────────────────────
-- 4. PERMISSIONS
-- ─────────────────────────────────────────────
GRANT ALL ON TABLE negotiation_rounds TO postgres, anon, authenticated, service_role;


-- ─────────────────────────────────────────────
-- 5. SCHEMA CACHE: Prevent PGRST204 errors
-- ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
