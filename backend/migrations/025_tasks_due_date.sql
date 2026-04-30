-- ============================================================
-- Migration 025: Schedule Hub task calendar fields
-- ============================================================

begin;

-- due_date already exists in older installs as timestamptz. Keep that type
-- compatible with the current task APIs and add it only for fresh databases.
alter table tasks
    add column if not exists due_date timestamptz,
    add column if not exists event_time time,
    add column if not exists location text;

create index if not exists idx_tasks_due_date
    on tasks(tenant_id, due_date)
    where due_date is not null;

notify pgrst, 'reload schema';

commit;
