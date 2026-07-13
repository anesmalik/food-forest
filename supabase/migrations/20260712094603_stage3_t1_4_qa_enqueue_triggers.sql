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

create or replace function enqueue_qa_answer_version_for_embedding()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into embedding_queue (content_type, content_id, status)
  values ('qa_answer_version', NEW.id, 'pending')
  on conflict (content_type, content_id) do nothing;
  return NEW;
end;
$$;

create trigger qa_threads_enqueue_embedding
  after insert on qa_threads
  for each row
  execute function enqueue_qa_question_for_embedding();

create trigger qa_answer_versions_enqueue_embedding
  after insert on qa_answer_versions
  for each row
  execute function enqueue_qa_answer_version_for_embedding();
