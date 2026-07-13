import { CONTENT_TYPE_WEIGHT, QA_QUESTION_MATCH_BOOST_WEIGHT } from './rerank-constants'

export type SearchCorpusContentType =
  | 'journal_entry'
  | 'wiki_entry_version'
  | 'qa_answer_version'

export type SearchCorpusRow = {
  content_type: SearchCorpusContentType
  content_id: string
  chunk_index: number
  chunk_text: string
  similarity: number
  question_similarity: number | null
  created_at: string
}

export type RankedRow = SearchCorpusRow & { rankScore: number }

/**
 * T2.3: Pure re-rank function. No I/O, no DB, no network — takes
 * search_corpus's rows as-is and returns them ordered by rank score.
 *
 * Ranking rule (spec §1.7):
 * - base score is cosine similarity
 * - content-type weight multiplies it: wiki_entry_version > qa_answer_version > journal_entry
 * - qa_answer_version gets an additional additive boost scaled by
 *   question_similarity (the LINKED qa_question's similarity to the query,
 *   precomputed by search_corpus — this function does not look it up)
 * - ties broken by recency (created_at desc)
 */
export function rerank(rows: SearchCorpusRow[]): RankedRow[] {
  const scored = rows.map((row) => {
    const weight = CONTENT_TYPE_WEIGHT[row.content_type] ?? 1.0
    let score = row.similarity * weight

    if (row.content_type === 'qa_answer_version' && row.question_similarity != null) {
      score += row.question_similarity * QA_QUESTION_MATCH_BOOST_WEIGHT
    }

    return { ...row, rankScore: score }
  })

  scored.sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  return scored
}
