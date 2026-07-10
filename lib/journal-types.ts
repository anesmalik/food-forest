// Non-server module: types, constants, and pure functions for the journal layer.
// 'use server' files can only export async functions, so these live here instead.

// Page size pinned per spec §1.12 — not configurable per-component.
export const JOURNAL_PAGE_SIZE = 50

export type JournalEntry = {
  id: string
  author_id: string
  author_name: string | null
  body: string | null // null when tombstoned — body is absent from the response entirely
  sensitivity: string
  created_at: string
  soft_deleted_at: string | null
  corrects_entry_id: string | null
  corrects_entry_created_at: string | null
  task_id: string | null
  task_title: string | null
  entities: { id: string; name: string; type: string }[]
}

export type JournalPage = {
  entries: JournalEntry[]
  nextCursor: string | null
}

export type RawJournalRow = {
  id: string
  author_id: string
  author_name: string | null
  body: string
  sensitivity: string
  created_at: string
  soft_deleted_at: string | null
  corrects_entry_id: string | null
  corrects_entry_created_at: string | null
  task_id: string | null
  task_title: string | null
  entity_id: string | null
  entity_name: string | null
  entity_type: string | null
}

/**
 * Client-side normalization matching the DB's normalize_for_search() function.
 * Must stay in sync with the SQL function in migration 20240115000000.
 * Used to normalize the search query before sending to the trigram search RPC.
 */
export function normalizeForSearch(input: string): string {
  // Strip tashkeel (U+064B–U+065F, U+0670)
  const stripped = input.replace(/[\u064B-\u065F\u0670]/g, '')
  // Fold letter forms: أإآٱ → ا, ة → ه, ى → ي
  const folded = stripped
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
  // Collapse whitespace
  return folded.replace(/\s+/g, ' ').trim()
}

/**
 * Transform raw RPC rows into grouped JournalEntry objects.
 * Shared by getJournalPage and searchJournal.
 * Strips body from tombstoned entries (redundant with the RPC's CASE, but
 * defense-in-depth: the body should never reach the client for tombstones).
 */
export function transformJournalRows(rows: RawJournalRow[]): JournalEntry[] {
  const entryMap = new Map<string, JournalEntry>()
  for (const row of rows) {
    if (!entryMap.has(row.id)) {
      entryMap.set(row.id, {
        id: row.id,
        author_id: row.author_id,
        author_name: row.author_name,
        body: row.soft_deleted_at ? null : row.body,
        sensitivity: row.sensitivity,
        created_at: row.created_at,
        soft_deleted_at: row.soft_deleted_at,
        corrects_entry_id: row.corrects_entry_id,
        corrects_entry_created_at: row.corrects_entry_created_at,
        task_id: row.task_id,
        task_title: row.task_title,
        entities: [],
      })
    }
    const entry = entryMap.get(row.id)!
    if (row.entity_id) {
      entry.entities.push({
        id: row.entity_id,
        name: row.entity_name!,
        type: row.entity_type!,
      })
    }
  }
  return Array.from(entryMap.values())
}
