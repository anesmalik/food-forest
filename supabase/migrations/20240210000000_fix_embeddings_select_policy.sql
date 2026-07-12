-- T1.1c: Drop the embeddings SELECT policy that shipped from stage zero with
-- using (true) — unconditionally true for any authenticated user on any row.
-- This was inert only because embeddings had no authenticated table grant
-- (found in T1.1b's audit).  A policy that reads "everyone can see everything"
-- is wrong on its own terms; the next grants ticket touching this table
-- would silently activate it.  Per spec §1.12, stage two ships with zero
-- authenticated SELECT access to embeddings.  The correct state matches
-- embedding_queue (T1.1): RLS enabled, no policies for authenticated.

drop policy if exists embeddings_select on embeddings;