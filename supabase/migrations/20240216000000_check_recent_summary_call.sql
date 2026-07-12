-- T2.3: Add check_recent_summary_call function for rate limiting.
--
-- This is a narrow SECURITY DEFINER function that returns only a boolean,
-- not row content. It preserves "no SELECT-own" on ai_call_log (nobody can
-- browse the log) while allowing the pre-hoc rate-limit check spec §1.14 wants.
--
-- The function answers: "Did this user call supervisor_summary for this target
-- recently (within the window_minutes, default 5)?"
--
-- Returns true/false only — never exposes prompt, response, or other row content.

create or replace function check_recent_summary_call(
  target_user_id uuid,
  window_minutes int default 5
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from ai_call_log
    where user_id = current_app_user()
      and function = 'supervisor_summary'
      and query = target_user_id::text
      and created_at > now() - (window_minutes || ' minutes')::interval
  );
$$;

revoke execute on function check_recent_summary_call(uuid, int) from public, anon;
grant execute on function check_recent_summary_call(uuid, int) to authenticated;
