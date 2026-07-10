-- Re-apply column-mutability trigger: add no-op rejection so that
-- genuine self-loops (state unchanged AND no non-state columns changed)
-- are rejected rather than silently passing through.
-- The state-transition trigger no longer intercepts same-state updates;
-- the column-mutability trigger is the sole gate for field edits.

create or replace function enforce_task_column_mutability() returns trigger
language plpgsql
as $$
declare
  caller_id uuid := current_app_user();
  any_non_state_change boolean;
begin
  -- If state is changing, skip this check (state-transition trigger handles it)
  if OLD.state is distinct from NEW.state then
    return NEW;
  end if;

  -- Check if any non-state column has changed
  any_non_state_change := (
    OLD.title is distinct from NEW.title
    or OLD.description is distinct from NEW.description
    or OLD.due_date is distinct from NEW.due_date
    or OLD.assignee_id is distinct from NEW.assignee_id
  );

  -- Reject genuine no-ops: state unchanged AND no non-state columns changed
  if not any_non_state_change then
    raise exception 'tasks: self-loop transition from % to % is not allowed', OLD.state, NEW.state;
  end if;

  -- Reject if state is terminal
  if OLD.state in ('completed', 'cancelled', 'missed') then
    raise exception 'tasks: cannot edit non-state columns in terminal state %', OLD.state;
  end if;

  -- Reject if caller is not the assigner
  if caller_id is distinct from OLD.assigner_id then
    raise exception 'tasks: only the assigner can edit task columns';
  end if;

  return NEW;
end;
$$;