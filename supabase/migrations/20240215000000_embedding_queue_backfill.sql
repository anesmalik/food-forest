-- T1.7: Backfill pending embedding_queue entries for all live journal entries.
--
-- For each journal entry that has not been soft-deleted (soft_deleted_at IS NULL),
-- create a pending queue row to be drained by T2.4's cron job.
--
-- Uses on conflict (content_type, content_id) do nothing to match T1.2's idempotency
-- discipline: if this migration is re-run or a row already exists for some reason,
-- it's a no-op rather than an error.

insert into embedding_queue (content_type, content_id, status)
select 'journal_entry', id, 'pending'
from journal_entries
where soft_deleted_at is null
on conflict (content_type, content_id) do nothing;
