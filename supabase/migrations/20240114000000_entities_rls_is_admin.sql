-- Replace entities INSERT/UPDATE policies to use is_admin() instead of inline
-- EXISTS subquery. The inline subquery re-triggers RLS on users (same recursion
-- risk that was fixed for users_select in 20240113000000). is_admin() is a
-- SECURITY DEFINER function that bypasses RLS on users.
--
-- SELECT policy is already correct (org-wide, using (true)) — left untouched.
-- No DELETE policy: deactivation is a soft-delete via UPDATE (sets deactivated_at).

drop policy if exists entities_insert on entities;
drop policy if exists entities_update on entities;

create policy entities_insert on entities
  for insert
  to authenticated
  with check (is_admin());

create policy entities_update on entities
  for update
  to authenticated
  using (is_admin())
  with check (is_admin());
