-- ============================================================
-- Migration 018: Fix tasks schema constraints
-- Project: CLAUSE Legal Ops SaaS
-- Description: Drops NOT NULL constraint on user_id in tasks 
--              and adds source_note_id if it's missing.
-- ============================================================

-- 1. Drop NOT NULL constraint on user_id 
--    (Handles the Tenant ID migration where user_id is deprecated in favor of tenant_id)
ALTER TABLE tasks ALTER COLUMN user_id DROP NOT NULL;

-- 2. Add source_note_id column to tasks table 
--    (Required for the "Push to Backlog" feature in IntelligenceSidebar.tsx)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_note_id text;
