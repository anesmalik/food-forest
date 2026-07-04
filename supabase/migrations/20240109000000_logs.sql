create table ai_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  function ai_function not null,
  query text not null,
  retrieved_ids jsonb not null default '[]',
  prompt text not null,
  response text not null,
  citations_valid boolean,
  model_name text not null,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create table usage_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);