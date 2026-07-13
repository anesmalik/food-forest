-- find_escalation_target: generic "walk up from this user" — reusable by both
-- the first hop (from the asker, this ticket) and later hops (from the current
-- addressee, T4.7). Do NOT hardcode this to "asker" — T4.7 depends on reusing
-- it from a different starting point.
create or replace function find_escalation_target(p_from_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  current_id uuid;
  fallback_admin uuid;
begin
  select supervisor_id into current_id from users where id = p_from_user_id;

  while current_id is not null loop
    -- Check if this user is live (not deactivated) and has a role
    if exists (
      select 1 from users
      where id = current_id
        and deactivated_at is null
        and role is not null
    ) then
      return current_id;
    end if;

    select supervisor_id into current_id from users where id = current_id;
  end loop;

  -- chain exhausted (e.g. an unplaced bare-row user with no supervisor above
  -- them) without finding a live, ranked ancestor: fall back to the admin.
  select id into fallback_admin
  from users
  where role = 'admin' and deactivated_at is null
  order by created_at asc
  limit 1;

  return fallback_admin;
end;
$$;

grant execute on function find_escalation_target(uuid) to authenticated;

-- escalate_refused_question: no asker parameter, by design — same principle
-- as search_corpus (T1.6). Identity comes from current_app_user() internally.
-- If you find yourself adding an asker/user_id parameter "for testability",
-- stop — that would let any authenticated caller create threads attributed
-- to someone else. Reject that patch outright, same as T1.6's own rule.
create or replace function escalate_refused_question(p_question text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  asker_id uuid;
  new_thread_id uuid;
  target_id uuid;
begin
  asker_id := current_app_user();
  if asker_id is null then
    raise exception 'not authenticated';
  end if;

  insert into qa_threads (asker_id, question, status, visibility_scope)
  values (asker_id, p_question, 'escalated', 'organization')
  returning id into new_thread_id;

  target_id := find_escalation_target(asker_id);

  insert into qa_escalations (thread_id, escalated_to, escalated_by, reason)
  values (new_thread_id, target_id, null, 'ai_refusal');

  return new_thread_id;
end;
$$;

grant execute on function escalate_refused_question(text) to authenticated;
