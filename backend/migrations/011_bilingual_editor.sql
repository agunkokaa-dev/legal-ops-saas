-- ============================================================
-- Migration 011: Bilingual Editor 
-- Project: CLAUSE Legal Ops SaaS
-- Date: 2026-04-04
-- ============================================================

CREATE TABLE bilingual_clauses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id     uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    tenant_id       text NOT NULL,
    clause_number   text NOT NULL,
    id_text         text NOT NULL,
    en_text         text,
    sync_status     text DEFAULT 'synced',
    edited_language text,
    status          text DEFAULT 'active',
    last_synced_at  timestamptz,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_bilingual boolean DEFAULT false;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS primary_language text DEFAULT 'id';
ALTER TABLE contract_versions ADD COLUMN IF NOT EXISTS id_raw_text text;
ALTER TABLE contract_versions ADD COLUMN IF NOT EXISTS en_raw_text text;
ALTER TABLE negotiation_issues ADD COLUMN IF NOT EXISTS language text DEFAULT 'id';

-- MANDATORY indexes
CREATE INDEX idx_bilingual_tenant_status ON bilingual_clauses(tenant_id, sync_status);
CREATE INDEX idx_bilingual_contract ON bilingual_clauses(contract_id);
