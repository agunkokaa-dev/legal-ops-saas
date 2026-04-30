-- ============================================================
-- Migration 026: Schedule Hub manual legal events
-- ============================================================

begin;

create schema if not exists app;

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

create table if not exists legal_events (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   text not null,
    matter_id   uuid references matters(id) on delete set null,
    contract_id uuid references contracts(id) on delete set null,

    title       text not null,
    event_type  text not null check (event_type in (
                    'hearing', 'client_meeting', 'board_meeting',
                    'internal_review', 'compliance_review',
                    'filing_deadline', 'signature_deadline',
                    'contract_renewal', 'other'
                )),
    priority    text not null default 'normal' check (
                    priority in ('high', 'normal', 'low')),

    event_date  date not null,
    event_time  time,
    location    text,
    notes       text,
    is_all_day  boolean default false,

    created_by  text,
    created_at  timestamptz default now(),
    updated_at  timestamptz default now()
);

create index if not exists idx_legal_events_tenant_date
    on legal_events(tenant_id, event_date);

create index if not exists idx_legal_events_tenant_type
    on legal_events(tenant_id, event_type);

create index if not exists idx_legal_events_contract
    on legal_events(contract_id)
    where contract_id is not null;

alter table legal_events enable row level security;
alter table legal_events force row level security;

drop policy if exists zero_trust_org_isolation on legal_events;

create policy zero_trust_org_isolation
    on legal_events
    for all
    to authenticated
    using (
        app.current_tenant_id() is not null
        and tenant_id = app.current_tenant_id()
    )
    with check (
        app.current_tenant_id() is not null
        and tenant_id = app.current_tenant_id()
    );

grant all on table legal_events to postgres, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
