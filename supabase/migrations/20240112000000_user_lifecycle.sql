-- Stage One Step 1: User Lifecycle
-- 1. Make users.role nullable (two-phase user creation: webhook identity-only, admin completes placement)
-- 2. assign_user_placement() — sole path for role/supervisor mutation, admin-gated, cycle-rejecting
-- 3. try_bootstrap_admin() — guarded first-admin promotion, advisory-lock, zero-admin precondition

-- 1. Make role nullable so a freshly-webhooked row can exist with role IS NULL (awaiting placement)
alter table users alter column role drop not null;

-- 2. assign_user_placement(target uuid, new_role user_role, new_supervisor uuid) returns void
--    SECURITY DEFINER. Mutates ONLY role and supervisor_id. Admin-gated. Cycle-rejecting.
--    Logs user_placement_assigned (first placement) or user_reparented (supervisor change on placed user).
create or replace function assign_user_placement(
  target uuid,
  new_role user_role,
  new_supervisor uuid
) returns void
language plpgsql
security definer
as $$
declare
  caller_id uuid;
  caller_role user_role;
  target_old_role user_role;
  target_old_supervisor uuid;
  is_first_placement boolean;
begin
  -- Identify the caller
  caller_id := current_app_user();

  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select role into caller_role from users where id = caller_id;

  if caller_role is null or caller_role <> 'admin' then
    raise exception 'Only admins can assign user placement';
  end if;

  -- Load target's current state
  select role, supervisor_id
    into target_old_role, target_old_supervisor
    from users
    where id = target;

  if not found then
    raise exception 'Target user not found';
  end if;

  -- Cycle check: reject if target is in the subtree of new_supervisor
  -- (i.e., new_supervisor is target or a descendant of target)
  if new_supervisor is not null then
    if new_supervisor = target then
      raise exception 'Cannot assign a user as their own supervisor';
    end if;

    if is_in_subtree(target, new_supervisor) then
      raise exception 'Cycle detected: target is an ancestor of the proposed supervisor';
    end if;
  end if;

  is_first_placement := target_old_role is null;

  -- Mutate ONLY role and supervisor_id
  update users
    set role = new_role,
        supervisor_id = new_supervisor
    where id = target;

  -- Log to usage_events
  insert into usage_events (user_id, event_type, metadata)
  values (
    caller_id,
    case when is_first_placement then 'user_placement_assigned' else 'user_reparented' end,
    jsonb_build_object(
      'target', target,
      'new_role', new_role,
      'new_supervisor', new_supervisor,
      'old_role', target_old_role,
      'old_supervisor', target_old_supervisor,
      'is_first_placement', is_first_placement
    )
  );
end;
$$;

-- Grant execute to authenticated (the function's internal check is the real boundary)
grant execute on function assign_user_placement(uuid, user_role, uuid) to authenticated;

-- 3. try_bootstrap_admin(target_user_id uuid, bootstrap_email text) returns text
--    Called from a server action at sign-in time for a user whose row exists but has no role.
--    Precondition: zero admins. Advisory lock. Promotes if the user's email matches bootstrap_email.
--    The user's email is looked up from the users table (not trusted from caller).
--    bootstrap_email is passed by the server action from the BOOTSTRAP_ADMIN_EMAIL env var.
--    Returns outcome: 'fired', 'precondition_false', or 'email_mismatch'.
--    Logs every attempt to usage_events as 'user_bootstrap'.
create or replace function try_bootstrap_admin(
  target_user_id uuid,
  bootstrap_email text
) returns text
language plpgsql
security definer
as $$
declare
  admin_count int;
  user_email text;
  outcome text;
begin
  -- Constant advisory lock key to serialize bootstrap attempts
  perform pg_advisory_xact_lock(742681);

  -- Check precondition: zero admins
  select count(*) into admin_count from users where role = 'admin';

  if admin_count > 0 then
    outcome := 'precondition_false';
    insert into usage_events (user_id, event_type, metadata)
    values (target_user_id, 'user_bootstrap', jsonb_build_object('outcome', outcome));
    return outcome;
  end if;

  -- Look up the user's actual email from the users table (not trusted from caller)
  select email into user_email from users where id = target_user_id;

  if user_email is null then
    raise exception 'Target user not found';
  end if;

  -- Check email match
  if bootstrap_email is null or lower(trim(user_email)) <> lower(trim(bootstrap_email)) then
    outcome := 'email_mismatch';
    insert into usage_events (user_id, event_type, metadata)
    values (target_user_id, 'user_bootstrap', jsonb_build_object('outcome', outcome));
    return outcome;
  end if;

  -- Promote to admin. supervisor_id stays null (admin has none).
  update users set role = 'admin' where id = target_user_id;

  outcome := 'fired';
  insert into usage_events (user_id, event_type, metadata)
  values (target_user_id, 'user_bootstrap', jsonb_build_object('outcome', outcome));

  return outcome;
end;
$$;

grant execute on function try_bootstrap_admin(uuid, text) to authenticated;

-- Grant table privileges to service_role and authenticated
-- (Supabase's new default doesn't auto-expose tables; explicit grants needed)
GRANT ALL ON TABLE users TO service_role;
GRANT SELECT ON TABLE users TO authenticated;
GRANT ALL ON TABLE usage_events TO service_role;
GRANT SELECT ON TABLE usage_events TO authenticated;
