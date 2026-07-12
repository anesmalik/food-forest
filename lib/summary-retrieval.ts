// T2.2: Core retrieval logic for summary grounding.
// Separated from the server action so it can be tested directly.
// Takes a Supabase client as a parameter to support testing with authenticated clients.

import { SupabaseClient } from '@supabase/supabase-js'
import { SUMMARY_WINDOW_DAYS, SUMMARY_MAX_ENTRIES } from '@/lib/journal-types'

export type SummaryEntry = {
  id: string
  created_at: string
  body: string
}

/**
 * T2.2: Retrieve journal entries for a target user to ground a summary.
 *
 * The retrieval window is the last 30 days or last 50 entries, whichever is smaller.
 * This is enforced by combining .gte(created_at, windowStart) with .limit(50) in a single query —
 * Postgres naturally returns the intersection.
 *
 * RLS policy on journal_entries (journal_entries_select) handles the access boundary:
 * - The caller must be the author OR an ancestor in the organizational tree.
 * - If the caller is outside the target user's subtree, RLS returns an empty result set.
 * - No app-code subtree check is needed or wanted (that would duplicate RLS).
 *
 * This function is testable: it takes a Supabase client as a parameter.
 * The server action wrapper (in lib/actions/summary.ts) creates the authenticated client.
 *
 * @param supabase Supabase client (must be authenticated for RLS to enforce boundaries).
 * @param targetUserId UUID of the user whose entries will be summarized.
 * @returns Array of entries ordered oldest-to-newest. Empty array if none found or access denied.
 */
export async function retrieveSummaryEntries(
  supabase: SupabaseClient,
  targetUserId: string
): Promise<SummaryEntry[]> {
  // Calculate the 30-day window start (oldest entry to include).
  const windowStart = new Date(
    Date.now() - SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // Query entries matching all criteria: author, within window, not soft-deleted.
  // Combined with .limit(50), the result is naturally the smaller of the two bounds.
  // Ordered oldest-to-newest so a chronological summary reads forward in time.
  const { data, error } = await supabase
    .from('journal_entries')
    .select('id, created_at, body')
    .eq('author_id', targetUserId)
    .is('soft_deleted_at', null)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: true })
    .limit(SUMMARY_MAX_ENTRIES)

  if (error) {
    console.error('retrieveSummaryEntries error:', error)
    return []
  }

  return data ?? []
}
