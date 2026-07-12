-- embedding_queue: one row per piece of content pending or processed for embedding generation.
-- Only service_role and SECURITY DEFINER functions touch this table; users never see the queue.

create table embedding_queue (
  id uuid primary key default gen_random_uuid(),
  content_type content_type not null,
  content_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'cancelled')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One queue row per piece of content, ever.
  constraint embedding_queue_content_unique unique (content_type, content_id)
);

-- Partial index: the embedding cron's claim query scans this.
create index embedding_queue_pending_idx on embedding_queue (created_at)
  where status = 'pending';

-- RLS: fail-closed by omission. No policy grants authenticated anything.
-- Service-role bypasses RLS entirely; SECURITY DEFINER functions from T1.2 are the only writers.
alter table embedding_queue enable row level security;

-- Grants: service_role owns the table; authenticated gets SELECT only so that
-- RLS returns empty (not a permission error) — the test bar requires this exact behaviour.
grant all on table embedding_queue to service_role;
grant select on table embedding_queue to authenticated;
