-- ============================================================
-- Migration 024: Sample Contract Flag
-- Project: CLAUSE Legal Ops SaaS
-- Date: 2026-04-28
-- Description:
--   Marks onboarding sample contracts so they can be displayed as demo data
--   and safely cleared without touching tenant-owned documents.
-- ============================================================

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contracts_tenant_is_sample
    ON contracts(tenant_id, is_sample);

NOTIFY pgrst, 'reload schema';
