create table raw_files (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  content_hash text not null unique,
  filename text not null,
  mime_type text not null,
  uploader_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table raw_file_entities (
  raw_file_id uuid not null references raw_files(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  primary key (raw_file_id, entity_id)
);