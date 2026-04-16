-- ============================================================
-- Migration 020: Multi-Agent Debate Sessions
-- ============================================================

begin;

create table if not exists public.debate_sessions (
    id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    contract_id uuid not null references public.contracts(id) on delete cascade,
    version_id uuid not null references public.contract_versions(id) on delete cascade,
    issue_id uuid references public.negotiation_issues(id) on delete set null,

    deviation_id text not null,
    deviation_snapshot jsonb not null,

    turns jsonb not null default '[]'::jsonb,
    verdict jsonb,

    status text not null default 'queued'
        check (status in ('queued', 'running', 'completed', 'failed')),
    current_turn integer not null default 0,
    total_turns integer not null default 5,

    total_input_tokens integer not null default 0,
    total_output_tokens integer not null default 0,
    model_breakdown jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    completed_at timestamptz,
    duration_ms integer,
    error_message text
);

create index if not exists idx_debate_sessions_tenant_id
    on public.debate_sessions(tenant_id);

create index if not exists idx_debate_sessions_contract_id
    on public.debate_sessions(contract_id);

create index if not exists idx_debate_sessions_deviation_id
    on public.debate_sessions(deviation_id);

create index if not exists idx_debate_sessions_status
    on public.debate_sessions(status);

alter table public.debate_sessions enable row level security;
alter table public.debate_sessions force row level security;

drop policy if exists zero_trust_org_isolation on public.debate_sessions;

create policy zero_trust_org_isolation
on public.debate_sessions
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

grant all on table public.debate_sessions to postgres, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
