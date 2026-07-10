# Stage One, Step 5: Supervisor Read-Down - Implementation Complete

## Overview
Stage One Step 5 is now complete. The supervisor read-down view allows users with direct or indirect reports to browse their team members' journal entries and tasks in a unified interface. This step builds entirely on top of existing RLS policies from steps 3 and 4 — no new security policies added.

## Architecture

### Design Principle
Read-down is **not a new subsystem**. It is a UI view built entirely on existing RLS policies:
- **Journal**: Existing SELECT policy allows supervisors to read reports' entries via `is_in_subtree(current_app_user(), author_id)`
- **Tasks**: Existing SELECT policy allows supervisors to read reports' tasks via `is_in_subtree(current_app_user(), assignee_id)`

The read-down view reuses these same data access patterns through different filters. No new RLS policies created.

### Real-Time, No Caching
`get_subtree_members()` returns the current user's subordinates recursively via CTE, executed fresh on every load. No caching at any level (client, server, or cache layer).

**Why**: Caching subtree membership is not a performance optimization — it's an access-control bug. If a person is reparented out of a subtree, a stale cache would let the old supervisor keep reading their content after losing access. At this scale (low dozens of users, shallow tree), the recursive walk is unmeasurable.

## Implementation

### Database Layer ✅

#### Migration: 20240206000000_get_subtree_members.sql
- **Function**: `get_subtree_members()` — SECURITY DEFINER, STABLE
- **Behavior**: Recursive CTE to fetch all direct and indirect reports of the current user
- **Returns**: (id, display_name, role, supervisor_id) ordered by display_name
- **Access**: Granted to authenticated role
- **Pattern**: Follows `current_app_user()`, `is_admin()`, `is_in_subtree()` — SECURITY DEFINER to bypass RLS on users table internally

### Backend Actions ✅

#### lib/actions/tasks.ts (New)
```typescript
export type SubtreeMember = {
  id: string
  display_name: string
  role: string
  supervisor_id: string | null
}

export async function getSubtreeMembers(): Promise<SubtreeMember[]>
```
- Calls `get_subtree_members()` RPC, returns full subordinate list
- Used to populate team member selector

#### lib/actions/tasks.ts (New)
```typescript
export async function getSubordinateTasks(assigneeId: string, state?: string): Promise<Task[]>
```
- Fetch tasks for a specific team member (filtered by assignee_id)
- Respects existing RLS — supervisor must have access via `is_in_subtree()`
- Returns same Task type as other task queries

#### lib/actions/journal.ts (Existing, Reused)
```typescript
export async function getJournalPage(cursor: string | null, authorFilter?: string | null)
```
- Already supported `authorFilter` parameter
- Read-down page passes specific subordinate ID as authorFilter
- Reuses existing RPC and journal entry transformation logic

### UI Layer ✅

#### Route: `/supervisor/read-down`
- **Authorization**: Requires authenticated user (layout checks auth)
- **Empty state**: Shows "You don't have any direct or indirect reports yet" if no subordinates
- **Access**: Any user with a non-empty subtree can navigate here

#### Components

**SupervisorReadDownPage** (`app/supervisor/read-down/page.tsx`)
- Main layout: sidebar with team list + content area
- Left sidebar: Subordinates list
  - Shows display_name and role for each team member
  - Click to select and view their data
  - Ordered alphabetically
- Right content area (after selection):
  - "Journal Entries" section with reused JournalEntryCard component
  - "Tasks" section with reused TaskCard component
  - Both sections support pagination/filtering as original views do

**JournalEntryCard** (Embedded)
- Displays journal entry metadata (author, date, entities, linked task, corrections)
- Tombstone rendering: deleted entries show only metadata, no body text
- Read-only: No delete button (RLS UPDATE policy restricts to author_id = current_app_user())
- Reuses exact same rendering logic as step 3's journal page

**TaskCard** (Reused)
- Displays task title, description, due date, state, completed_at
- Dynamic transition buttons based on user's role
  - Supervisor sees transition buttons only if they are the assigner
  - Assigner-only actions hidden for supervisor unless they assigned the task
- RLS UPDATE policy on tasks enforces this automatically

### Layout ✅

#### `/app/supervisor/layout.tsx`
- Verifies user is authenticated
- Checks user row exists (sync-window guard)
- Prevents unauthorized access to supervisor routes

## Verification Checklist

### Pre-Deployment Verification ✅
- [x] Migration file created and applied (20240206000000)
- [x] `get_subtree_members()` function exists and is SECURITY DEFINER
- [x] RLS policies confirmed correct (journal_entries and tasks)
- [x] `getSubtreeMembers()` action implemented
- [x] `getSubordinateTasks()` action implemented
- [x] Read-down page created at `/supervisor/read-down`
- [x] Supervisor layout created with auth checks
- [x] Components reuse existing JournalEntryCard and TaskCard
- [x] App compiles without errors
- [x] Route appears in build output
- [x] Decisions log updated

### Manual Verification (Ready to Test)
1. **As admin (`foodforestadmin@gmail.com`)**:
   - Navigate to `/supervisor/read-down`
   - Subtree list shows `anesmalik@gmail.com` and any others under hierarchy
   - Select foreman from list
   - View their journal entries (including tombstones from step 3)
   - View their tasks (including completed tasks from step 4)
   - Verify no delete buttons on entries (read-only)
   - Verify no transition buttons on tasks unless you're assigner

2. **As foreman (`anesmalik@gmail.com`)**:
   - Navigate to `/supervisor/read-down`
   - Should see "You don't have any direct or indirect reports yet"
   - No errors

3. **Reparent Test** (Proves no caching):
   - As admin, view foreman's data in read-down
   - Temporarily change foreman's supervisor to someone else (e.g., via admin placement page)
   - Immediately navigate back to read-down
   - Confirm foreman's content is gone (no stale cache)
   - Change supervisor back
   - Confirm content reappears immediately

## Files Created/Modified

### New Files
- `supabase/migrations/20240206000000_get_subtree_members.sql` — Database function
- `app/supervisor/read-down/page.tsx` — Main read-down view component
- `app/supervisor/layout.tsx` — Authorization layout for supervisor routes

### Modified Files
- `lib/actions/tasks.ts` — Added getSubtreeMembers(), getSubordinateTasks(), SubtreeMember type
- `DECISIONS.md` — Added Stage One Step 5 decision entries
- `.next/` — Updated build with new route

## Architecture Decisions

See DECISIONS.md for complete decision log. Key decisions:

1. **Read-down as a view, not a subsystem** — Reuses existing RLS policies, no new policies added
2. **Real-time recursive, no caching** — Security guarantee worth the unmeasurable performance cost at this scale
3. **`get_subtree_members()` as SECURITY DEFINER** — Follows current_app_user() pattern to avoid RLS recursion
4. **Reuse components from steps 3 and 4** — JournalEntryCard and TaskCard render the same way in both original and read-down views
5. **Supervisor write-only on own actions** — RLS UPDATE policies automatically prevent supervisors from editing subordinates' content

## Known Limitations & Future Work

### Not Implemented (Per Spec)
- Supervisor search or filtering of subordinates' content (out of scope for step 5)
- Pagination controls for large subordinate lists (straightforward to add, not required)
- Batch operations (e.g., marking multiple tasks) — out of scope
- Supervisor summaries (AI features) — stage two

### Future Enhancements (Post-Stage One)
- Embeddings-based search within subordinate content
- AI summaries of subordinate activity
- Caching strategy (if org grows to hundreds+ users)
- Supervisor completion of tasks on behalf of reports (flagged for review)

## Status
✅ **Complete and Ready for Manual Verification**

All specified functionality implemented:
- Database function for fetching subtree members
- Server actions for subtree-aware queries
- Full UI for browsing subordinate content
- Proper reuse of existing components
- Real-time, uncached access control

**Next step**: Manual verification with test accounts (especially the reparent test), then ready for Stage Two.

## Testing Notes

### Verification Commands

Check migration applied:
```bash
npx supabase migrations list | grep 20240206
# Should show: {"local":"20240206000000","remote":"20240206000000",...}
```

Check app builds:
```bash
npm run build
# Should output: ├ ƒ /supervisor/read-down
```

Check function exists (via Supabase dashboard):
```sql
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'get_subtree_members';
-- Should return: get_subtree_members | t
```
