-- ============================================================
-- Migration 021: Counsel Sessions on debate_sessions
-- ============================================================

begin;

alter table public.debate_sessions
    add column if not exists session_kind text not null default 'debate'
        check (session_kind in ('debate', 'counsel'));

alter table public.debate_sessions
    add column if not exists session_type text;

alter table public.debate_sessions
    add column if not exists messages jsonb not null default '[]'::jsonb;

alter table public.debate_sessions
    add column if not exists is_active boolean not null default true;

alter table public.debate_sessions
    add column if not exists updated_at timestamptz not null default now();

update public.debate_sessions
set session_kind = coalesce(session_kind, 'debate'),
    updated_at = coalesce(updated_at, completed_at, created_at),
    is_active = coalesce(is_active, false),
    session_type = coalesce(session_type, 'deviation'),
    messages = coalesce(messages, '[]'::jsonb);

alter table public.debate_sessions
    alter column deviation_id drop not null;

alter table public.debate_sessions
    alter column deviation_snapshot drop not null;

create index if not exists idx_debate_sessions_session_kind
    on public.debate_sessions(session_kind);

create index if not exists idx_debate_sessions_contract_session_kind
    on public.debate_sessions(contract_id, session_kind, updated_at desc);

notify pgrst, 'reload schema';

commit;
