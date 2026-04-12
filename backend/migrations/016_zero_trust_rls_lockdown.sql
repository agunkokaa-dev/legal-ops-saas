-- ============================================================
-- Migration 016: Zero-Trust Tenant Isolation Lockdown
-- Project: CLAUSE Legal Ops SaaS
-- Date: 2026-04-10
-- Description:
--   1. Enforces org-scoped RLS using Clerk org_id only.
--   2. Forces RLS on every tenant-bound table currently in scope.
--   3. Applies parent-row RLS to child tables without tenant_id.
--   4. Limits this migration to application tables in the public schema.
-- ============================================================

begin;

create schema if not exists app;

create or replace function app.current_org_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt()->>'org_id', '')::text;
$$;

do $$
declare
  tbl text;
  pol record;
  tenant_tables text[] := array[
    'matters',
    'matter_tasks',
    'matter_documents',
    'contracts',
    'contract_versions',
    'contract_reviews',
    'contract_obligations',
    'contract_clauses',
    'contract_notes',
    'negotiation_issues',
    'negotiation_rounds',
    'tasks',
    'task_templates',
    'activity_logs',
    'company_playbooks',
    'clause_library',
    'bilingual_clauses',
    'document_relationships',
    'task_execution_logs',
    'signing_sessions',
    'signing_signers',
    'signing_audit_log'
  ];
begin
  foreach tbl in array tenant_tables loop
    if to_regclass(format('public.%s', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('alter table public.%I force row level security', tbl);

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;

    execute format($policy$
      create policy zero_trust_org_isolation
      on public.%I
      for all
      to authenticated
      using (
        auth.jwt()->>'org_id' is not null
        and tenant_id = (auth.jwt()->>'org_id')::text
      )
      with check (
        auth.jwt()->>'org_id' is not null
        and tenant_id = (auth.jwt()->>'org_id')::text
      )
    $policy$, tbl);
  end loop;
end $$;

do $$
declare
  pol record;
begin
  if to_regclass('public.task_template_items') is not null then
    alter table public.task_template_items enable row level security;
    alter table public.task_template_items force row level security;

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'task_template_items'
    loop
      execute format('drop policy if exists %I on public.task_template_items', pol.policyname);
    end loop;

    create policy zero_trust_task_template_items
    on public.task_template_items
    for all
    to authenticated
    using (
      auth.jwt()->>'org_id' is not null
      and exists (
        select 1
        from public.task_templates tt
        where tt.id = task_template_items.template_id
          and tt.tenant_id = (auth.jwt()->>'org_id')::text
      )
    )
    with check (
      auth.jwt()->>'org_id' is not null
      and exists (
        select 1
        from public.task_templates tt
        where tt.id = task_template_items.template_id
          and tt.tenant_id = (auth.jwt()->>'org_id')::text
      )
    );
  end if;
end $$;

do $$
declare
  pol record;
begin
  if to_regclass('public.sub_tasks') is not null then
    alter table public.sub_tasks enable row level security;
    alter table public.sub_tasks force row level security;

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'sub_tasks'
    loop
      execute format('drop policy if exists %I on public.sub_tasks', pol.policyname);
    end loop;

    create policy zero_trust_sub_tasks
    on public.sub_tasks
    for all
    to authenticated
    using (
      auth.jwt()->>'org_id' is not null
      and exists (
        select 1
        from public.tasks t
        where t.id = sub_tasks.task_id
          and t.tenant_id = (auth.jwt()->>'org_id')::text
      )
    )
    with check (
      auth.jwt()->>'org_id' is not null
      and exists (
        select 1
        from public.tasks t
        where t.id = sub_tasks.task_id
          and t.tenant_id = (auth.jwt()->>'org_id')::text
      )
    );
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
