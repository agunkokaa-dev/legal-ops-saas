-- ============================================================
-- Migration 018: RLS Clerk Production Auth Fallback
-- ============================================================

begin;

create schema if not exists app;

-- Update the tenant resolver function to check the Clerk Production
-- custom 'tenant_id' claim first, then fall back to nested org 'o.id', 
-- legacy 'org_id', and finally the user 'sub'.
create or replace function app.current_tenant_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt()->>'tenant_id', '')::text,
    nullif(auth.jwt()->'o'->>'id', '')::text,
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

-- We also need to re-apply this to 'matters' just in case it was missed 
-- in the previous migration, along with all the other tenant tables.
do $$
declare
  tbl text;
  tenant_tables text[] := array[
    'matters',
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

    -- Apply unified multi-tenant isolation policy
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

-- ----------------------------------------------------------------------------------
-- SUPABASE STORAGE BUCKET RLS POLICY UPDATES
-- ----------------------------------------------------------------------------------
-- Ensure the storage bucket "matter-files" respects the new tenant resolver:

drop policy if exists "Tenant Isolation For storage.objects (Select)" on storage.objects;
drop policy if exists "Tenant Isolation For storage.objects (Insert)" on storage.objects;
drop policy if exists "Tenant Isolation For storage.objects (Update)" on storage.objects;
drop policy if exists "Tenant Isolation For storage.objects (Delete)" on storage.objects;

-- We extract the first part of the storage path (which is the tenant_id)
-- e.g., bucket storage path matches "tenant_id/..."
create policy "Tenant Isolation For storage.objects (Select)"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'matter-files'
    and (storage.foldername(name))[1] = app.current_tenant_id()
  );

create policy "Tenant Isolation For storage.objects (Insert)"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'matter-files'
    and (storage.foldername(name))[1] = app.current_tenant_id()
  );

create policy "Tenant Isolation For storage.objects (Update)"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'matter-files'
    and (storage.foldername(name))[1] = app.current_tenant_id()
  )
  with check (
    bucket_id = 'matter-files'
    and (storage.foldername(name))[1] = app.current_tenant_id()
  );

create policy "Tenant Isolation For storage.objects (Delete)"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'matter-files'
    and (storage.foldername(name))[1] = app.current_tenant_id()
  );

notify pgrst, 'reload schema';

commit;
