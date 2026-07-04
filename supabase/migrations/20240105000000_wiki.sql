-- Wiki entries (current_version_id nullable, no circular FK)
create table wiki_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete restrict,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  soft_deleted_at timestamptz
);

-- Wiki entry versions
create table wiki_entry_versions (
  id uuid primary key default gen_random_uuid(),
  wiki_entry_id uuid not null references wiki_entries(id) on delete cascade,
  title text not null,
  body text not null,
  entity_id uuid references entities(id) on delete restrict,
  sensitivity sensitivity not null default 'normal',
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id) on delete restrict
);

-- Now safe to add the forward reference
alter table wiki_entries
  add constraint wiki_entries_current_version_id_fkey
  foreign key (current_version_id)
  references wiki_entry_versions(id)
  on delete set null;