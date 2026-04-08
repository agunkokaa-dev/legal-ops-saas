-- ============================================================
-- Migration 015: Harden Clerk-backed Row Level Security
-- Project: CLAUSE Legal Ops SaaS
-- Date: 2026-04-08
-- Description:
--   Replaces earlier ad-hoc RLS policies with Clerk-compatible helper
--   functions, FORCE RLS, and comprehensive tenant isolation across all
--   tenant-scoped tables added since the original RLS rollout.
-- ============================================================

begin;

create schema if not exists app;

create or replace function app.current_tenant_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt()->>'tenant_id', ''),
    nullif(auth.jwt()->>'org_id', ''),
    nullif(auth.jwt()->'o'->>'id', ''),
    nullif(auth.jwt()->>'sub', '')
  );
$$;

create or replace function app.current_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt()->>'sub', '');
$$;

create or replace function app.is_authenticated()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt()->>'role', '') = 'authenticated';
$$;

drop function if exists public.current_tenant_id();

do $$
declare
  tbl text;
  pol record;
  tenant_tables text[] := array[
    'matters',
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
    'task_template_items',
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
  end loop;
end $$;

do $$
declare
  tbl text;
  generic_tables text[] := array[
    'matters',
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
    'task_template_items',
    'activity_logs',
    'clause_library',
    'bilingual_clauses',
    'document_relationships',
    'task_execution_logs',
    'signing_sessions',
    'signing_signers',
    'signing_audit_log'
  ];
begin
  foreach tbl in array generic_tables loop
    if to_regclass(format('public.%s', tbl)) is null then
      continue;
    end if;

    execute format($policy$
      create policy tenant_isolation_all
      on public.%I
      for all
      to authenticated
      using (
        app.is_authenticated()
        and tenant_id = app.current_tenant_id()
      )
      with check (
        app.is_authenticated()
        and tenant_id = app.current_tenant_id()
      )
    $policy$, tbl);
  end loop;
end $$;

-- Shared system + tenant-specific playbooks.
do $$
begin
  if to_regclass('public.company_playbooks') is not null then
    create policy company_playbooks_select
    on public.company_playbooks
    for select
    to authenticated
    using (
      app.is_authenticated()
      and (
        tenant_id = app.current_tenant_id()
        or tenant_id is null
      )
    );

    create policy company_playbooks_write
    on public.company_playbooks
    for all
    to authenticated
    using (
      app.is_authenticated()
      and tenant_id = app.current_tenant_id()
    )
    with check (
      app.is_authenticated()
      and tenant_id = app.current_tenant_id()
    );
  end if;
end $$;

-- Child tables without tenant_id are scoped through their parent rows.
do $$
begin
  if to_regclass('public.sub_tasks') is not null then
    alter table public.sub_tasks enable row level security;
    alter table public.sub_tasks force row level security;

    create policy sub_tasks_tenant_isolation
    on public.sub_tasks
    for all
    to authenticated
    using (
      app.is_authenticated()
      and exists (
        select 1
        from public.tasks t
        where t.id = sub_tasks.task_id
          and t.tenant_id = app.current_tenant_id()
      )
    )
    with check (
      app.is_authenticated()
      and exists (
        select 1
        from public.tasks t
        where t.id = sub_tasks.task_id
          and t.tenant_id = app.current_tenant_id()
      )
    );
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
