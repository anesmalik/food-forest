-- Entity types lookup table
create table entity_types (
  key text primary key,
  label text not null
);

insert into entity_types (key, label) values
  ('site', 'Site'),
  ('crop', 'Crop'),
  ('supplier', 'Supplier'),
  ('equipment', 'Equipment'),
  ('project', 'Project'),
  ('other', 'Other');

-- Entities
create table entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null references entity_types(key) on delete restrict,
  metadata jsonb not null default '{}',
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

-- Tasks
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  assigner_id uuid not null references users(id) on delete restrict,
  assignee_id uuid not null references users(id) on delete restrict,
  due_date date,
  state task_state not null default 'assigned',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Journal entries
create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id) on delete restrict,
  task_id uuid references tasks(id) on delete restrict,
  body text not null,
  sensitivity sensitivity not null default 'normal',
  created_at timestamptz not null default now(),
  soft_deleted_at timestamptz
);

-- Junction: journal entries <-> entities
create table journal_entry_entities (
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  primary key (journal_entry_id, entity_id)
);