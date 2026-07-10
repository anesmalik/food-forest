drop trigger if exists journal_entries_immutability on journal_entries;

create trigger journal_entries_immutability
before update on journal_entries
for each row
execute function enforce_immutability('{soft_deleted_at,body_normalized}');