-- Fix infinite recursion in users_select RLS policy.
-- The inline EXISTS subquery re-triggers RLS on users, recursing.
-- Wrap the admin check in a SECURITY DEFINER function, same pattern as current_app_user().

create or replace function is_admin() returns boolean
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from users
    where id = current_app_user() and role = 'admin'
  );
$$ language sql;

drop policy if exists users_select on users;

create policy users_select on users
  for select
  to authenticated
  using (
    id = current_app_user()
    or is_admin()
    or is_in_subtree(current_app_user(), id)
  );