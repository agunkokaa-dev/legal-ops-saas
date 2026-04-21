ALTER TABLE contract_versions
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'uploaded';

ALTER TABLE contract_versions
ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

ALTER TABLE contract_versions
ADD COLUMN IF NOT EXISTS finalized_by TEXT;

ALTER TABLE contract_versions
ADD COLUMN IF NOT EXISTS parent_version_id UUID REFERENCES contract_versions(id);

ALTER TABLE contract_versions DROP CONSTRAINT IF EXISTS contract_versions_source_check;
ALTER TABLE contract_versions
ADD CONSTRAINT contract_versions_source_check
    CHECK (source IN ('uploaded', 'internal_finalized', 'counterparty_upload'));

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts
ADD CONSTRAINT contracts_status_check
    CHECK (status IN (
        'Active',
        'ARCHIVED',
        'Archived',
        'Awaiting_Counterparty',
        'Draft',
        'Executed',
        'EXPIRED',
        'Expired',
        'Failed',
        'Finalized',
        'In_Negotiation',
        'Negotiating',
        'Partially Signed',
        'Pending Approval',
        'Pending Review',
        'Processing',
        'Queued',
        'Ready to Sign',
        'Review',
        'Review_Incomplete',
        'Reviewed',
        'Signed',
        'Signing in Progress',
        'Superseded',
        'TEMPLATE',
        'Template',
        'TERMINATED',
        'Terminated'
    ));

CREATE INDEX IF NOT EXISTS idx_versions_source ON contract_versions(source);
CREATE INDEX IF NOT EXISTS idx_versions_parent ON contract_versions(parent_version_id);
