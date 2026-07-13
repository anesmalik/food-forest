-- No-op re-statement of the same function from the prior migration — this
-- version number is recorded in remote's migration history and must exist
-- as a file for the histories to match. Content is identical to file 3's
-- enqueue_qa_question_for_embedding definition.
create or replace function enqueue_qa_question_for_embedding()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into embedding_queue (content_type, content_id, status)
  values ('qa_question', NEW.id, 'pending')
  on conflict (content_type, content_id) do nothing;
  return NEW;
end;
$$;
