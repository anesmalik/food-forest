-- Fix task state-machine trigger bugs:
-- Bug 1: Self-loop early return was too permissive, allowing updates to terminal-state tasks
--        (completed, cancelled, missed should accept NO changes once final).
--        For non-terminal states, same-state updates are field mutations (allowed).
--        For terminal states, reject all updates (terminal means immutable).
-- Bug 2: Actor comparisons used != which silently fail with NULL (when current_app_user() is NULL).
--        Changed to IS DISTINCT FROM which correctly treats NULL as "not equal."

create or replace function enforce_task_state_transition() returns trigger
language plpgsql
as $$
declare
  caller_id uuid := current_app_user();
begin
  -- No state change — check if allowed
  if OLD.state = NEW.state then
    -- Terminal states are immutable; no changes allowed at all
    if OLD.state in ('completed', 'cancelled', 'missed') then
      raise exception 'tasks: cannot update a task in a terminal state';
    end if;
    -- Non-terminal state with no state change: allow (field mutations OK)
    return NEW;
  end if;

  -- Terminal states accept no further transitions
  if OLD.state in ('completed', 'cancelled', 'missed') then
    raise exception 'tasks: % is a terminal state, no further transitions allowed', OLD.state;
  end if;

  -- missed is system-only, no user-reachable path in stage one
  if NEW.state = 'missed' then
    raise exception 'tasks: missed is not user-reachable in stage one';
  end if;

  -- assigned -> in_progress: assignee only
  if OLD.state = 'assigned' and NEW.state = 'in_progress' then
    if caller_id is distinct from OLD.assignee_id then
      raise exception 'tasks: only the assignee can move a task to in_progress';
    end if;
    return NEW;
  end if;

  -- assigned -> completed, or in_progress -> completed: assignee only
  if NEW.state = 'completed' and OLD.state in ('assigned', 'in_progress') then
    if caller_id is distinct from OLD.assignee_id then
      raise exception 'tasks: only the assignee can complete a task';
    end if;
    NEW.completed_at := now();
    return NEW;
  end if;

  -- assigned -> cancelled, or in_progress -> cancelled: assigner only
  if NEW.state = 'cancelled' and OLD.state in ('assigned', 'in_progress') then
    if caller_id is distinct from OLD.assigner_id then
      raise exception 'tasks: only the assigner can cancel a task';
    end if;
    return NEW;
  end if;

  -- Anything else is an illegal edge
  raise exception 'tasks: illegal transition from % to %', OLD.state, NEW.state;
end;
$$;
