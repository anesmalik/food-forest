-- Restrict task assignment to subtree: an assigner can only assign tasks to
-- users in their own subtree (direct or indirect reports). This is enforced
-- at the RLS level, not just in the UI.
--
-- The original tasks_insert policy only checked assigner_id = current_app_user().
-- We add the subtree constraint: assignee_id must be in the caller's subtree.

drop policy if exists "tasks_insert" on tasks;

create policy "tasks_insert" on tasks for insert to authenticated
  with check (
    assigner_id = current_app_user()
    and is_in_subtree(current_app_user(), assignee_id)
  );
