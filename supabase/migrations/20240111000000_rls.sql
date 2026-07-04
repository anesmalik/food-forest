-- Enable RLS on all tables
alter table users enable row level security;
alter table entities enable row level security;
alter table entity_types enable row level security;
alter table tasks enable row level security;
alter table journal_entries enable row level security;
alter table journal_entry_entities enable row level security;
alter table wiki_entries enable row level security;
alter table wiki_entry_versions enable row level security;
alter table qa_threads enable row level security;
alter table qa_answers enable row level security;
alter table qa_answer_versions enable row level security;
alter table raw_files enable row level security;
alter table raw_file_entities enable row level security;
alter table embeddings enable row level security;
alter table ai_call_log enable row level security;
alter table usage_events enable row level security;

-- USERS: read own row; admin reads all
create policy "users_select" on users for select to authenticated
  using (
    id = current_app_user()
    or exists (
      select 1 from users u where u.id = current_app_user() and u.role = 'admin'
    )
    or is_in_subtree(current_app_user(), id)
  );

create policy "users_insert" on users for insert to authenticated
  with check (false); -- webhook only via service role

create policy "users_update" on users for update to authenticated
  with check (false); -- webhook only via service role

-- ENTITY TYPES: readable by all authenticated
create policy "entity_types_select" on entity_types for select to authenticated
  using (true);

-- ENTITIES: readable by all authenticated; insert/update by admin only
create policy "entities_select" on entities for select to authenticated
  using (true);

create policy "entities_insert" on entities for insert to authenticated
  with check (
    exists (select 1 from users u where u.id = current_app_user() and u.role = 'admin')
  );

create policy "entities_update" on entities for update to authenticated
  using (
    exists (select 1 from users u where u.id = current_app_user() and u.role = 'admin')
  );

-- TASKS: assignee and assigner and ancestors can read
create policy "tasks_select" on tasks for select to authenticated
  using (
    assignee_id = current_app_user()
    or assigner_id = current_app_user()
    or is_in_subtree(current_app_user(), assignee_id)
  );

create policy "tasks_insert" on tasks for insert to authenticated
  with check (assigner_id = current_app_user());

create policy "tasks_update" on tasks for update to authenticated
  using (assigner_id = current_app_user());

-- JOURNAL ENTRIES: author + ancestor chain
create policy "journal_entries_select" on journal_entries for select to authenticated
  using (
    author_id = current_app_user()
    or is_in_subtree(current_app_user(), author_id)
  );

create policy "journal_entries_insert" on journal_entries for insert to authenticated
  with check (author_id = current_app_user());

create policy "journal_entries_update" on journal_entries for update to authenticated
  using (author_id = current_app_user()); -- trigger enforces immutability

-- JOURNAL ENTRY ENTITIES: follows journal entry access
create policy "journal_entry_entities_select" on journal_entry_entities for select to authenticated
  using (
    exists (
      select 1 from journal_entries je
      where je.id = journal_entry_id
      and (je.author_id = current_app_user() or is_in_subtree(current_app_user(), je.author_id))
    )
  );

create policy "journal_entry_entities_insert" on journal_entry_entities for insert to authenticated
  with check (
    exists (
      select 1 from journal_entries je
      where je.id = journal_entry_id
      and je.author_id = current_app_user()
    )
  );

-- WIKI ENTRIES: org-wide read except restricted versions (author + ancestors only)
create policy "wiki_entries_select" on wiki_entries for select to authenticated
  using (soft_deleted_at is null);

create policy "wiki_entries_insert" on wiki_entries for insert to authenticated
  with check (owner_id = current_app_user());

create policy "wiki_entries_update" on wiki_entries for update to authenticated
  using (owner_id = current_app_user());

-- WIKI ENTRY VERSIONS: restricted versions visible to author + ancestors only
create policy "wiki_entry_versions_select" on wiki_entry_versions for select to authenticated
  using (
    sensitivity = 'normal'
    or created_by = current_app_user()
    or is_in_subtree(current_app_user(), created_by)
  );

create policy "wiki_entry_versions_insert" on wiki_entry_versions for insert to authenticated
  with check (created_by = current_app_user());

-- QA THREADS
create policy "qa_threads_select" on qa_threads for select to authenticated
  using (
    visibility_scope = 'organization'
    or asker_id = current_app_user()
    or (
      visibility_scope = 'subtree'
      and is_in_subtree(current_app_user(), asker_id)
    )
  );

create policy "qa_threads_insert" on qa_threads for insert to authenticated
  with check (asker_id = current_app_user());

create policy "qa_threads_update" on qa_threads for update to authenticated
  using (asker_id = current_app_user()); -- trigger enforces status-only mutation

-- QA ANSWERS
create policy "qa_answers_select" on qa_answers for select to authenticated
  using (
    exists (
      select 1 from qa_threads qt
      where qt.id = thread_id
      and (
        qt.visibility_scope = 'organization'
        or qt.asker_id = current_app_user()
        or (qt.visibility_scope = 'subtree' and is_in_subtree(current_app_user(), qt.asker_id))
      )
    )
  );

create policy "qa_answers_insert" on qa_answers for insert to authenticated
  with check (answerer_id = current_app_user());

create policy "qa_answers_update" on qa_answers for update to authenticated
  using (answerer_id = current_app_user());

-- QA ANSWER VERSIONS: follows qa_answers access
create policy "qa_answer_versions_select" on qa_answer_versions for select to authenticated
  using (
    exists (
      select 1 from qa_answers qa
      join qa_threads qt on qt.id = qa.thread_id
      where qa.id = answer_id
      and (
        qt.visibility_scope = 'organization'
        or qt.asker_id = current_app_user()
        or (qt.visibility_scope = 'subtree' and is_in_subtree(current_app_user(), qt.asker_id))
      )
    )
  );

create policy "qa_answer_versions_insert" on qa_answer_versions for insert to authenticated
  with check (
    exists (
      select 1 from qa_answers qa where qa.id = answer_id and qa.answerer_id = current_app_user()
    )
  );

-- RAW FILES: uploader + ancestors
create policy "raw_files_select" on raw_files for select to authenticated
  using (
    uploader_id = current_app_user()
    or is_in_subtree(current_app_user(), uploader_id)
  );

create policy "raw_files_insert" on raw_files for insert to authenticated
  with check (uploader_id = current_app_user());

-- RAW FILE ENTITIES: follows raw_files access
create policy "raw_file_entities_select" on raw_file_entities for select to authenticated
  using (
    exists (
      select 1 from raw_files rf
      where rf.id = raw_file_id
      and (rf.uploader_id = current_app_user() or is_in_subtree(current_app_user(), rf.uploader_id))
    )
  );

-- EMBEDDINGS: follows source content access (permissive - actual scoping in app query)
create policy "embeddings_select" on embeddings for select to authenticated
  using (true);

-- AI CALL LOG: own rows only
create policy "ai_call_log_select" on ai_call_log for select to authenticated
  using (user_id = current_app_user());

-- USAGE EVENTS: own rows only
create policy "usage_events_select" on usage_events for select to authenticated
  using (user_id = current_app_user());