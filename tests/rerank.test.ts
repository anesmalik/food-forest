import { describe, it, expect } from 'vitest'
import { rerank, type SearchCorpusRow } from '../lib/rerank'

describe('rerank', () => {
  it('wiki chunk outranks journal chunk at equal similarity', () => {
    const rows: SearchCorpusRow[] = [
      {
        content_type: 'journal_entry',
        content_id: 'journal-1',
        chunk_index: 0,
        chunk_text: 'Some journal text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
      {
        content_type: 'wiki_entry_version',
        content_id: 'wiki-1',
        chunk_index: 0,
        chunk_text: 'Some wiki text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
    ]

    const ranked = rerank(rows)

    expect(ranked[0].content_type).toBe('wiki_entry_version')
    expect(ranked[1].content_type).toBe('journal_entry')
  })

  it('qa_answer_version outranks journal chunk at equal similarity', () => {
    const rows: SearchCorpusRow[] = [
      {
        content_type: 'journal_entry',
        content_id: 'journal-1',
        chunk_index: 0,
        chunk_text: 'Some journal text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
      {
        content_type: 'qa_answer_version',
        content_id: 'qa-1',
        chunk_index: 0,
        chunk_text: 'Some QA text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
    ]

    const ranked = rerank(rows)

    expect(ranked[0].content_type).toBe('qa_answer_version')
    expect(ranked[1].content_type).toBe('journal_entry')
  })

  it('wiki chunk outranks qa_answer_version at equal similarity (full ordering)', () => {
    const rows: SearchCorpusRow[] = [
      {
        content_type: 'qa_answer_version',
        content_id: 'qa-1',
        chunk_index: 0,
        chunk_text: 'Some QA text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
      {
        content_type: 'journal_entry',
        content_id: 'journal-1',
        chunk_index: 0,
        chunk_text: 'Some journal text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
      {
        content_type: 'wiki_entry_version',
        content_id: 'wiki-1',
        chunk_index: 0,
        chunk_text: 'Some wiki text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
    ]

    const ranked = rerank(rows)

    expect(ranked[0].content_type).toBe('wiki_entry_version')
    expect(ranked[1].content_type).toBe('qa_answer_version')
    expect(ranked[2].content_type).toBe('journal_entry')
  })

  it('strong question_similarity boost can outrank higher raw-similarity qa_answer_version', () => {
    const rows: SearchCorpusRow[] = [
      {
        content_type: 'qa_answer_version',
        content_id: 'qa-low',
        chunk_index: 0,
        chunk_text: 'Low raw similarity QA answer',
        similarity: 0.3,
        question_similarity: 0.95,
        created_at: '2026-01-10T09:00:00Z',
      },
      {
        content_type: 'journal_entry',
        content_id: 'journal-high',
        chunk_index: 0,
        chunk_text: 'High raw similarity journal',
        similarity: 0.7,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
    ]

    const ranked = rerank(rows)

    // QA score = 0.3 * 1.08 + 0.95 * 0.5 = 0.324 + 0.475 = 0.799
    // Journal score = 0.7 * 1.0 = 0.7
    // QA should win
    expect(ranked[0].content_id).toBe('qa-low')
    expect(ranked[1].content_id).toBe('journal-high')
  })

  it('question_similarity has no effect on non-qa_answer_version rows', () => {
    const rows: SearchCorpusRow[] = [
      {
        content_type: 'journal_entry',
        content_id: 'journal-1',
        chunk_index: 0,
        chunk_text: 'Some journal text',
        similarity: 0.5,
        question_similarity: 0.95,
        created_at: '2026-01-10T09:00:00Z',
      },
      {
        content_type: 'wiki_entry_version',
        content_id: 'wiki-1',
        chunk_index: 0,
        chunk_text: 'Some wiki text',
        similarity: 0.4,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
    ]

    const ranked = rerank(rows)

    // Journal score = 0.5 * 1.0 = 0.5 (question_similarity ignored)
    // Wiki score = 0.4 * 1.15 = 0.46
    // Journal should win despite question_similarity being present
    expect(ranked[0].content_id).toBe('journal-1')
    expect(ranked[1].content_id).toBe('wiki-1')
  })

  it('ties broken by recency, newest first', () => {
    const rows: SearchCorpusRow[] = [
      {
        content_type: 'journal_entry',
        content_id: 'journal-old',
        chunk_index: 0,
        chunk_text: 'Some journal text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-10T09:00:00Z',
      },
      {
        content_type: 'journal_entry',
        content_id: 'journal-new',
        chunk_index: 0,
        chunk_text: 'Some newer journal text',
        similarity: 0.6,
        question_similarity: null,
        created_at: '2026-01-15T09:00:00Z',
      },
    ]

    const ranked = rerank(rows)

    expect(ranked[0].content_id).toBe('journal-new')
    expect(ranked[1].content_id).toBe('journal-old')
  })
})
