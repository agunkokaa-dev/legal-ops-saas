-- ============================================================
-- Migration 023: AI Usage Events
-- Tracks LLM/embedding token usage and estimated cost per tenant.
-- ============================================================

begin;

create table if not exists public.ai_usage_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    workflow text not null,
    model text not null,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    estimated_cost_usd numeric(10, 6) not null default 0,
    latency_ms integer not null default 0,
    contract_id uuid references public.contracts(id) on delete set null,
    cache_hit boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_tenant_date
    on public.ai_usage_events(tenant_id, created_at desc);

create index if not exists idx_ai_usage_workflow
    on public.ai_usage_events(workflow, created_at desc);

create index if not exists idx_ai_usage_contract
    on public.ai_usage_events(contract_id);

alter table public.ai_usage_events enable row level security;
alter table public.ai_usage_events force row level security;

drop policy if exists zero_trust_org_isolation on public.ai_usage_events;

create policy zero_trust_org_isolation
on public.ai_usage_events
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

grant all on table public.ai_usage_events to postgres, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
