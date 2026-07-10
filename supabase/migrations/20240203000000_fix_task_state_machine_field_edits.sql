-- Fix: state-transition trigger should only handle actual state transitions.
-- When OLD.state = NEW.state, it's a field-only edit (or no-op), not a state
-- transition. The column-mutability trigger (enforce_task_column_mutability)
-- is responsible for validating field edits — it checks terminal-state
-- immutability, assigner-only access, AND rejects genuine no-ops.
--
-- The previous self-loop detection logic inside the state-transition trigger
-- was incorrectly rejecting legitimate field edits (title/description changed,
-- state untouched) because the "no fields changed" check was unreliable when
-- the client omits optional columns from the update payload.
--
-- Also fix the column-mutability trigger: replace != with is distinct from
-- to correctly handle NULL comparisons (same bug that was fixed in the
-- state-transition trigger in migration 20240129000000).

create or replace function enforce_task_state_transition() returns trigger
language plpgsql
as $$
declare
  caller_id uuid := current_app_user();
begin
  -- No state change: not a state transition. Return immediately and let
  -- enforce_task_column_mutability handle field-edit validation.
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

-- Fix column-mutability trigger: use is distinct from instead of !=
-- to correctly handle NULL comparisons. Also reject genuine no-ops
-- (state unchanged AND no non-state columns changed).
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
