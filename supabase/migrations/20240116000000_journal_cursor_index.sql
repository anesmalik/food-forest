-- Cursor pagination index for journal_entries
-- Per Stage-One §1.12: cursor keyed on (created_at, id) descending.
-- Index on (author_id, created_at desc, id desc) supports the common query
-- "entries by a specific author, newest first, paginated by cursor" efficiently.

create index journal_entries_author_cursor_idx
  on journal_entries (author_id, created_at desc, id desc);
