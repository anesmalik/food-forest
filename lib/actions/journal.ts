'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import {
  JOURNAL_PAGE_SIZE,
  normalizeForSearch,
  transformJournalRows,
  type JournalEntry,
  type JournalPage,
  type RawJournalRow,
} from '@/lib/journal-types'

/**
 * Get the current user's UUID from Clerk ID.
 */
async function getCurrentUserId(): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', userId)
    .single()

  return data?.id ?? null
}

/**
 * Fetch a page of journal entries visible to the current user (own + subtree).
 * Cursor-paginated on (created_at, id) descending. Tombstones count toward the page.
 *
 * Tombstone handling: when soft_deleted_at is not null, body is set to null in
 * the response — the body text is NOT returned at all, even to the author.
 * This is a query-shape choice, not a rendering choice.
 *
 * The cursor is a base64-encoded JSON of { created_at, id }.
 */
export async function getJournalPage(
  cursor: string | null,
  authorFilter?: string | null
): Promise<JournalPage> {
  const supabase = await createServerSupabaseClient()

  const params: Record<string, unknown> = {
    p_limit: JOURNAL_PAGE_SIZE,
    p_cursor_created_at: null as string | null,
    p_cursor_id: null as string | null,
    p_author_filter: authorFilter ?? null,
  }

  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString())
      params.p_cursor_created_at = decoded.created_at
      params.p_cursor_id = decoded.id
    } catch {
      // Invalid cursor — start from beginning
    }
  }

  const { data, error } = await supabase.rpc('journal_page', params)

  if (error) {
    console.error('journal_page error:', error)
    return { entries: [], nextCursor: null }
  }

  const rows = (data ?? []) as RawJournalRow[]
  const entries = transformJournalRows(rows)

  // Compute next cursor from the last entry
  let nextCursor: string | null = null
  if (entries.length === JOURNAL_PAGE_SIZE) {
    const last = entries[entries.length - 1]
    nextCursor = Buffer.from(
      JSON.stringify({ created_at: last.created_at, id: last.id })
    ).toString('base64')
  }

  return { entries, nextCursor }
}

/**
 * Search journal entries using trigram matching on the normalized body column.
 * The query string is normalized client-side (same folds as the DB function)
 * so query and stored text meet in the same normalized space.
 *
 * Provisional/keyword-only — stage two's embeddings are the real retrieval story.
 */
export async function searchJournal(
  query: string
): Promise<JournalEntry[]> {
  const normalized = normalizeForSearch(query)
  if (!normalized) return []

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc('journal_search', {
    p_query: normalized,
    p_limit: JOURNAL_PAGE_SIZE,
  })

  if (error) {
    console.error('journal_search error:', error)
    return []
  }

  const rows = (data ?? []) as RawJournalRow[]
  return transformJournalRows(rows)
}

/**
 * Create a journal entry with optional entity tags and optional correction reference.
 * Entity tagging happens immediately after the entry insert.
 */
export async function createJournalEntry(
  body: string,
  entityIds: string[],
  sensitivity: 'normal' | 'restricted',
  correctsEntryId: string | null,
  taskId?: string | null
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const userUuid = await getCurrentUserId()
  if (!userUuid) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  // Insert the journal entry — RLS enforces author_id = current_app_user()
  const { data: entry, error: insertError } = await supabase
    .from('journal_entries')
    .insert({
      body,
      author_id: userUuid,
      sensitivity,
      corrects_entry_id: correctsEntryId,
      task_id: taskId || null,
    })
    .select('id')
    .single()

  if (insertError || !entry) {
    return { success: false, error: insertError?.message ?? 'Insert failed' }
  }

  // Tag entities — write to junction table immediately after entry insert.
  // RLS on journal_entry_entities enforces that the journal entry's author
  // must be the current user.
  if (entityIds.length > 0) {
    const junctionRows = entityIds.map((entityId) => ({
      journal_entry_id: entry.id,
      entity_id: entityId,
    }))

    const { error: tagError } = await supabase
      .from('journal_entry_entities')
      .insert(junctionRows)

    if (tagError) {
      // Entry was created but tagging failed — return success with a note.
      // The entry exists; tags can be added later. Don't fail the whole operation.
      console.error('entity tagging failed:', tagError)
    }
  }

  return { success: true, id: entry.id }
}

/**
 * Soft-delete a journal entry. Author-only at the RLS policy level.
 * Sets soft_deleted_at — the immutability trigger enforces write-once
 * (cannot be unset once set). The body becomes a tombstone (absent from
 * future query responses via the RPC).
 */
export async function softDeleteJournalEntry(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  // RLS UPDATE policy scopes to author_id = current_app_user().
  // The immutability trigger allows only soft_deleted_at mutation.
  const { error } = await supabase
    .from('journal_entries')
    .update({ soft_deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Get a list of the current user's recent entries for the "corrects" dropdown.
 * Only the author's own entries can be corrected.
 */
export async function getCorrectableEntries(): Promise<
  { id: string; created_at: string; body_preview: string }[]
> {
  const userUuid = await getCurrentUserId()
  if (!userUuid) return []

  const supabase = await createServerSupabaseClient()

  const { data } = await supabase
    .from('journal_entries')
    .select('id, created_at, body')
    .eq('author_id', userUuid)
    .is('soft_deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20)

  return (data ?? []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    body_preview: row.body.slice(0, 80),
  }))
}
