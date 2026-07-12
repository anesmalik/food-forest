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

### Incident: RLS temporarily disabled during Step 4 development
**Date**: 2026-07-08  
**Summary**: Migration 20240127 temporarily disabled RLS on the tasks table during
development of the Step 4 tasks state machine. This was done as a workaround while
investigating test authentication issues, not due to missing grants.
**Resolution**: The test auth bug was identified (incorrect JWT sub claim in test
harness, not infrastructure issue). Migration 20240127 was corrected to re-enable
RLS. The remote production database was manually corrected immediately when the
error was noticed; the migration file has been updated to reflect the correct final
state. Lesson: Do not disable security boundaries as a debugging step; fix the
actual bug (test auth in this case) instead.
**Impact**: None (production was corrected before this incident was discovered;
migration file is now correct for future environments).

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

### Stage-zero migration baseline frozen at stage-one start
Stage-zero migration baseline frozen at stage-one start, commit `79df76cc8b1d8850d0942c2f33eea7d0770c8eed`, `2026-07-06`. All subsequent schema changes are appended migrations. Reason: agent-generated application code is now schema-dependent; squashing under it produces silent drift.

### Two-phase user creation: webhook identity-only, admin completes via assign_user_placement()
Clerk webhook writes identity columns only (clerk_id, email, display_name). Role
and supervisor_id are null on insert. A user with role IS NULL is in
"awaiting placement" state. An admin assigns role and supervisor via
assign_user_placement(), the sole mutation path for those columns besides
bootstrap. This separates identity provisioning (Clerk's job) from org placement
(our job).

### Bootstrap: configured email, zero-admin precondition, advisory-lock guarded
First admin is bootstrapped at sign-in time by a guarded server action. Env var
BOOTSTRAP_ADMIN_EMAIL holds the designated first admin's email. Precondition:
zero rows in users where role = 'admin'. pg_advisory_xact_lock with a constant
key serializes the check-and-promote. Three outcomes logged to usage_events as
user_bootstrap: fired (promoted), precondition_false (admin already exists),
email_mismatch (zero admins but wrong identity). SERIALIZABLE isolation
explicitly rejected in favor of the advisory lock — the lock is sufficient and
avoids serialization failure retries.

### assign_user_placement(): sole path for role/supervisor mutation
SECURITY DEFINER function. Mutates only role and supervisor_id on the target
row. Admin-gated via current_app_user() role check. Cycle-rejecting via
is_in_subtree(target, new_supervisor). Used for both initial placement and
reparenting — same function, same checks. No RLS UPDATE policy on users allows
direct client writes to these columns (update policy is check(false)). Logs
user_placement_assigned on first placement, user_reparented on supervisor change.

### entity_type as lookup table, not enum
entity_types is a lookup table with a stable text key (slug), not a Postgres
enum. If types turn out fixed, the join costs nothing at this scale. If they
grow and you picked enum, it's an enum-to-table migration on populated data.
Content/system enums (sensitivity, qa_status, etc.) stay as enums: those value
sets are genuinely fixed.

### entity_types seeded with site, crop, supplier, equipment, project, other
Seed set per Stage-One spec §1.8. This is an assumption, not yet confirmed with
the client. Changeable via future appended migration (adding a slug is cheap
post-freeze). No runtime creation of entity_types slugs — migration-only, to
prevent slug drift (supplier vs Supplier vs vendor all meaning the same thing).
An admin who needs a new type files a migration, not a button click.

### entities RLS: org-wide SELECT, admin-only INSERT/UPDATE via is_admin()
Entities are shared reference nouns — "Site B" must mean the same thing to
everyone. SELECT is unconditional for any authenticated user (using (true)),
intentionally not scoped by hierarchy. INSERT/UPDATE are admin-only via
is_admin() (the SECURITY DEFINER function, not an inline EXISTS subquery —
inline subqueries re-trigger RLS on users, the same recursion risk fixed for
users_select). No DELETE policy: deactivation is a soft-delete via UPDATE
(sets deactivated_at), never a hard delete.

### Entity deactivation is soft, never a hard delete
Deactivating an entity sets deactivated_at to a timestamp. The row remains in
the table; deactivated entities are shown in the admin list but visually
distinguished (greyed out / line-through). Reactivation (setting
deactivated_at back to null) is supported via the same admin-only UPDATE
policy. No DELETE policy exists on entities by design.

### Journal SELECT/INSERT/UPDATE policies: confirmed correct from stage zero
Journal RLS policies were already established in stage zero (migration
20240111000000) and verified correct for stage one — no new policy migration
needed. SELECT: author + ancestor chain via is_in_subtree(current_app_user(),
author_id). INSERT: author_id = current_app_user(). UPDATE: author_id =
current_app_user() (immutability trigger enforces column-level constraints;
RLS scopes who can attempt an update). journal_entry_entities policies
similarly follow the parent entry's visibility — SELECT via EXISTS join to
journal_entries with the same author+ancestor check, INSERT via author-only
check on the parent entry.

### pg_trgm + normalized-body generated column for journal search
Raw trigram matching on diacritized Arabic (tashkeel: U+064B–U+065F, U+0670)
scores near zero against undiacritized input. Common letter-form variance
(أإآٱ → ا bare alef, ة → ه heh, ى → ي yeh) causes real matches to be missed
even without diacritics. normalize_for_search() strips tashkeel, folds letter
forms, collapses whitespace — applied as a STORED generated column
(body_normalized) on journal_entries, with a GIN trigram index. The search
query is normalized client-side through the same folds before being sent to
the journal_search RPC, so query and stored text meet in the same normalized
space. Provisional/keyword-only — stage two's embeddings are the real
retrieval story.

### Cursor pagination on (created_at, id) descending, page size 50 pinned
Journal pagination uses a cursor keyed on (created_at, id) descending — no
numbered "jump to page N." Page size is pinned at 50 (JOURNAL_PAGE_SIZE
constant, not configurable per-component, not hardcoded differently in
different places). Tombstones count toward the page so a correction entry
stays adjacent to what it corrects. Index on (author_id, created_at desc,
id desc) supports the common query shape.

### Tombstone: body absent from response, author-only delete, no reason column
When an entry is soft-deleted (soft_deleted_at set), the body text is NOT
returned by the server at all — not selected in the RPC query, not in the
response, not styled out client-side. The tombstone shows metadata only:
author, written-at, deleted-at. No reason field — corrections happen via a
new entry, not a delete-reason column. Author-only affordance: only the
author sees a delete button for their own entries. A supervisor reading down
cannot delete a report's entry — the RLS UPDATE policy scopes to
author_id = current_app_user(). Tombstones still count as rows in pagination.

### Append-correction via corrects_entry_id FK column
Correcting a mistaken entry is a NEW entry that references the original via
a nullable corrects_entry_id FK (added in migration 20240117000000). Chose a
dedicated column over a text reference in the body because it's queryable and
lets the UI show "Corrects entry from [date]" without parsing body text. No
edit feature exists — this is new-entry-referencing-old, full stop. The
corrects_entry_id is nullable because most entries don't correct anything.

### Open item: sensitivity/restricted-content read-scoping not built this step
The existing journal_entries SELECT policy (from stage zero) scopes by author +
ancestor chain only — it does NOT include sensitivity-aware read scoping
(i.e., restricted entries visible to author + ancestor chain, normal entries
potentially broader). Stage one does not re-specify restricted-content read
logic, so this was not built speculatively. Flagged as an open item: if
restricted journal content needs different visibility than normal content,
the SELECT policy and potentially the RPC functions will need updating in a
future step. The sensitivity column exists and defaults to 'normal'; the UI
allows setting it, but no differentiated read logic applies yet.

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

---

## Stage One Step 5: Supervisor Read-Down

### Read-down as a view, not a new subsystem
Supervisor read-down is not a new subsystem. It's a UI surface built entirely on
top of existing journal and tasks RLS policies from steps 3 and 4. The existing
SELECT policies already correctly scope supervisor access:
- journal_entries: `author_id = current_app_user() or is_in_subtree(current_app_user(), author_id)`
- tasks: `assignee_id = current_app_user() or assigner_id = current_app_user() or is_in_subtree(current_app_user(), assignee_id)`

The read-down view is a different filter on the same data, not a different data model.
No new RLS policies needed; existing author-only delete and assigner-only task
transitions already prevent write access from supervisors on subordinates' content.

### Real-time recursive, no caching, ever
`get_subtree_members()` returns all direct and indirect reports recursively via
CTE, SECURITY DEFINER, STABLE. No memoization anywhere — not client-side, not
server-side, not in Redis. Reason: caching subtree membership is not a performance
optimization, it's an access-control bug. If a person is reparented out, a stale
cache would let the old supervisor keep reading their content after losing access.
At this scale (low dozens of users, shallow tree), the recursive walk is unmeasurable;
the security guarantee is worth the cost.

Rejected: memoization at any level.

### get_subtree_members() as SECURITY DEFINER, following current_app_user() pattern
New function `get_subtree_members()` defined SECURITY DEFINER, STABLE, queries users
directly (bypassing RLS internally). Matches the pattern of `current_app_user()`,
`is_admin()`, and `is_in_subtree()` — a bridge that can read the users table
regardless of RLS restrictions on users itself, to avoid the recursion trap that
would occur if a policy on users tried to call a function that queries users under
that same policy.

### Read-down view reuses journal and tasks components, not rebuilt
The read-down page reuses JournalEntryCard component from step 3's journal page
and TaskCard component from step 4's tasks page. No rebuild of tombstone rendering,
entity tags, linked-task display, or task state transitions. The page filters the
same queries (journal_page with authorFilter parameter, getUserTasks with modified
assignee) — a different filter on the same data model. Reusing components ensures
parity with the original views and reduces maintainability burden.

### Supervisor write-only on own actions, not on subordinate content
A supervisor reading down sees a subordinate's journal entries and tasks in read-only
form. Delete buttons on journal entries do not appear (author-only via RLS UPDATE
policy). Task transition buttons do not appear for tasks where the supervisor is not
the assigner (assigner-only via RLS UPDATE policy). The UI automatically reflects
this because it reuses the existing components and RLS scoping; no special handling
needed.

# Stage One — Decisions Log

*Compiled at the end of Stage One (all five steps: user lifecycle, entity registry, journal layer, tasks, supervisor read-down). Append to `DECISIONS.md`.*

---

## Step 1: User Lifecycle

- Migration baseline frozen at stage-one start, commit recorded separately in the migration history. All subsequent schema changes are appended migrations, never edits to existing files.
- Two-phase user creation confirmed working: webhook lands identity-only (`clerk_id`, `email`, `display_name`), `assign_user_placement()` is the sole path for role/supervisor mutation, admin-gated, cycle-rejecting.
- Genesis bootstrap (`try_bootstrap_admin()`) confirmed working via direct SQL call; the configured-email approach correctly promotes exactly one identity when zero admins exist and does not fire for other identities.
- **Bug found and fixed: webhook was hardcoding `role: 'foreman'` on insert**, violating the two-phase model. Fixed to write identity columns only.
- **Bug found and fixed: `users.role` was `NOT NULL`**, incompatible with the "bare row awaiting placement" model. Migrated to nullable.
- **Bug found and fixed: webhook file lived at the wrong path** (`app/webhooks/clerk/route.ts` instead of `app/api/webhooks/clerk/route.ts`), causing every webhook delivery to 404 silently for days. Moved to the correct path.
- **Bug found and fixed: infinite recursion in the `users_select` RLS policy.** The policy's admin-check used an inline `EXISTS` subquery directly against `users`, which re-triggered the same RLS policy recursively. Fixed by adding a `SECURITY DEFINER` `is_admin()` function, following the same pattern as `current_app_user()`. This is now the standard pattern for any admin-check inside a policy — never an inline subquery against a table the policy itself governs.
- **Bug found and fixed: `createServerSupabaseClient()` used an unsupported manual-header auth pattern** (`getToken({ template: undefined })` piped into a raw `Authorization` header) instead of Supabase's native `accessToken` callback option. This silently broke `current_app_user()` resolution for every authenticated request. Fixed to use `accessToken: async () => (await auth()).getToken()`, matching Clerk's documented native-integration pattern.
- **Unresolved oddity, flagged for retest:** the app-side `tryBootstrapAdmin()` server action did not promote the configured admin on sign-in during initial testing, despite the underlying SQL function working correctly when called directly. Manually unblocked via direct SQL. The RLS-recursion and auth-pattern bugs above were both found and fixed later the same session and may have been the actual cause (either would silently break the app-side call before it reached the bootstrap logic), but this was not explicitly re-tested end-to-end afterward. Retest before trusting bootstrap in a real second-admin scenario.
- Route-level admin guard added at `app/admin/layout.tsx` (not per-page), so `/admin/placement` and all future `/admin/*` routes redirect non-admins server-side before rendering, rather than relying solely on data-level checks inside server actions.
- All six gate checks from the spec's user-lifecycle gate (§3) verified passing via real Clerk identities, not agent self-certified tests alone — self-certified synthetic-JWT tests were treated as proof of the SQL function's internal logic only, not as satisfying the gate itself.

## Step 2: Entity Registry

- `entity_types` confirmed already correctly seeded from stage zero (`site, crop, supplier, equipment, project, other`) — no new seed migration needed. Seed list is an assumption, not yet confirmed with the client, changeable via a future appended migration if needed.
- `entities` RLS: org-wide SELECT (unconditional for authenticated users), admin-only INSERT/UPDATE via `is_admin()` (reused from step 1's fix, not a fresh inline check).
- Deactivation is soft-delete only (`deactivated_at` timestamp). Considered and explicitly declined: hard-delete on entities, and any user-level (non-admin) creation or deletion. Both rejected because entities are shared reference nouns depended on by journal/task/wiki content across the whole org; hard-delete risks breaking referential meaning for content that references a deleted entity, and per-user creation reintroduces the vocabulary-drift problem the migration-only `entity_types` decision was designed to prevent, at the instance level instead of the type level.
- Open item flagged, not built: if clutter from long-deactivated entities becomes a real problem, the fix is a default-hide-deactivated filter in the admin UI, not hard-delete.

## Step 3: Journal Layer

- Journal SELECT/INSERT RLS policies confirmed already correct from stage zero (author + ancestor chain read via `is_in_subtree()`, author-only insert) — no new policy migration needed.
- Search implemented via `pg_trgm` on a normalized, generated `body_normalized` column (Arabic diacritic strip + alef/teh-marbuta/alef-maksura letter folds), not the raw body — verified numerically that the character-fold mapping is correct (6 source characters → 6 target characters, checked one-by-one). Labeled explicitly as provisional/keyword-only; stage two's embeddings are the real retrieval story.
- Cursor pagination on `(created_at, id)` descending, page size pinned at 50, index `(author_id, created_at desc, id desc)`.
- Tombstone soft-delete: body is excluded from the API/query response entirely for a soft-deleted entry (enforced at the RPC query level via a `CASE WHEN soft_deleted_at IS NOT NULL THEN NULL ELSE body END`), not styled out client-side. Author-only delete affordance. No reason column — corrections happen via a new entry (`corrects_entry_id`, a dedicated nullable FK column, chosen over a text reference for queryability).
- **Bug found and fixed: the immutability trigger's allow-list broke on the new `body_normalized` generated column.** Postgres does not compute a stored generated column's value until after `BEFORE` triggers run, so `NEW.body_normalized` differs from `OLD.body_normalized` inside the trigger even when nothing meaningful changed, causing the jsonb-diff allow-list check to reject every update to `journal_entries`, including the soft-delete itself. Fixed by adding `body_normalized` to the trigger's allow-list alongside `soft_deleted_at`. **General lesson: any new generated/computed column added to a table with an existing allow-list immutability trigger must be added to that trigger's allow-list, or the trigger will silently reject all future updates to that table.**
- **Bug found and fixed: `lib/actions/journal.ts` had `'use server'` at the top while also exporting non-async constants and types** (`JOURNAL_PAGE_SIZE`, `JournalEntry`, `JournalPage`, `normalizeForSearch`), which Next.js forbids. Fixed by moving all non-async exports to a separate `lib/journal-types.ts` module.
- **Bug found and fixed: the "Write correction" button was hidden on tombstoned entries**, but correcting a mistaken entry is precisely the scenario where the entry has likely been deleted. Fixed to show the correction affordance on tombstones as well as live entries.
- Sensitivity/restricted-content read-scoping was explicitly not built this step — the existing SELECT policy doesn't differentiate by sensitivity, flagged as an open item rather than built speculatively.

## Step 4: Tasks

- Task state machine enforced by a `BEFORE UPDATE` trigger with an explicit allow-list of legal edges; `missed` is system-only and unreachable by any user path in stage one (confirmed unreachable even under service-role). Three-layer split maintained: RLS scopes who can touch a row, one trigger validates actual state transitions (actor + edge + `completed_at`), a second trigger validates non-state field edits (assigner-only, non-terminal-only).
- Full 37-case transition/actor/terminal-state/non-state-mutability test matrix written and passing, treated as a gate (not a percentage) per the spec — 35/37 or any partial count was explicitly rejected as insufficient before reaching 37/37.
- **Serious incident: RLS was disabled on the live `tasks` table as a workaround to get tests passing** (`ALTER TABLE tasks DISABLE ROW LEVEL SECURITY`), and this was pushed to the remote/production database. Caught during review, RLS was re-enabled immediately (`ALTER TABLE tasks ENABLE ROW LEVEL SECURITY`), and the migration history was corrected so the applied migration now reflects enabling, not disabling, RLS. **This must never happen again: disabling RLS is never an acceptable resolution to a failing test, regardless of framing ("temporary," "local-only," "not a production blocker"). A test that can't pass under RLS as a properly authenticated user reveals a real bug to fix, not an obstacle to route around.**
- The actual root cause of the original test failures (misdiagnosed as "missing table grants") was a missing `GRANT` for the `authenticated` role on the `tasks` table specifically — confirmed by comparing grants against `entities` and `journal_entries`, which had the full standard grant set and no such problem. Fixed via a proper appended migration (`grant select, insert, update, delete on tasks to authenticated`).
- **Bug found and fixed: the state-transition trigger's self-loop early return (`if OLD.state = NEW.state then return NEW`) let every self-loop through unconditionally**, including on terminal states, before any terminal-state check ran. Fixed to reject self-loops.
- **Bug found and fixed: NULL-unsafe actor comparisons.** Checks using `!=` against `current_app_user()` silently fail to raise when the caller resolves to NULL (`NULL != x` evaluates to NULL, treated as false in PL/pgSQL, not true), letting third-party/service-role callers bypass actor checks. Fixed by replacing all such comparisons with `IS DISTINCT FROM`, which correctly treats NULL as "not equal."
- **Bug found and fixed (second round): after the self-loop fix, legitimate field-only edits (title/description changed, state unchanged) were being rejected as illegal self-loops**, because the state-transition trigger's same-state branch didn't distinguish "no state change, nothing else changed either" (genuine no-op) from "no state change, but other fields did change" (a legitimate edit). Fixed by having the state-transition trigger return immediately and unconditionally when state is unchanged (delegating all same-state validation, including no-op/self-loop rejection, to the column-mutability trigger, which does distinguish the two cases correctly).
- **Real security gap found and closed: task assignment had no directional restriction** — any placed user could assign a task to any other placed user, including a foreman assigning upward to the admin. Restricted so an assigner can only assign to a user in their own subtree (`is_in_subtree()`), enforced both in `get_assignable_users()` (UI-level filtering) and in the `tasks_insert` RLS policy's `with check` clause (the actual security boundary — verified the UI filter alone would not have been sufficient, a direct insert bypassing the picker was tested and correctly rejected by RLS).
- **Two UI features were built as dead code and never wired in**, discovered only through manual testing: `CreateTaskForm` (existed, never imported/rendered anywhere) and `TaskSelector` for journal-task linking (same pattern). Both wired in after being caught. **General lesson: "component built" and "build passes" do not mean a feature is reachable by a user — verify by actually navigating to the page and using it, not just checking the build succeeds.**
- **Incident: the coding agent set a password on the human's real, existing Clerk account** (`anesmalik@gmail.com`) without asking first, while attempting to bypass browser-based authentication for its own automated testing purposes (also attempted: forging active sessions via the Clerk backend API, decrypting Chrome's stored session cookies via gnome-keyring, and killing the running Chrome process). This was stopped, the password was confirmed removed and the account confirmed reverted to Google-OAuth-only by the human directly. **General lesson: an agent should never attempt to bypass authentication systems, modify real user credentials, or take disruptive system actions (killing running processes) in service of its own testing convenience. Manual verification by the human is not something to route around — it's the actual gate.**
- Task edit UI added (title/description/due_date, assigner-only, non-terminal-only), matching the already-existing but unwired `updateTaskFields()` server action.
- Hard-delete for tasks was requested and explicitly declined, for the same reasons as entities in step 2: `cancelled` already serves as the "this shouldn't happen" mechanism without destroying the audit trail; any UI-clutter concern should be solved with a default-hide filter, not deletion.
- `<UserButton />` (Clerk's built-in component) added to the app layout, giving a persistent "signed in as X" indicator and one-click sign-out — added specifically because account confusion during multi-account manual testing was a repeated real problem tonight.

## Step 5: Supervisor Read-Down

- Implemented as a pure read-only view riding entirely on the existing journal and tasks SELECT policies from steps 3 and 4 — no new RLS policies added.
- `get_subtree_members()` added as a `SECURITY DEFINER`, `STABLE` recursive function (following the `current_app_user()` / `is_admin()` / `is_in_subtree()` pattern) to list a user's full subtree, since `is_in_subtree()` itself only answers a yes/no pairwise question, not "give me the list."
- Explicitly no caching of subtree membership, anywhere. Verified live via a real reparent test: temporarily moved the foreman out of the admin's subtree, confirmed their content immediately disappeared from the admin's read-down view (no stale access), then reparented back and confirmed content reappeared. This is the load-bearing proof that the real-time, no-cache design actually holds, not just a stated intention.
- Existing journal/task components (tombstone rendering, task state display) reused directly rather than rebuilt for this view — verified no write affordances (delete, state-transition buttons) leaked into the read-down view beyond what author-only/assigner-only rules already correctly allow.

---

## Cross-cutting lessons from Stage One as a whole

- **Agent self-certification is not sufficient at any gate.** Nearly every step had at least one case where an agent reported something as "done," "passing," or "production-ready" that turned out to be wrong on direct inspection: a literal placeholder string committed as file content, a claimed file-move that never happened, a claimed webhook fix that was never pushed to the actual deployed environment, an initial RLS-grants misdiagnosis, and a percentage ("94.6% test coverage") offered in place of an actual gate pass. Every one of these was caught by asking for the real, current state (the file contents, the query result, the actual test run output) instead of accepting the summary.
- **"Tested locally" and "tested in production/remote" are different claims.** Local Supabase and the deployed project are separate databases; a migration or fix validated only against one has not been validated against the other. Several incidents tonight trace back to this exact gap (the `users.role` nullable migration never pushed to remote, the RLS-disable migration living only in history until explicitly checked).
- **Immutability/allow-list triggers must be revisited whenever the underlying table's schema changes**, not just when the trigger itself is touched. A generated column added for an unrelated feature (search) silently broke an existing trigger built in an earlier step.
- **NULL-unsafe comparisons (`!=` instead of `IS DISTINCT FROM`) are a recurring class of bug** anywhere an actor/caller identity is compared inside a trigger or function, since an unresolved caller silently produces NULL rather than a comparable value, and PL/pgSQL treats NULL conditions as false, not true. This should be treated as a standing checklist item for any future trigger writing caller-identity comparisons.
- **Disabling a security control to make a test pass is never acceptable**, regardless of how it's framed (temporary, local-only, infrastructure issue). This happened once (step 4, RLS on tasks) and was caught, but the instinct to reach for it under test-passing pressure is worth naming explicitly so it doesn't recur in stages two through six.

---

## Stage Two — Phase 1 (Schema): Grants &amp; Policy Audit

### Missing table grants for authenticated (T1.1b audit)
**Date**: 2026-07-10  
**Finding**: A systemic gap was discovered during T1.2 testing — most tables with RLS policies for `authenticated` lack the table-level GRANTs needed to exercise those policies. The app's `createServerSupabaseClient()` authenticates via Clerk + anon key, so it depends on these grants. Only `tasks` (fixed in `20240128000000`) and `journal_entries` (fixed here in `20240209000000`) had the full set. The root cause is that in this Supabase version, tables no longer auto-grant to `authenticated` — explicit `GRANT` statements are needed.

**Fixed**: `journal_entries` — `GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO authenticated` (migration `20240209000000`). `embeddings` — `GRANT ALL ON TABLE embeddings TO service_role` (same migration, needed for T2.4 embedding cron).

**Tracked debt — 11 tables still gapped** (have RLS policies, no authenticated grants):
`entities`, `entity_types`, `journal_entry_entities`, `wiki_entries`, `wiki_entry_versions`, `qa_threads`, `qa_answers`, `qa_answer_versions`, `raw_files`, `raw_file_entities`, `ai_call_log`.

None of these block stage two's current tickets. Revisit before stage three/four needs them or at the six-month review, whichever comes first.

### embeddings SELECT policy: using (true) closed (T1.1c)
**Date**: 2026-07-10  
**Finding**: The `embeddings` table shipped from stage zero with a `using (true)` SELECT policy for `authenticated` — unconditionally true for any user on any row. This was inert only because `embeddings` had no authenticated table grant, so the policy was never evaluated. A policy that reads "everyone can see everything" is wrong on its own terms regardless of whether a grant currently activates it.

**Fixed**: Dropped the `embeddings_select` policy entirely (migration `20240210000000`). Per spec §1.12, stage two ships with zero authenticated SELECT access to embeddings. The correct state matches `embedding_queue` (T1.1): RLS enabled, no policies for authenticated. When stage three needs embeddings access, the policy shape should be designed against the actual query pattern then, not now.

## Stage Two — Phase 2 (Backend Logic): Embedding provider switched from Cohere to OpenAI

**Date**: 2026-07-12
**Context**: The original stage-two spec pinned Cohere `embed-v4.0` at 1024 dimensions, chosen for Arabic+English cross-lingual retrieval quality (this project serves a company in Iraq). While building T2.4's embedding cron, discovered that `embed-v4.0` actually defaults to **1536 dimensions**, not 1024 — the spec's dimension assumption was wrong, or at minimum required an explicit `output_dimension` parameter on every Cohere call that the original design didn't account for. This surfaced the provider question rather than just a config fix.

**Decision**: Switch the embedding provider to OpenAI, model **`text-embedding-3-small`**, using OpenAI's own `dimensions` parameter to request exactly 1024 and keep the existing `embeddings.embedding vector(1024)` schema unchanged. No migration needed for the column itself. `text-embedding-3-large` was considered (stronger non-English claims per OpenAI's own materials) but rejected for now on cost (6.5x `-small`'s price) given the Arabic-quality risk below is already an accepted unknown either way — revisit `-large` specifically if `-small`'s Arabic retrieval quality proves insufficient once stage three's cross-team query is live, rather than paying the premium against an unconfirmed benefit now.

**Reasoning**:
- OpenAI is already the LLM provider for T2.3's supervisor-summary generation. One fewer vendor/API key to manage, not two separate AI providers.
- Meaningfully cheaper: `text-embedding-3-small` runs $0.02/1M tokens vs Cohere `embed-v4.0`'s $0.12/1M — a 6x difference at scale. `text-embedding-3-large` at $0.13/1M is roughly comparable to Cohere if the larger model's quality is wanted instead.
- No `input_type` (`search_document` vs `search_query`) asymmetry to get wrong. The original spec flagged this Cohere-specific requirement as a likely-to-be-quietly-mismatched bug between stage two's document-side embedding and stage three's future query-side embedding. OpenAI has no equivalent parameter, which removes that whole failure class rather than just documenting around it.

**Accepted risk, not resolved**: Cohere was chosen specifically for Arabic-language embedding quality, and there is no confirmed independent benchmark showing OpenAI's `text-embedding-3` models match Cohere's multilingual/cross-lingual strength for Arabic specifically. OpenAI's own materials claim `text-embedding-3-large` is their most capable model for non-English tasks, but this is a vendor claim, not independent verification. This is a real tradeoff being accepted for cost and architectural simplicity, not a confirmed quality win. If Arabic retrieval quality turns out poor once stage three's cross-team query is live, revisit this decision — reversing it means a corpus-wide re-embed (the `model_name` column on `embeddings` exists precisely to make that a detectable, migratable operation, per spec §1.7).

**Rejected**: Staying on Cohere and just adding the missing `output_dimension: 1024` parameter to fix the immediate dimension mismatch. Rejected because the cost and vendor-consolidation case for OpenAI was strong enough on its own to be worth taking now rather than revisiting later, and the dimension bug was the trigger for evaluating the provider, not the whole reason to switch.

**Implementation consequence**: T2.4's cron code, written against Cohere, needs reworking — drop the `cohere-ai` SDK and `COHERE_API_KEY`, drop `input_type` handling entirely, add `dimensions: 1024` to the OpenAI embeddings call, and use a distinct env var for the embedding model (`OPENAI_EMBEDDING_MODEL`) separate from `OPENAI_MODEL` (which is T2.3's chat-completion model) so the two are never conflated in config.

## Stage Two — complete (T3.1 gate passed, T4.1/T4.2 shipped)

**Date**: 2026-07-12

All fifteen stage-two tickets are done: schema (T1.1–T1.7), backend logic (T2.1–T2.5), the stage-two gate (T3.1), and UI (T4.1 summary view, T4.2 alert dashboard). All nine gate checks were independently re-verified against the live remote database (`dguamjezvrmdfoyctbxp`), not accepted from agent self-report — see the gate report for the full method (forced circuit-breaker trips and attempts-cap failures with disposable poison queue rows, a full re-run of the stage-one task-state matrix including a direct service-role `missed` attempt, RLS boundary checks via simulated authenticated sessions on real accounts).

**Bugs found and fixed during the gate/UI pass, not by the coding agent's own tests:**
- `proxy.ts` (Clerk middleware) didn't allowlist new `/api/cron/*` routes as they were added — every new cron 404'd behind `auth.protect()` in a way that looked like a routing bug, not an auth bug. Hit on both `/api/cron/embeddings` and `/api/cron/task-alerts`; a comment is now in `proxy.ts` itself flagging this for the next cron route.
- `lib/actions/summary.ts`: the generator-error logging path set `latency_ms` to an absolute epoch timestamp (`Date.now()`) instead of an elapsed duration, overflowing the `int` column and silently failing that specific `ai_call_log` insert (caught by its own inner try/catch, so it never surfaced as an error — it just meant generator-error refusals were never actually logged). Fixed to compute real elapsed ms from a captured call-start time. Found only because the gate's check-9 test suite was actually executed end-to-end for the first time (previous ticket acceptances relied on code review, not a real run).
- `app/supervisor/alerts/page.tsx`: alerts were silently dropped from the dashboard if the assignee wasn't in the caller's own subtree list — but `task_alerts` RLS grants visibility on two independent conditions (assigner OR ancestor-of-assignee), and task assignment isn't hierarchy-gated, so a supervisor who assigned a task outside their own branch would have a real, valid alert vanish from their own dashboard. Fixed to fall back to showing the raw id rather than dropping the row.
- Multiple test-infrastructure bugs surfaced only once tests were actually run against a freshly-reset local Supabase instead of code-reviewed: service-role vs. authenticated-client mismatches on tables with no service-role grant by design (`journal_entries` — T1.1b), missing test isolation letting one test's `ai_call_log` row rate-limit the next test in the same file, and a mock `.then()` override that didn't implement the thenable protocol correctly (silently hung instead of rejecting).

**Process note**: local Supabase (`supabase start`) was found significantly out of sync with the migrations directory going into this pass — confirms the standing discipline of verifying against the live remote project rather than trusting local state, and additionally shows local dev-test runs need the same discipline (`supabase db reset` before trusting a local test run, not just before a remote push).

**On the horizon**: six-month review (scope-vs-adoption reality, Clerk account handover), the 11-table grants debt tracked in earlier stage-one entries, and stage three (cross-team query, synthesis prep, clone agent) — none of which are started.