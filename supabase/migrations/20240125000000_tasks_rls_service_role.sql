-- Grant permissions to service_role to access tasks table
grant select, insert, update, delete on tasks to service_role;

-- Allow service_role to bypass RLS on tasks (for testing and admin operations)
create policy "tasks_select_service_role" on tasks
  for select
  to service_role
  using (true);

create policy "tasks_insert_service_role" on tasks
  for insert
  to service_role
  with check (true);

create policy "tasks_update_service_role" on tasks
  for update
  to service_role
  using (true);

create policy "tasks_delete_service_role" on tasks
  for delete
  to service_role
  using (true);
