-- Narrowly-scoped SECURITY DEFINER function for the task assignee picker.
-- Returns only id, display_name, and role for placed users (role IS NOT NULL)
-- who are in the caller's subtree (direct or indirect reports), excluding the
-- caller themselves. This bypasses the users_select RLS policy without exposing
-- the full user record (no email, clerk_id, supervisor_id, etc).
--
-- Same SECURITY DEFINER pattern as current_app_user(), is_admin(), is_in_subtree().

create or replace function get_assignable_users()
returns table (
  id uuid,
  display_name text,
  role user_role
)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.display_name, u.role
  from users u
  where u.role is not null
    and u.id <> current_app_user()
    and is_in_subtree(current_app_user(), u.id)
  order by u.display_name asc;
$$;

grant execute on function get_assignable_users() to authenticated;
