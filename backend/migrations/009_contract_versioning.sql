-- ============================================================
-- Migration 009: Contract Versioning & Negotiation Issues
-- Project: CLAUSE Legal Ops SaaS — Negotiation War Room (Phase 1)
-- Date: 2026-03-28
-- Description:
--   1. Creates `contract_versions` table for immutable version
--      snapshots with full LangGraph pipeline output.
--   2. Creates `negotiation_issues` table linking specific AI
--      findings to versions, contracts, and kanban tasks.
--   3. Adds `version_count` and `latest_version_id` columns
--      to the existing `contracts` table for fast lookups.
--   4. Applies Clerk JWT-based RLS on all new tables.
--
-- EXECUTION: Run manually in the Supabase SQL Editor.
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. CREATE contract_versions TABLE
-- ─────────────────────────────────────────────
-- Stores an immutable snapshot for each version of a contract.
-- The full LangGraph pipeline state is preserved in `pipeline_output`
-- for future Phase 2 Smart Diff comparisons.

CREATE TABLE IF NOT EXISTS contract_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id     uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    tenant_id       text NOT NULL,
    version_number  integer NOT NULL DEFAULT 1,
    raw_text        text,                          -- Full document text for this version
    pipeline_output jsonb DEFAULT '{}'::jsonb,     -- Complete LangGraph final_state snapshot
    risk_score      float DEFAULT 0.0,
    risk_level      text DEFAULT 'Unknown',
    uploaded_filename text,                        -- Original PDF filename
    created_at      timestamptz DEFAULT now(),

    -- Prevent duplicate version numbers per contract
    CONSTRAINT uq_contract_version UNIQUE (contract_id, version_number)
);

-- Index for fast version lookups by contract
CREATE INDEX IF NOT EXISTS idx_contract_versions_contract_id
    ON contract_versions(contract_id);

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_contract_versions_tenant_id
    ON contract_versions(tenant_id);

COMMENT ON TABLE contract_versions IS
    'Immutable version snapshots for contract lifecycle tracking. Each upload of a new iteration creates a new row.';


-- ─────────────────────────────────────────────
-- 2. CREATE negotiation_issues TABLE
-- ─────────────────────────────────────────────
-- Links specific AI-generated findings to the version they came from.
-- Supports escalation to the Kanban board via `linked_task_id`.

CREATE TABLE IF NOT EXISTS negotiation_issues (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       text NOT NULL,
    contract_id     uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    version_id      uuid REFERENCES contract_versions(id) ON DELETE SET NULL,
    finding_id      text,                          -- Maps to ReviewFinding.finding_id from pipeline
    title           text NOT NULL,
    description     text,
    severity        text DEFAULT 'warning',        -- 'critical', 'warning', 'info'
    category        text,                          -- e.g. 'Compliance', 'Risk', 'Suggested Revision'
    status          text DEFAULT 'open',           -- 'open', 'escalated', 'resolved', 'dismissed'
    linked_task_id  uuid REFERENCES tasks(id) ON DELETE SET NULL,
    coordinates     jsonb DEFAULT '{}'::jsonb,     -- {start_char, end_char, source_text}
    suggested_revision text,                       -- AI-suggested replacement text
    playbook_reference text,                       -- Which playbook rule triggered this
    created_at      timestamptz DEFAULT now(),
    resolved_at     timestamptz
);

-- Index for fast issue lookups by contract
CREATE INDEX IF NOT EXISTS idx_negotiation_issues_contract_id
    ON negotiation_issues(contract_id);

-- Index for filtering by version
CREATE INDEX IF NOT EXISTS idx_negotiation_issues_version_id
    ON negotiation_issues(version_id);

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_negotiation_issues_tenant_id
    ON negotiation_issues(tenant_id);

-- Index for status filtering (open issues dashboard)
CREATE INDEX IF NOT EXISTS idx_negotiation_issues_status
    ON negotiation_issues(status);

COMMENT ON TABLE negotiation_issues IS
    'AI-generated findings linked to specific contract versions. Supports escalation to Kanban tasks.';


-- ─────────────────────────────────────────────
-- 3. ALTER contracts TABLE — Version Tracking
-- ─────────────────────────────────────────────
-- Fast-access columns to avoid counting joins on every page load.

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS version_count integer DEFAULT 1;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS latest_version_id uuid REFERENCES contract_versions(id) ON DELETE SET NULL;


-- ─────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY — Clerk JWT Isolation
-- ─────────────────────────────────────────────

-- contract_versions RLS
ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Strict Tenant Isolation for Contract Versions"
    ON contract_versions
    FOR ALL
    USING (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    );

-- negotiation_issues RLS
ALTER TABLE negotiation_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Strict Tenant Isolation for Negotiation Issues"
    ON negotiation_issues
    FOR ALL
    USING (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    );


-- ─────────────────────────────────────────────
-- 5. PERMISSIONS
-- ─────────────────────────────────────────────
GRANT ALL ON TABLE contract_versions TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE negotiation_issues TO postgres, anon, authenticated, service_role;


-- ─────────────────────────────────────────────
-- 6. SCHEMA CACHE: Prevent PGRST204 errors
-- ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
