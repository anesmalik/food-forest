# Decisions Log

Working record of architectural decisions, alternatives rejected, and reasoning.
Code shows what; this shows why.

---

## Infrastructure

### Hosting: Render instead of Vercel
Vercel blocked registration from Iraq. Render was chosen as the replacement.
No material impact on the architecture. Cron jobs on Render require a separate
paid cron service ($7/month); mitigated by using cron-job.org (free) hitting a
secured API route instead.

### Account ownership: builder-created, not client-owned from day one
Plan (§11.1) calls for client-owned accounts from day one. Deviation: accounts
created under a dedicated project email controlled by the builder because the
client was not in a position to create them at project start.

Mitigation: dedicated project email (not builder's personal email) so credentials
can be handed off. Transfer risk by service:
- Render: low risk, clean transfer flow
- Supabase: org transfer exists, more involved than Render
- Clerk: highest risk, no clean self-serve ownership transfer. Created as a Clerk
  Organization so the handover path is "invite client as org admin, remove
  builder." Staying off production/custom domain until client relationship on
  Clerk is resolved.

Revisit: at client handover, or no later than the six-month review.

---

## Auth

### Clerk native third-party integration, not the JWT template
The Clerk Supabase JWT template was deprecated April 1 2025. Many tutorials still
show it. Using the native third-party auth integration instead: Supabase verifies
Clerk tokens against Clerk's JWKS endpoint, no shared secret required.

### Clerk Organization account type
Clerk app created under an Organization (not personal account) to enable the
eventual handover path of adding the client as org admin and removing the builder,
rather than a full instance recreation.

---

## Database

### RLS as the access-control boundary, not application code
Access control lives in Postgres Row-Level Security, not application query filters.
Application-level enforcement fails open: one forgotten filter exposes content
across the hierarchy. RLS fails closed: a careless query returns less than expected,
never more.

Cost: RLS is annoying to debug. The service-role key bypasses it entirely, so
server-side code holding that key runs with the boundary off. Service-role is
reserved for webhook handlers and cron jobs only, never request handlers.

Rejected: application-level enforcement via supabase-js filters.

### Hierarchy via recursive function, not closure table
User tree represented by supervisor_id self-FK alone. is_in_subtree() is a
recursive CTE wrapped in a SECURITY DEFINER function. At low-dozens scale with
a shallow tree the recursive walk is unmeasurable. Swappable later if the org
grows two orders of magnitude; nothing above the function changes.

Rejected: closure table (ancestor_id, descendant_id, depth). Solves a performance
problem that doesn't exist, at the cost of a denormalized structure that must be
rewritten correctly on every reparenting.

### current_app_user() as the single Clerk-ID to UUID translation point
sub (Clerk ID string) to users.id (UUID) bridge lives in exactly one function.
Every policy calls current_app_user(), never touches sub directly. SECURITY
DEFINER so it can read users regardless of RLS on users itself.

### Webhook as sole writer of users rows
Clerk user.created / user.updated webhook writes the users row. No JIT upsert
in middleware. Single source of truth for the insert; no race between middleware
and webhook creating the same row.

Webhook requirements: idempotent upsert on clerk_id, Svix signature verified
against raw request body (req.text()) before any JSON parsing. Parsing then
reserializing changes the bytes and breaks verification on legitimate payloads.
Works in testing (verification often skipped), fails silently in production.

Accepted tradeoff: sync window where a user is authenticated by Clerk before the
webhook lands their row. Mitigated by auth guard showing "account being set up"
screen instead of an empty or broken dashboard.

### Service-role discipline
Service-role key reserved for no-user server contexts: webhook handlers, cron
jobs. Never reached for in request handlers because RLS was being annoying.
Named explicitly here so future-you doesn't rationalize it at 1am.

### Content access model
Three content types have different sharing intents:

- Wiki: org-wide read (except restricted versions, author + ancestor chain only).
  Broad read is the design working: synthesis exists to make private journal
  scratch into something others can stand on.
- Journal: author + ancestor chain only. Peers reach journal content only through
  AI retrieval, never directly. Candor depends on this.
- Q&A: keyed off visibility_scope set at ask time.

Wiki is read-only to non-owners. No suggest/propose-edit workflow in v1.

### Tier-and-above means ancestor chain, not role rank
Restricted content visibility means position in the tree scoped up the author's
actual ancestry, not literal role rank. Two consultants who don't supervise each
other do not see each other's restricted content. "Tier-and-above" reads like
role rank and isn't; the divergence appears the moment there are two peers at
the same role.

### Write-once soft-delete on journal entries
soft_deleted_at is the only mutable column on journal_entries. Write-once:
NULL to timestamp allowed, timestamp to NULL or different timestamp rejected.
An immutable journal where deletes can be silently undone isn't fully immutable.
Wrongly-deleted entries handled by the append-correction pattern, not an undo
button. Genuine resurrection via trigger-disable (break-glass, audited admin
action).

Rejected: reversible soft-delete. Puts an asterisk on the immutability guarantee.

### Immutability via fail-closed allow-list trigger
Single generic BEFORE UPDATE trigger function, attached per table with allow-list
passed as trigger arguments. Strips allowed keys from OLD and NEW cast to jsonb,
compares remainders. If remainders differ, raises.

Allow-list not forbidden-list: a forbidden-list degrades silently when a new
column is added. Allow-list fails closed: new column is forbidden by default.

Attachments:
- journal_entries: allow soft_deleted_at, plus write-once guard
- qa_threads: allow status
- raw_files: allow nothing

Trigger-disable is break-glass. Never something app code can do.

### Migrations: squash until first client apply, then append-only forever
Squash freely during stage zero. Freeze the baseline at the first apply to the
client-owned environment. Append-only forever after that commit.

Freeze point: stage zero completion, July 2026. Record commit hash when tagged.

### entity_type as lookup table, not enum
entity_types is a lookup table with a stable text key (slug), not a Postgres
enum. If types turn out fixed, the join costs nothing at this scale. If they
grow and you picked enum, it's an enum-to-table migration on populated data.
Content/system enums (sensitivity, qa_status, etc.) stay as enums: those value
sets are genuinely fixed.

---

## AI / Embeddings

### Embedding model: Cohere embed-v4.0 at 1024 dimensions
Content confirmed mixed Arabic and English. Cross-team query requires cross-lingual
retrieval: a manager queries in English, a foreman journaled in Arabic. Cohere v4
maps all languages to one unified embedding space. OpenAI text-embedding-3-small
drops sharply on multilingual retrieval.

Vector column is vector(1024). Dimension is the hard lock: a different-width model
later is a rebuild on a populated table. Model swap at the same width is a
re-embed script.

Cost: adds Cohere as a second AI vendor alongside OpenAI. Two keys, two billings,
two rate-limit regimes. Justified because retrieval quality on bilingual content
is the difference between the feature working and not.

Honest caveat: aggregate multilingual benchmarks hide Arabic dialect/script
wrinkles. Instrument retrieval quality via the AI call log; revisit if Arabic
recall looks bad in the pilot.

### Background jobs run service-role from Render cron, not Edge Functions
Supabase Edge Functions have had trouble validating Clerk RS256 tokens under the
third-party integration. Background jobs run service-role from cron-job.org
hitting API routes, not Edge Functions, partly to sidestep this.

---

## Export

### Export cron: cron-job.org hitting a secured API route
Render free tier does not support cron services. Render paid cron is $7/month.
Using cron-job.org (free) hitting /api/cron/export with a bearer token instead.
Route secured by CRON_SECRET env var checked on every request.

Export format: JSON snapshot of all public tables uploaded to a private Supabase
storage bucket named exports. Not a true pg_dump (would require direct Postgres
shell access). Sufficient for data visibility and basic recovery; a true SQL dump
is a future upgrade if needed.

Schedule: monthly on the 1st.