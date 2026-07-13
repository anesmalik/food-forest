-- pass_escalation_up_chain: a human passing an escalation further up the tree.
-- No mutable assignee anywhere — this only ever appends. Reuses
-- find_escalation_target starting from the CURRENT ADDRESSEE, not the asker
-- (that's T4.6's job, this is the different starting point it was built for).
create or replace function pass_escalation_up_chain(p_thread_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  caller_id uuid;
  current_addressee uuid;
  new_target uuid;
  new_escalation_id uuid;
begin
  caller_id := current_app_user();
  if caller_id is null then
    raise exception 'not authenticated';
  end if;

  select escalated_to into current_addressee
  from qa_escalations
  where thread_id = p_thread_id
  order by created_at desc
  limit 1;

  if current_addressee is null then
    raise exception 'thread % has no escalation history', p_thread_id;
  end if;

  if current_addressee is distinct from caller_id then
    raise exception 'only the current addressee may pass this escalation up the chain';
  end if;

  new_target := find_escalation_target(caller_id);

  if new_target is not distinct from caller_id then
    raise exception 'no further escalation target exists above %; this is already the top of the chain', caller_id;
  end if;

  insert into qa_escalations (thread_id, escalated_to, escalated_by, reason)
  values (p_thread_id, new_target, caller_id, 'human_passed_up')
  returning id into new_escalation_id;

  return new_escalation_id;
end;
$$;

grant execute on function pass_escalation_up_chain(uuid) to authenticated;
