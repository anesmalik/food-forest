create table embeddings (
  id uuid primary key default gen_random_uuid(),
  content_type content_type not null,
  content_id uuid not null,
  chunk_index int not null default 0,
  chunk_text text not null,
  embedding extensions.vector(1024),
  model_name text not null,
  created_at timestamptz not null default now()
);

create index embeddings_content_idx on embeddings(content_type, content_id);