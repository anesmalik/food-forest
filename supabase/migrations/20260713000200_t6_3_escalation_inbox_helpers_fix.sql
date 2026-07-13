-- T6.3: Fixed helper RPC functions for escalation inbox
-- Removed caller identity parameters; derive from current_app_user() internally
-- Fixed ordering: compute latest hop per thread, THEN filter to current user

create or replace function get_my_escalated_threads()
returns table (thread_id uuid, question text, status qa_status, escalated_to uuid, reason text, created_at timestamptz)
language sql
security definer
set search_path to 'public'
stable
as $$
  with latest_escalations as (
    select distinct on (thread_id) thread_id, escalated_to, reason, created_at
    from qa_escalations
    order by thread_id, created_at desc
  )
  select
    le.thread_id,
    qt.question,
    qt.status,
    le.escalated_to,
    le.reason,
    le.created_at
  from latest_escalations le
  join qa_threads qt on qt.id = le.thread_id
  where le.escalated_to = current_app_user()
    and qt.status != 'closed'
  order by le.created_at desc;
$$;

grant execute on function get_my_escalated_threads() to authenticated;

create or replace function get_current_escalation_addressee(p_thread_id uuid)
returns uuid
language sql
security definer
set search_path to 'public'
stable
as $$
  select escalated_to
  from qa_escalations
  where thread_id = p_thread_id
  order by created_at desc
  limit 1;
$$;

grant execute on function get_current_escalation_addressee(uuid) to authenticated;
