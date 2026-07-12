-- T1.6: Fix ai_call_log policies and grants.
-- Spec §1.11/§1.12: write-only-for-users (INSERT, user_id = current_app_user()),
-- SELECT admin-only (using is_admin()).  The existing ai_call_log_select policy
-- scoped SELECT to user_id = current_app_user() — the opposite of what spec
-- requires — and must be dropped.

-- ---------------------------------------------------------------------------
-- Part 1: Drop the wrong policy, create the correct ones.
-- ---------------------------------------------------------------------------
drop policy if exists ai_call_log_select on ai_call_log;

-- INSERT-own: a user can write their own row (T2.3 summary action).
create policy "ai_call_log_insert" on ai_call_log for insert to authenticated
  with check (user_id = current_app_user());

-- SELECT admin-only: reuses is_admin(), the existing SECURITY DEFINER function.
-- No SELECT-own policy — the log is an audit trail, not a user-facing history.
create policy "ai_call_log_select_admin" on ai_call_log for select to authenticated
  using (is_admin());

-- ---------------------------------------------------------------------------
-- Part 2: Tighten grants.
-- authenticated gets exactly INSERT and SELECT — RLS then decides which rows
-- and whether at all.  anon gets nothing.  service_role gets everything.
-- ---------------------------------------------------------------------------
revoke all on table ai_call_log from anon, authenticated;
grant insert, select on table ai_call_log to authenticated;
grant all on table ai_call_log to service_role;