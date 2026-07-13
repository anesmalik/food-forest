import { describe, it, expect } from 'vitest'
import { TEST_QUERY_VECTOR } from '../scripts/fixtures/generate-fixture'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'
import { rerank } from '../lib/rerank'

describe('T5.1 Assertion #10 Part A — qa_answer_version weight-only rerank', () => {
  it('should rank qa_answer_version before journal_entry at equal raw similarity', async () => {
    // Import check
    console.log('TEST_QUERY_VECTOR length:', TEST_QUERY_VECTOR.length)
    console.log('First 5 elements:', TEST_QUERY_VECTOR.slice(0, 5))

    // Mock search_corpus results (in raw HNSW order, not reranked)
    const rawResults = [
      {
        content_type: 'journal_entry' as const,
        content_id: FIXTURE.journal.consultantANormal,
        chunk_index: 0,
        chunk_text: 'Reviewed irrigation schedules across both sites this week.',
        similarity: 0.6, // Expected similarity when using TEST_QUERY_VECTOR
        question_similarity: null,
        created_at: '2026-07-13T12:38:36.100246+00:00'
      },
      {
        content_type: 'qa_answer_version' as const,
        content_id: '80000000-0000-0000-0000-000000000003',
        chunk_index: 0,
        chunk_text: 'Test answer for rerank',
        similarity: 0.6, // Same raw similarity, weight-only test
        question_similarity: null,
        created_at: '2026-07-13T15:16:26.604642+00:00'
      }
    ]

    console.log('\nRaw search_corpus results (before rerank):')
    rawResults.forEach((r, idx) => {
      console.log(`${idx}: ${r.content_id} (${r.content_type}) similarity=${r.similarity}`)
    })

    // Apply rerank
    const ranked = rerank(rawResults)

    console.log('\nAfter rerank:')
    ranked.forEach((r, idx) => {
      console.log(`${idx}: ${r.content_id} (${r.content_type}) rankScore=${r.rankScore}`)
    })

    // Find indices
    const qaAnswerIdx = ranked.findIndex(r => r.content_id === '80000000-0000-0000-0000-000000000003')
    const consultantIdx = ranked.findIndex(r => r.content_id === FIXTURE.journal.consultantANormal)

    console.log(`\nqa_answer_version index: ${qaAnswerIdx}`)
    console.log(`consultantANormal index: ${consultantIdx}`)
    console.log(`qa_answer_version ranks BEFORE consultantANormal: ${qaAnswerIdx < consultantIdx}`)

    // Assert
    expect(qaAnswerIdx).toBeLessThan(consultantIdx)
    expect(ranked[qaAnswerIdx].content_type).toBe('qa_answer_version')
    expect(ranked[consultantIdx].content_type).toBe('journal_entry')
  })
})
