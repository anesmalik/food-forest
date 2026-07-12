-- T1.2: Enqueue + soft-delete-cancel triggers for journal_entries → embedding_queue.
-- Both functions are SECURITY DEFINER so they bypass RLS and table grants.
-- A plain (non-SECURITY DEFINER) trigger function runs as the invoking user
-- (authenticated), which has no INSERT/UPDATE/DELETE on embedding_queue
-- (confirmed in T1.1) — the DML silently affects zero rows, throws no error,
-- and entries are never enqueued.  SECURITY DEFINER fixes this.

-- ---------------------------------------------------------------------------
-- Function 1: Enqueue a journal entry for embedding generation.
-- Fires on INSERT; inserts exactly one pending queue row.
-- ---------------------------------------------------------------------------
create or replace function enqueue_journal_entry_for_embedding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into embedding_queue (content_type, content_id, status)
  values ('journal_entry', NEW.id, 'pending')
  on conflict (content_type, content_id) do nothing;
  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function 2: Cancel embedding for a soft-deleted journal entry.
-- Fires on the NULL → non-NULL transition of soft_deleted_at.
-- Deletes any existing embedding vectors AND sets the queue row to 'cancelled'.
-- Handles both sub-cases:
--   a) entry already embedded  → DELETE hits real rows + queue row cancelled
--   b) entry still pending     → DELETE touches zero rows (no error) + queue row cancelled
-- ---------------------------------------------------------------------------
create or replace function cancel_journal_entry_embedding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Remove any embeddings that were already generated for this entry.
  delete from embeddings
  where content_type = 'journal_entry'
    and content_id = NEW.id;

  -- Cancel the queue row (whether it was pending, processing, done, or failed).
  update embedding_queue
  set status = 'cancelled',
      updated_at = now()
  where content_type = 'journal_entry'
    and content_id = NEW.id;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger 1: AFTER INSERT on journal_entries → enqueue for embedding.
-- ---------------------------------------------------------------------------
create trigger journal_entries_enqueue_embedding
  after insert on journal_entries
  for each row
  execute function enqueue_journal_entry_for_embedding();

-- ---------------------------------------------------------------------------
-- Trigger 2: AFTER UPDATE of soft_deleted_at (NULL → non-NULL only) → cancel.
-- ---------------------------------------------------------------------------
create trigger journal_entries_cancel_embedding
  after update on journal_entries
  for each row
  when (OLD.soft_deleted_at is null and NEW.soft_deleted_at is not null)
  execute function cancel_journal_entry_embedding();
