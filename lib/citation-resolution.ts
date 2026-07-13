import { SupabaseClient } from '@supabase/supabase-js'

export type Citation = {
  contentType: 'journal_entry' | 'wiki_entry_version' | 'qa_answer_version'
  contentId: string
}

export type ResolvedCitation = Citation & { visible: boolean }

/**
 * T4.3: Fetch the stored citation list for a given answer version. Pure
 * data access, no scope resolution — that's resolveCitationsForReader below.
 */
export async function getCitationsForAnswerVersion(
  supabase: SupabaseClient,
  answerVersionId: string
): Promise<Citation[]> {
  const { data, error } = await supabase
    .from('qa_citations')
    .select('content_type, content_id')
    .eq('answer_version_id', answerVersionId)

  if (error) {
    throw new Error(`Failed to fetch citations: ${error.message}`)
  }

  return (data ?? []).map((row: any) => ({
    contentType: row.content_type,
    contentId: row.content_id,
  }))
}

/**
 * T4.3: The laundering gate. Resolves each citation through can_see_content()
 * for the CURRENT READER's session (the supabase client passed in must be
 * authenticated as the reader, never the asking/answering user, never a
 * service-role client) — the asker and the reader differ the moment a second
 * person opens the thread. A citation the reader cannot see comes back
 * visible: false. Callers (T6.2's thread view) must drop the link entirely
 * for those — never render the entry, never render a dead link that still
 * carries the id anywhere in the DOM or API response.
 */
export async function resolveCitationsForReader(
  supabase: SupabaseClient,
  citations: Citation[]
): Promise<ResolvedCitation[]> {
  const results = await Promise.all(
    citations.map(async (citation) => {
      const { data, error } = await supabase.rpc('can_see_content', {
        p_content_type: citation.contentType,
        p_content_id: citation.contentId,
      })

      if (error) {
        console.error('can_see_content RPC failed:', citation, error)
        return { ...citation, visible: false }
      }

      return { ...citation, visible: data === true }
    })
  )

  return results
}
