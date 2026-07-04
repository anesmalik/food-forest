-- Q&A threads (question is immutable once posted - enforced by trigger later)
create table qa_threads (
  id uuid primary key default gen_random_uuid(),
  asker_id uuid not null references users(id) on delete restrict,
  question text not null,
  status qa_status not null default 'open',
  visibility_scope visibility_scope not null default 'organization',
  created_at timestamptz not null default now()
);

-- Q&A answers (current_version_id nullable, no circular FK)
create table qa_answers (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references qa_threads(id) on delete cascade,
  answerer_id uuid not null references users(id) on delete restrict,
  current_version_id uuid,
  created_at timestamptz not null default now()
);

-- Q&A answer versions
create table qa_answer_versions (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references qa_answers(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- Now safe to add the forward reference
alter table qa_answers
  add constraint qa_answers_current_version_id_fkey
  foreign key (current_version_id)
  references qa_answer_versions(id)
  on delete set null;