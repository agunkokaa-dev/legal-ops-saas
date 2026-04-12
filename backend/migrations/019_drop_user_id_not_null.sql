-- ============================================================
-- Migration 019: Drop user_id NOT NULL constraints
-- ============================================================

begin;

-- Since the system relies purely on tenant_id, user_id is now optional
-- and may be null for organization-level actions.

do $$
declare
  t text;
  tenant_tables text[] := array[
    'contracts',
    'contract_versions',
    'contract_reviews',
    'contract_clauses',
    'contract_notes',
    'contract_obligations',
    'document_relationships',
    'contract_parties',
    'matters'
  ];
begin
  foreach t in array tenant_tables loop
    if to_regclass(format('public.%s', t)) is not null then
      begin
        execute format('alter table public.%I alter column user_id drop not null', t);
      exception
        when undefined_column then
          -- Column doesn't exist on this table, safe to ignore
      end;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
