-- Fix tasks RLS update policy: allow both assigner and assignee to update
-- (trigger handles what can actually be changed based on actor and state)
drop policy if exists "tasks_update" on tasks;

create policy "tasks_update" on tasks
  for update
  to authenticated
  using (
    assigner_id = current_app_user()
    or assignee_id = current_app_user()
  );
