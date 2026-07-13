create table qa_citations (
  id uuid primary key default gen_random_uuid(),
  answer_version_id uuid not null references qa_answer_versions(id),
  content_type content_type not null,
  content_id uuid not null,
  created_at timestamptz not null default now()
);

alter table qa_citations enable row level security;

create policy qa_citations_select
  on qa_citations
  for select
  to authenticated
  using (true);
