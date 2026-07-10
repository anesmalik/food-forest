-- CORRECTION: Re-enable RLS on tasks after it was temporarily disabled during development.
-- The RLS policies and grants are correct; the temporary disable was a development workaround
-- that was manually corrected in production. This migration restores RLS to the correct state.
-- See DECISIONS.md for incident notes.
alter table tasks enable row level security;
