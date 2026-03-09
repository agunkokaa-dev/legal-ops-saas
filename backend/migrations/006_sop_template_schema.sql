-- ============================================================
-- Migration 006: SOP Template Engine Tables
-- Project: CLAUSE Legal Ops SaaS
-- Description: Creates task_templates, task_template_items, 
--              and activity_logs tables (tasks assumed to exist
--              or created here).
-- ============================================================

-- -----------------------------------------------
-- 1. CREATE task_templates
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS task_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    name text NOT NULL,
    matter_type text,
    created_at timestamptz DEFAULT now()
);

-- -----------------------------------------------
-- 2. CREATE task_template_items
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS task_template_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id uuid NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    days_offset int DEFAULT 0,
    position int DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

-- -----------------------------------------------
-- 3. CREATE tasks (if not already existing)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    matter_id uuid NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    status text DEFAULT 'backlog',
    due_date timestamptz,
    created_at timestamptz DEFAULT now()
);

-- -----------------------------------------------
-- 4. CREATE activity_logs (if not already existing)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    matter_id uuid REFERENCES matters(id) ON DELETE CASCADE,
    task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
    action text NOT NULL,
    actor_name text DEFAULT 'System/User',
    created_at timestamptz DEFAULT now()
);

-- -----------------------------------------------
-- 5. MANDATORY RLS: Clerk JWT Tenant Isolation
-- -----------------------------------------------
ALTER TABLE task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Strict Tenant Isolation for task_templates" ON task_templates
    FOR ALL USING (tenant_id = auth.jwt()->>'org_id' OR tenant_id = auth.jwt()->>'sub');

CREATE POLICY "Strict Tenant Isolation for task_template_items" ON task_template_items
    FOR ALL USING (
        template_id IN (SELECT id FROM task_templates WHERE tenant_id = auth.jwt()->>'org_id' OR tenant_id = auth.jwt()->>'sub')
    );

CREATE POLICY "Strict Tenant Isolation for tasks" ON tasks
    FOR ALL USING (tenant_id = auth.jwt()->>'org_id' OR tenant_id = auth.jwt()->>'sub');

CREATE POLICY "Strict Tenant Isolation for activity_logs" ON activity_logs
    FOR ALL USING (tenant_id = auth.jwt()->>'org_id' OR tenant_id = auth.jwt()->>'sub');

-- -----------------------------------------------
-- 6. PERMISSIONS & SCHEMA CACHE
-- -----------------------------------------------
GRANT ALL ON TABLE task_templates TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE task_template_items TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE tasks TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE activity_logs TO postgres, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
