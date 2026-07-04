create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text not null unique,
  email text not null,
  display_name text not null,
  role user_role not null,
  supervisor_id uuid references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create index users_clerk_id_idx on users(clerk_id);