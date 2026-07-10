-- Task state-machine trigger: validates legal state transitions and sets completed_at
create or replace function enforce_task_state_transition() returns trigger
language plpgsql
as $$
declare
  caller_id uuid := current_app_user();
begin
  -- No state change — nothing to validate, let it through
  if OLD.state = NEW.state then
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
    if caller_id != OLD.assignee_id then
      raise exception 'tasks: only the assignee can move a task to in_progress';
    end if;
    return NEW;
  end if;

  -- assigned -> completed, or in_progress -> completed: assignee only
  if NEW.state = 'completed' and OLD.state in ('assigned', 'in_progress') then
    if caller_id != OLD.assignee_id then
      raise exception 'tasks: only the assignee can complete a task';
    end if;
    NEW.completed_at := now();
    return NEW;
  end if;

  -- assigned -> cancelled, or in_progress -> cancelled: assigner only
  if NEW.state = 'cancelled' and OLD.state in ('assigned', 'in_progress') then
    if caller_id != OLD.assigner_id then
      raise exception 'tasks: only the assigner can cancel a task';
    end if;
    return NEW;
  end if;

  -- Anything else is an illegal edge
  raise exception 'tasks: illegal transition from % to %', OLD.state, NEW.state;
end;
$$;

create trigger tasks_state_transition
before update on tasks
for each row
execute function enforce_task_state_transition();
