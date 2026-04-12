-- ============================================================
-- Migration 017: RLS Personal Workspace Fallback
-- Project: CLAUSE Legal Ops SaaS
-- Date: 2026-04-11
-- Description:
--   1. Adds a shared tenant resolver that falls back from Clerk org_id
--      to Clerk sub for personal workspaces.
--   2. Reapplies contracts and contract_versions RLS policies to use
--      the fallback resolver for both USING and WITH CHECK.
-- ============================================================

begin;

create schema if not exists app;

create or replace function app.current_tenant_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt()->>'org_id', '')::text,
    nullif(auth.jwt()->>'sub', '')::text
  );
$$;

create or replace function app.current_org_id()
returns text
language sql
stable
as $$
  select app.current_tenant_id();
$$;

do $$
declare
  tbl text;
  tenant_tables text[] := array[
    'contracts',
    'contract_versions',
    'contract_reviews',
    'contract_clauses',
    'contract_notes',
    'contract_obligations',
    'document_relationships',
    'contract_parties'
  ];
begin
  foreach tbl in array tenant_tables loop
    if to_regclass(format('public.%s', tbl)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);
    execute format('alter table public.%I force row level security', tbl);
    execute format('drop policy if exists zero_trust_org_isolation on public.%I', tbl);

    execute format($policy$
      create policy zero_trust_org_isolation
      on public.%I
      for all
      to authenticated
      using (
        app.current_tenant_id() is not null
        and tenant_id = app.current_tenant_id()
      )
      with check (
        app.current_tenant_id() is not null
        and tenant_id = app.current_tenant_id()
      )
    $policy$, tbl);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
