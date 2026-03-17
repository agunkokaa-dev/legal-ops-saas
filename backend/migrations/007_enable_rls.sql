-- ==============================================================================
-- MIGRATION: 007_enable_rls.sql
-- PURPOSE: Enforce Row Level Security (RLS) across all multi-tenant tables.
-- This ensures that a client using an Anon Key + JWT can ONLY access rows
-- matching their Auth payload, completely neutralizing cross-tenant data leaks.
-- ==============================================================================

-- 1. Enable RLS on core tables
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- 2. Create JWT Claim Extraction Function
-- This function securely reads the custom JWT payload injected by Supabase's Anon Client.
-- It attempts to use Clerk's `org_id` first, falling back to `sub` (User ID).
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS text AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'org_id', ''),
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')
  )
$$ LANGUAGE SQL STABLE;

-- 3. Define Secure Policies for Core Tables
-- The FOR ALL clause covers SELECT, INSERT, UPDATE, and DELETE.
-- USING determines read access visibility, WITH CHECK determines write restrictions.

-- Matters
CREATE POLICY tenant_isolation_matters ON matters
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Contracts
CREATE POLICY tenant_isolation_contracts ON contracts
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Contract Obligations
CREATE POLICY tenant_isolation_obs ON contract_obligations
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Contract Clauses
CREATE POLICY tenant_isolation_clauses ON contract_clauses
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Tasks
CREATE POLICY tenant_isolation_tasks ON tasks
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Task Templates
CREATE POLICY tenant_isolation_task_templates ON task_templates
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  
-- Task Template Items (Derived from Parent Template)
CREATE POLICY tenant_isolation_task_template_items ON task_template_items
  FOR ALL 
  USING (EXISTS (SELECT 1 FROM task_templates WHERE id = task_template_items.template_id AND tenant_id = current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM task_templates WHERE id = task_template_items.template_id AND tenant_id = current_tenant_id()));

-- Sub-tasks (Derived from Parent Task)
CREATE POLICY tenant_isolation_sub_tasks ON sub_tasks
  FOR ALL
  USING (EXISTS (SELECT 1 FROM tasks WHERE id = sub_tasks.task_id AND tenant_id = current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM tasks WHERE id = sub_tasks.task_id AND tenant_id = current_tenant_id()));

-- Activity Logs
CREATE POLICY tenant_isolation_activity_logs ON activity_logs
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
