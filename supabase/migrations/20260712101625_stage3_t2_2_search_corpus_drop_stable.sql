drop function search_corpus(vector, integer);

create function search_corpus(query_embedding vector(1024), match_limit int)
returns table (
  content_type content_type,
  content_id uuid,
  chunk_index int,
  chunk_text text,
  similarity float8,
  question_similarity float8,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  set local hnsw.ef_search = 40;

  return query
  select
    e.content_type,
    e.content_id,
    e.chunk_index,
    e.chunk_text,
    1 - (e.embedding <=> query_embedding) as similarity,
    qsim.question_similarity,
    e.created_at
  from embeddings e
  left join lateral (
    select 1 - min(qe.embedding <=> query_embedding) as question_similarity
    from qa_answer_versions qav
    join qa_answers qa on qa.id = qav.answer_id
    join qa_threads qt on qt.id = qa.thread_id
    join embeddings qe
      on qe.content_type = 'qa_question'
      and qe.content_id = qt.id
      and qe.embedding is not null
    where e.content_type = 'qa_answer_version'
      and qav.id = e.content_id
  ) qsim on true
  where e.embedding is not null
    and can_see_content(e.content_type, e.content_id)
    and (
      e.content_type <> 'journal_entry'
      or exists (
        select 1 from journal_entries je
        where je.id = e.content_id and je.soft_deleted_at is null
      )
    )
  order by e.embedding <=> query_embedding
  limit match_limit;
end;
$$;

grant execute on function search_corpus(vector, int) to authenticated;
