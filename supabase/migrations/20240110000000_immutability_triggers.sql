create or replace function enforce_immutability()
returns trigger
language plpgsql
as $$
declare
  allowed_keys text[] := tg_argv[0]::text[];
  old_filtered jsonb;
  new_filtered jsonb;
  key text;
begin
  -- write-once guard for journal_entries.soft_deleted_at
  if tg_table_name = 'journal_entries' then
    if OLD.soft_deleted_at is not null then
      raise exception 'journal_entries: soft_deleted_at is write-once, cannot modify after set';
    end if;
  end if;

  -- strip allowed keys from both old and new, compare remainders
  old_filtered := to_jsonb(OLD);
  new_filtered := to_jsonb(NEW);

  foreach key in array allowed_keys loop
    old_filtered := old_filtered - key;
    new_filtered := new_filtered - key;
  end loop;

  if old_filtered != new_filtered then
    raise exception '% is append-only, updates are prohibited', tg_table_name;
  end if;

  return NEW;
end;
$$;

-- journal_entries: only soft_deleted_at is mutable
create trigger journal_entries_immutability
  before update on journal_entries
  for each row execute function enforce_immutability('{soft_deleted_at}');

-- qa_threads: only status is mutable
create trigger qa_threads_immutability
  before update on qa_threads
  for each row execute function enforce_immutability('{status}');

-- raw_files: nothing is mutable
create trigger raw_files_immutability
  before update on raw_files
  for each row execute function enforce_immutability('{}');