-- ============================================================
-- Migration 019: Fix tasks matter_id constraint
-- Project: CLAUSE Legal Ops SaaS
-- Description: Drops NOT NULL constraint on matter_id in tasks 
--              so standalone contracts can push notes to backlog.
-- ============================================================

ALTER TABLE tasks ALTER COLUMN matter_id DROP NOT NULL;
