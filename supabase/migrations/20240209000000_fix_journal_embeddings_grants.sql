-- T1.1b: Fix missing grants on journal_entries (authenticated) and embeddings (service_role).
-- Both gaps were discovered during T1.2 testing: authenticated could not insert into
-- journal_entries despite having RLS policies for SELECT/INSERT/UPDATE, and service_role
-- could not insert into embeddings despite being the role used by T2.4's embedding cron.
--
-- Pattern matches 20240128000000_tasks_grants_authenticated.sql (which fixed the same
-- category of gap for the tasks table).  This is the outer gate — RLS is the inner
-- filter; grants alone do not bypass policy checks.

-- journal_entries: authenticated needs SELECT, INSERT, UPDATE matching the three RLS
-- policies that exist (author+ancestor SELECT, author-only INSERT, author-only UPDATE).
-- DELETE is included to match the tasks pattern; RLS has no DELETE policy so it will
-- be denied at the policy layer regardless.
grant select, insert, update, delete on journal_entries to authenticated;

-- embeddings: service_role is the writer (T2.4 embedding cron).  This table has no
-- authenticated access by design (§1.12); only service_role gets write access.
grant all on table embeddings to service_role;