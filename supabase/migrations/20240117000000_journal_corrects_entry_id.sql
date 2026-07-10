-- Append-correction flow: add corrects_entry_id to journal_entries
-- Per Stage-One §1.11: correcting a mistaken entry is a NEW entry that
-- references the original. No edit feature exists. This column is a nullable
-- FK so the UI can show "Corrects entry from [date]" without parsing body text.
-- Nullable because most entries don't correct anything.

alter table journal_entries
  add column corrects_entry_id uuid
  references journal_entries(id) on delete set null;

-- Index for looking up corrections of a given entry
create index journal_entries_corrects_idx
  on journal_entries (corrects_entry_id)
  where corrects_entry_id is not null;
