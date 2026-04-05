--- Migration: Adding is_truncated guardrail column
--- This enables the platform to track when an overly massive document hits our 
--- token context limits (Vulnerability #6) and surface it directly to the UI.

-- Add to contracts table (for ingestion pipeline)
ALTER TABLE contracts 
ADD COLUMN IF NOT EXISTS is_truncated BOOLEAN DEFAULT false;

-- Add to contract_versions table (for diffs and version history)
ALTER TABLE contract_versions 
ADD COLUMN IF NOT EXISTS is_truncated BOOLEAN DEFAULT false;
