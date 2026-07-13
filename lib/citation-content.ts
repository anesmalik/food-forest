import { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedCitation } from './citation-resolution'

export type CitationWithContent = {
  contentType: 'journal_entry' | 'wiki_entry_version' | 'qa_answer_version'
  contentId: string
  visible: boolean
  content?: string
}

async function fetchContentBody(
  supabase: SupabaseClient,
  contentType: string,
  contentId: string
): Promise<string | null> {
  try {
    if (contentType === 'journal_entry') {
      const { data, error } = await supabase.from('journal_entries').select('body').eq('id', contentId).single()
      if (error) {
        console.error(`Failed to fetch journal_entry ${contentId}:`, error)
        return null
      }
      return data?.body ?? null
    } else if (contentType === 'wiki_entry_version') {
      const { data, error } = await supabase.from('wiki_entry_versions').select('body').eq('id', contentId).single()
      if (error) {
        console.error(`Failed to fetch wiki_entry_version ${contentId}:`, error)
        return null
      }
      return data?.body ?? null
    } else if (contentType === 'qa_answer_version') {
      const { data, error } = await supabase.from('qa_answer_versions').select('body').eq('id', contentId).single()
      if (error) {
        console.error(`Failed to fetch qa_answer_version ${contentId}:`, error)
        return null
      }
      return data?.body ?? null
    }
  } catch (err) {
    console.error(`Error fetching content ${contentType}/${contentId}:`, err)
  }
  return null
}

/**
 * Defense in depth: resolve a citation from resolveCitationsForReader through
 * a content fetch. If the citation resolved visible: true but the content fetch
 * returns null (RLS or other issue), downgrade visible to false. This is the
 * actual safety boundary — citations are only rendered as visible if both the
 * can_see_content RPC AND the content fetch succeed.
 */
export async function resolveCitationWithContent(
  supabase: SupabaseClient,
  citation: ResolvedCitation
): Promise<CitationWithContent> {
  if (!citation.visible) {
    return {
      contentType: citation.contentType,
      contentId: citation.contentId,
      visible: false,
    }
  }

  const contentBody = await fetchContentBody(supabase, citation.contentType, citation.contentId)

  if (!contentBody) {
    return {
      contentType: citation.contentType,
      contentId: citation.contentId,
      visible: false,
    }
  }

  return {
    contentType: citation.contentType,
    contentId: citation.contentId,
    visible: true,
    content: contentBody,
  }
}
