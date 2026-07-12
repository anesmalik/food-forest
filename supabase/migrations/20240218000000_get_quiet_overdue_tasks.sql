-- T2.5: Helper function to find overdue+quiet tasks efficiently.
-- Used by the task-alerts cron (GET /api/cron/task-alerts) to identify qualifying tasks
-- for both alert (24h) and missed (7d) transitions.

create or replace function get_quiet_overdue_tasks(
  due_threshold_date date,
  quiet_cutoff_ts timestamptz
)
returns table(id uuid)
language sql
stable
as $$
  select t.id
  from tasks t
  where t.state in ('assigned', 'in_progress')
    and t.due_date < due_threshold_date
    -- Assignee has authored no journal entries in the last 48h (quiet condition)
    and not exists (
      select 1 from journal_entries je
      where je.author_id = t.assignee_id
        and je.created_at > quiet_cutoff_ts
    );
$$;

grant execute on function get_quiet_overdue_tasks(date, timestamptz) to service_role;
