-- T1.4: Amend enforce_task_state_transition() to allow (assigned|in_progress) → missed
-- through expire_task() only, and create expire_task() as the sole callable path.
--
-- This is the highest-risk migration in the stage — it reopens the task state
-- machine, the exact surface stage one spent the most review effort locking down.
-- The change is narrow: the missed block that formerly rejected unconditionally
-- now accepts exactly one case — when the transaction-local marker
-- app.system_transition = 'missed' is set, and only from assigned or in_progress.
-- Every other transition, actor check, and terminal-state guard is unchanged.

-- ---------------------------------------------------------------------------
-- Part 1: Amend the state-transition trigger — missed block only.
-- Everything else is the current deployed version verbatim.
-- ---------------------------------------------------------------------------
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

  -- missed is system-only; reachable only through expire_task(), which sets
  -- app.system_transition = 'missed' for this transaction before updating.
  -- A bare UPDATE ... SET state = 'missed' — including under service-role —
  -- with the marker unset must still be rejected.  This is the stage-one
  -- §1.6a property: "unreachable by any user path including service-role"
  -- now has exactly one door, and this is not it unless the marker is present.
  if NEW.state = 'missed' then
    if current_setting('app.system_transition', true) = 'missed' then
      return NEW;
    end if;
    raise exception 'tasks: missed is not user-reachable except via expire_task()';
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

-- ---------------------------------------------------------------------------
-- Part 2: expire_task() — the sole callable path to drive a task to missed.
-- SECURITY DEFINER so it can set the GUC and update the task regardless of
-- the caller's RLS scope.  EXECUTE is revoked from public (Postgres grants
-- EXECUTE to PUBLIC by default on function creation), anon, and authenticated,
-- and granted only to service_role.  A SECURITY DEFINER function callable by
-- users is itself the hole, regardless of what the trigger marker does.
-- ---------------------------------------------------------------------------
create or replace function expire_task(target uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- is_local = true: the marker is transaction-scoped, not session-scoped.
  -- It cannot leak past the one UPDATE it guards.
  perform set_config('app.system_transition', 'missed', true);
  update tasks set state = 'missed' where id = target;
exception
  when others then
    -- Benign no-op: the target was already terminal (completed/cancelled/
    -- already missed) by the time this ran, or some other race made the
    -- transition illegal.  This is a logic race whose predicate went stale
    -- between the caller's SELECT and this call — not a transient failure
    -- to retry, and it must not abort whatever batch called this (T2.5's
    -- cron processes many tasks per run; one stale row must not sink it).
    raise notice 'expire_task: no-op for task % (%): %', target, SQLERRM, SQLSTATE;
end;
$$;

-- Revoke default PUBLIC execute, then grant only to service_role.
-- The order matters: revoke first, then grant.
revoke execute on function expire_task(uuid) from public, anon, authenticated;
grant execute on function expire_task(uuid) to service_role;