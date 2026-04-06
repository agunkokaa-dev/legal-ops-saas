-- ============================================================
-- Migration 014: E-Signature & E-Meterai Integration Tables
-- Project: CLAUSE Legal Ops SaaS — PSrE Indonesia Integration
-- Date: 2026-04-06
-- Description:
--   Creates three tables for the full e-signature lifecycle:
--   1. signing_sessions   — one per signing ceremony
--   2. signing_signers    — one per signer per session
--   3. signing_audit_log  — immutable event trail
--
--   Also extends contracts.status with signing lifecycle values:
--   Pending Approval → Ready to Sign → Signing in Progress
--   → Partially Signed → Executed → Active → Expired / Terminated
--
-- EXECUTION: Run manually in the Supabase SQL Editor.
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. SIGNING SESSIONS
--    One per signing ceremony. Tracks provider config,
--    document references, and overall session lifecycle.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signing_sessions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               TEXT NOT NULL,
    contract_id             UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    version_id              UUID REFERENCES contract_versions(id) ON DELETE SET NULL,

    -- Provider configuration
    provider                TEXT NOT NULL DEFAULT 'mock',
    -- 'privyid' | 'peruri' | 'mekari_sign' | 'mock' (for testing)
    provider_document_id    TEXT,           -- Document ID/token from PSrE provider
    provider_document_url   TEXT,           -- URL to view document on provider platform

    -- Document reference
    document_filename       TEXT NOT NULL,
    document_storage_path   TEXT,           -- Supabase Storage path to PDF sent for signing
    signed_document_path    TEXT,           -- Supabase Storage path to signed PDF (after completion)

    -- Signing configuration
    signing_order           TEXT NOT NULL DEFAULT 'parallel',
    -- 'parallel' (all signers at once) | 'sequential' (ordered)
    signature_type          TEXT NOT NULL DEFAULT 'simple',
    -- 'simple' | 'certified' (QES — PSrE certified)
    require_emeterai        BOOLEAN NOT NULL DEFAULT false,
    emeterai_page           INTEGER,        -- Page number for e-Meterai placement (null = last page)
    emeterai_provider_id    TEXT,           -- e-Meterai serial from Peruri

    -- Lifecycle
    status                  TEXT NOT NULL DEFAULT 'draft',
    -- 'draft' | 'pending_signatures' | 'partially_signed' | 'completed' | 'expired' | 'cancelled' | 'failed'
    initiated_by            TEXT,           -- User ID who started the signing
    initiated_at            TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    expires_at              TIMESTAMPTZ,    -- Signing deadline
    cancelled_at            TIMESTAMPTZ,
    cancellation_reason     TEXT,

    -- Compliance checklist results (JSONB)
    pre_sign_checklist      JSONB DEFAULT '[]'::jsonb,
    -- [{"check": "all_issues_resolved", "passed": true, "detail": "..."},  ...]

    -- Provider-specific metadata
    provider_metadata       JSONB DEFAULT '{}'::jsonb,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_signing_session_status
        CHECK (status IN ('draft', 'pending_signatures', 'partially_signed', 'completed', 'expired', 'cancelled', 'failed')),
    CONSTRAINT chk_signing_order
        CHECK (signing_order IN ('parallel', 'sequential')),
    CONSTRAINT chk_signature_type
        CHECK (signature_type IN ('simple', 'certified'))
);

COMMENT ON TABLE signing_sessions IS
    'E-signature ceremony sessions. One per signing workflow. Tracks provider, document, and lifecycle.';


-- ─────────────────────────────────────────────
-- 2. SIGNING SIGNERS
--    One per signer per session. Tracks identity,
--    signature position, and completion status.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signing_signers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              UUID NOT NULL REFERENCES signing_sessions(id) ON DELETE CASCADE,
    tenant_id               TEXT NOT NULL,

    -- Signer identity
    full_name               TEXT NOT NULL,
    email                   TEXT NOT NULL,
    phone                   TEXT,           -- For OTP verification
    privy_id                TEXT,           -- PrivyID identifier (if registered)
    organization            TEXT,           -- Company name
    role                    TEXT NOT NULL DEFAULT 'pihak_pertama',
    -- 'pihak_pertama' | 'pihak_kedua' | 'saksi' | 'approver'
    title                   TEXT,           -- Job title: "Legal Director"

    -- Signing details
    signing_order_index     INTEGER NOT NULL DEFAULT 0,
    -- 0 = first signer (or all at once if parallel)
    signing_url             TEXT,           -- Provider-generated URL for this signer
    signing_page            INTEGER,        -- Page number for signature placement
    signing_position_x      FLOAT,          -- X coordinate (0.0–1.0, relative to page width)
    signing_position_y      FLOAT,          -- Y coordinate (0.0–1.0, relative to page height)

    -- Lifecycle
    status                  TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'notified' | 'viewed' | 'signed' | 'rejected' | 'expired'
    notified_at             TIMESTAMPTZ,    -- When invitation was sent
    viewed_at               TIMESTAMPTZ,    -- When signer opened the document
    signed_at               TIMESTAMPTZ,    -- When signer completed signing
    rejected_at             TIMESTAMPTZ,
    rejection_reason        TEXT,

    -- Certificate info (populated after signing)
    certificate_serial      TEXT,           -- PSrE certificate serial number
    certificate_issuer      TEXT,           -- e.g. "PT Privy Identitas Digital" or "Peruri"
    signature_algorithm     TEXT,           -- e.g. "SHA-256 with RSA"
    signature_hash          TEXT,           -- Hash of the digital signature

    -- Provider-specific metadata
    provider_signer_id      TEXT,           -- Signer ID in the provider's system
    provider_metadata       JSONB DEFAULT '{}'::jsonb,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_signer_status
        CHECK (status IN ('pending', 'notified', 'viewed', 'signed', 'rejected', 'expired')),
    CONSTRAINT chk_signer_role
        CHECK (role IN ('pihak_pertama', 'pihak_kedua', 'saksi', 'approver'))
);

COMMENT ON TABLE signing_signers IS
    'Individual signers per signing session. Tracks identity, position on document, and completion state.';


-- ─────────────────────────────────────────────
-- 3. SIGNING AUDIT LOG
--    Immutable event trail for all signing activity.
--    Used for compliance, debugging, and legal record.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS signing_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES signing_sessions(id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL,

    -- Event details
    event_type      TEXT NOT NULL,
    -- 'session_created' | 'checklist_passed' | 'checklist_blocked'
    -- 'document_uploaded' | 'emeterai_affixed'
    -- 'signer_notified' | 'signer_viewed' | 'signer_signed' | 'signer_rejected'
    -- 'session_completed' | 'session_expired' | 'session_cancelled' | 'session_failed'
    -- 'signed_document_downloaded' | 'reminder_sent' | 'webhook_received'
    -- 'obligations_activated' | 'contract_executed'
    event_actor     TEXT,           -- User ID, signer email, or 'system'
    event_detail    TEXT,           -- Human-readable description
    event_metadata  JSONB DEFAULT '{}'::jsonb,
    -- Stores: webhook payloads, API responses, error details

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE signing_audit_log IS
    'Immutable audit trail for all signing events. Append-only — rows are never updated or deleted.';


-- ─────────────────────────────────────────────
-- 4. INDEXES
-- ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_signing_sessions_tenant
    ON signing_sessions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_signing_sessions_contract
    ON signing_sessions(contract_id);

CREATE INDEX IF NOT EXISTS idx_signing_sessions_status
    ON signing_sessions(status);

CREATE INDEX IF NOT EXISTS idx_signing_signers_session
    ON signing_signers(session_id);

CREATE INDEX IF NOT EXISTS idx_signing_signers_email
    ON signing_signers(email);

CREATE INDEX IF NOT EXISTS idx_signing_signers_status
    ON signing_signers(status);

CREATE INDEX IF NOT EXISTS idx_signing_audit_session
    ON signing_audit_log(session_id);

CREATE INDEX IF NOT EXISTS idx_signing_audit_type
    ON signing_audit_log(event_type);

CREATE INDEX IF NOT EXISTS idx_signing_audit_tenant
    ON signing_audit_log(tenant_id);


-- ─────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY — Clerk JWT Isolation
-- ─────────────────────────────────────────────

ALTER TABLE signing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for signing_sessions"
    ON signing_sessions FOR ALL
    USING (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    )
    WITH CHECK (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    );

CREATE POLICY "Tenant isolation for signing_signers"
    ON signing_signers FOR ALL
    USING (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    )
    WITH CHECK (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    );

CREATE POLICY "Tenant isolation for signing_audit_log"
    ON signing_audit_log FOR ALL
    USING (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    )
    WITH CHECK (
        tenant_id = auth.jwt()->>'org_id'
        OR
        tenant_id = auth.jwt()->>'sub'
    );


-- ─────────────────────────────────────────────
-- 6. PERMISSIONS
-- ─────────────────────────────────────────────

GRANT ALL ON TABLE signing_sessions TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE signing_signers TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE signing_audit_log TO postgres, anon, authenticated, service_role;


-- ─────────────────────────────────────────────
-- 7. SCHEMA CACHE RELOAD
-- ─────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
