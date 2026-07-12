-- T1.3: task_alerts table — one row per (task, alert_type) for overdue-quiet alerts.
-- INSERT is service_role only (T2.5 cron).  SELECT and dismiss (UPDATE of
-- dismissed_at) are scoped to the task's assigner + ancestors of the assignee
-- — the same subtree shape as the existing tasks SELECT policy from stage one.
-- No DELETE policy; dismissal is via dismissed_at, not row deletion.

create table task_alerts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  alert_type text not null
    check (alert_type in ('overdue_quiet')),
  created_at timestamptz not null default now(),
  dismissed_at timestamptz,

  -- Idempotency: one live alert row per (task, alert_type), period.
  constraint task_alerts_task_alert_unique unique (task_id, alert_type)
);

-- ---------------------------------------------------------------------------
-- RLS: fail-closed.  No policy for INSERT (service_role only) or DELETE (none).
-- ---------------------------------------------------------------------------
alter table task_alerts enable row level security;

-- SELECT: task's assigner, or any ancestor of the task's assignee.
-- This is the same subtree shape as the stage-one tasks_select policy, joined
-- through the tasks table.
create policy "task_alerts_select" on task_alerts for select to authenticated
  using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          t.assigner_id = current_app_user()
          or is_in_subtree(current_app_user(), t.assignee_id)
        )
    )
  );

-- UPDATE (dismiss): same visibility scope as SELECT, but only dismissed_at
-- may change — enforced by the trigger below, not the with-check clause.
-- Postgres with-check on UPDATE receives NEW; it cannot compare OLD vs NEW
-- column-by-column, so the trigger handles that.
create policy "task_alerts_update" on task_alerts for update to authenticated
  using (
    exists (
      select 1 from tasks t
      where t.id = task_id
        and (
          t.assigner_id = current_app_user()
          or is_in_subtree(current_app_user(), t.assignee_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Trigger: enforce that the only allowed UPDATE is setting dismissed_at
-- from NULL to a non-NULL value.  All other columns are immutable.
-- ---------------------------------------------------------------------------
create or replace function enforce_task_alerts_dismiss_only()
returns trigger
language plpgsql
as $$
begin
  -- Once dismissed, no further modification.
  if OLD.dismissed_at is not null then
    raise exception 'task_alerts: already dismissed, cannot modify';
  end if;

  -- Must be setting dismissed_at to a non-NULL value.
  if NEW.dismissed_at is null then
    raise exception 'task_alerts: dismissed_at must be set to a non-NULL value';
  end if;

  -- All other columns must be unchanged.
  if OLD.id != NEW.id
     or OLD.task_id != NEW.task_id
     or OLD.alert_type != NEW.alert_type
     or OLD.created_at != NEW.created_at then
    raise exception 'task_alerts: only dismissed_at is mutable';
  end if;

  return NEW;
end;
$$;

create trigger task_alerts_dismiss_only
  before update on task_alerts
  for each row
  execute function enforce_task_alerts_dismiss_only();

-- ---------------------------------------------------------------------------
-- Grants: service_role owns the table (INSERT via T2.5 cron).
-- Authenticated gets SELECT and UPDATE only (dismiss).
-- No INSERT for authenticated; no DELETE for anyone.
-- ---------------------------------------------------------------------------
grant all on table task_alerts to service_role;
grant select, update on table task_alerts to authenticated;