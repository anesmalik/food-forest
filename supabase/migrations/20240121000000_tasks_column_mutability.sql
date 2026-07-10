-- Non-state column mutability: title, description, due_date, assignee_id
-- editable by assigner only while non-terminal (assigned or in_progress)
create or replace function enforce_task_column_mutability() returns trigger
language plpgsql
as $$
declare
  caller_id uuid := current_app_user();
  any_non_state_change boolean;
begin
  -- If state is changing, skip this check (state-transition trigger handles it)
  if OLD.state != NEW.state then
    return NEW;
  end if;

  -- Check if any non-state column has changed
  any_non_state_change := (
    OLD.title != NEW.title
    or OLD.description != NEW.description
    or OLD.due_date != NEW.due_date
    or OLD.assignee_id != NEW.assignee_id
  );

  if not any_non_state_change then
    return NEW;
  end if;

  -- Reject if state is terminal
  if OLD.state in ('completed', 'cancelled', 'missed') then
    raise exception 'tasks: cannot edit non-state columns in terminal state %', OLD.state;
  end if;

  -- Reject if caller is not the assigner
  if caller_id != OLD.assigner_id then
    raise exception 'tasks: only the assigner can edit task columns';
  end if;

  return NEW;
end;
$$;

create trigger tasks_column_mutability
before update on tasks
for each row
execute function enforce_task_column_mutability();
