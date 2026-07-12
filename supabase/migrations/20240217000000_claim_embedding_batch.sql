-- claim_embedding_batch: atomically claim a batch of pending embedding queue rows,
-- plus any stale 'processing' rows (from crashed cron runs).
--
-- Runs with service_role privileges (SECURITY DEFINER) so it can use FOR UPDATE SKIP LOCKED,
-- which prevents concurrent cron runs from double-processing the same rows.
--
-- Stale row recovery: if a row is in 'processing' for longer than 5 minutes,
-- it's assumed the previous cron run crashed or timed out. Such rows are reclaimed
-- and reprocessed on the next run. This prevents permanent orphaning when serverless
-- functions crash or embedding API calls timeout mid-flight.
--
-- Returns: the claimed rows (pending + stale processing), already marked as 'processing'
-- (or already in 'processing' if they were stale), in a single atomic transaction.
-- The caller must process these rows and update status to 'done' or 'failed' via separate logic.
--
-- If no rows are pending or stale, returns an empty result set (not an error).

create or replace function claim_embedding_batch(batch_size int default 32)
returns table (
  id uuid,
  content_type text,
  content_id uuid,
  status text,
  attempts int,
  last_error text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_ids uuid[];
begin
  -- Claim the batch: select pending rows AND stale 'processing' rows (older than 5 minutes),
  -- lock them to prevent concurrent runs from claiming the same rows, and mark any
  -- 'pending' rows as 'processing' in a single atomic transaction.
  -- Fully qualify all column references to avoid shadowing by the RETURNS TABLE OUT parameters.
  with claimed as (
    select eq.id from embedding_queue eq
    where (eq.status = 'pending')
       or (eq.status = 'processing' and eq.updated_at < now() - interval '5 minutes')
    order by eq.created_at asc
    for update skip locked
    limit batch_size
  ),
  updated as (
    update embedding_queue eq2
    set status = 'processing', updated_at = now()
    where eq2.id in (select c.id from claimed c)
    returning eq2.id
  )
  select array_agg(u.id) into claimed_ids from updated u;

  -- Return the full rows (now marked 'processing') to the caller.
  return query
  select eq3.id, eq3.content_type::text, eq3.content_id, eq3.status, eq3.attempts, eq3.last_error, eq3.created_at
  from embedding_queue eq3
  where eq3.id = any(claimed_ids)
  order by eq3.created_at asc;
end;
$$;

grant execute on function claim_embedding_batch(int) to service_role;
