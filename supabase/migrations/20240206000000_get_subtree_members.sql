-- Get all members of the current user's subtree (direct and indirect reports)
-- Returns id, display_name, role, supervisor_id ordered by display_name
-- SECURITY DEFINER to bypass RLS when building the subtree list
-- This function is stable/immutable and queries users directly (bypassing RLS internally)

create or replace function get_subtree_members()
returns table (
  id uuid,
  display_name text,
  role user_role,
  supervisor_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  with recursive subtree as (
    -- Base case: direct reports of the current user
    select id, display_name, role, supervisor_id
    from users
    where supervisor_id = current_app_user()

    union all

    -- Recursive case: reports of reports
    select u.id, u.display_name, u.role, u.supervisor_id
    from users u
    join subtree s on u.supervisor_id = s.id
  )
  select * from subtree order by display_name;
$$;

grant execute on function get_subtree_members() to authenticated;
