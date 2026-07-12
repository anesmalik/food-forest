/**
 * T2.1 — Citation Validator Tests
 *
 * Unit tests for the pure citation validator function.
 * No OpenAI calls, no database, no mocks — only pure function validation.
 *
 * Run: npx vitest run tests/citation-validator.test.ts
 */

import { describe, it, expect } from 'vitest'
import { validateCitedSummary, type ValidationResult } from '../lib/citation-validator'

describe('validateCitedSummary', () => {
  const setA = new Set(['id-a'])
  const setAB = new Set(['id-a', 'id-b'])
  const setABC = new Set(['id-a', 'id-b', 'id-c'])

  describe('valid cases', () => {
    it('accepts valid subset — cites {A, B} when {A, B, C} available', () => {
      const modelOutput = JSON.stringify({
        summary: 'This is a summary.',
        citations: ['id-a', 'id-b'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe('This is a summary.')
        expect(result.citations).toEqual(['id-a', 'id-b'])
      }
    })

    it('accepts valid full set — cites every id when exactly matched', () => {
      const modelOutput = JSON.stringify({
        summary: 'Comprehensive summary.',
        citations: ['id-a', 'id-b', 'id-c'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe('Comprehensive summary.')
        expect(result.citations).toEqual(['id-a', 'id-b', 'id-c'])
      }
    })

    it('accepts single citation', () => {
      const modelOutput = JSON.stringify({
        summary: 'One thing.',
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.citations.length).toBe(1)
      }
    })

    it('accepts blank summary with empty citations', () => {
      const modelOutput = JSON.stringify({
        summary: '',
        citations: [],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe('')
        expect(result.citations.length).toBe(0)
      }
    })

    it('accepts whitespace-only summary (treated as blank) with empty citations', () => {
      const modelOutput = JSON.stringify({
        summary: '   \n  \t  ',
        citations: [],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
    })

    it('preserves exact summary text including whitespace', () => {
      const summaryWithWhitespace = 'Line 1\n  Line 2\t\tLine 3'
      const modelOutput = JSON.stringify({
        summary: summaryWithWhitespace,
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe(summaryWithWhitespace)
      }
    })
  })

  describe('fabricated citations — refused', () => {
    it('refuses unknown citation ID when others are valid', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary with mixed sources.',
        citations: ['id-a', 'id-c', 'id-unknown'],
      })
      const result = validateCitedSummary(modelOutput, setAB)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        // Reason mentions the unknown id (for debugging), but we assert on
        // behavior (rejection), not the exact string per spec §1.6a.
        expect(result.reason).toBeDefined()
        expect(result.reason.length).toBeGreaterThan(0)
      }
    })

    it('refuses when all citations are fabricated', () => {
      const modelOutput = JSON.stringify({
        summary: 'Made up entirely.',
        citations: ['id-x', 'id-y', 'id-z'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBeDefined()
      }
    })

    it('refuses single fabricated citation', () => {
      const modelOutput = JSON.stringify({
        summary: 'Based on nothing.',
        citations: ['id-fabricated'],
      })
      const result = validateCitedSummary(modelOutput, setAB)

      expect(result.ok).toBe(false)
    })
  })

  describe('substantive summary without citations — refused', () => {
    it('refuses non-blank summary with empty citations', () => {
      const modelOutput = JSON.stringify({
        summary: 'This is substantive content.',
        citations: [],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBeDefined()
      }
    })

    it('refuses summary with only whitespace-stripped content and no citations', () => {
      const modelOutput = JSON.stringify({
        summary: '  Important content  ',
        citations: [],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses single character summary without citations', () => {
      const modelOutput = JSON.stringify({
        summary: 'x',
        citations: [],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })
  })

  describe('malformed JSON — refused', () => {
    it('refuses invalid JSON syntax', () => {
      const modelOutput = '{ summary: "not quoted", citations: [] }'
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('not valid JSON')
      }
    })

    it('refuses truncated JSON', () => {
      const modelOutput = '{ "summary": "cut off'
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses empty string', () => {
      const result = validateCitedSummary('', setABC)
      expect(result.ok).toBe(false)
    })

    it('refuses JSON array instead of object', () => {
      const modelOutput = JSON.stringify([
        { summary: 'item 1', citations: [] },
      ])
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBeDefined()
      }
    })

    it('refuses JSON null', () => {
      const modelOutput = 'null'
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses JSON string instead of object', () => {
      const modelOutput = '"just a string"'
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses JSON number', () => {
      const modelOutput = '42'
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })
  })

  describe('missing keys — refused', () => {
    it('refuses when summary key is missing', () => {
      const modelOutput = JSON.stringify({
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('summary')
      }
    })

    it('refuses when citations key is missing', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary without citations field.',
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('citations')
      }
    })

    it('refuses when both keys are missing', () => {
      const modelOutput = JSON.stringify({
        other_field: 'value',
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })
  })

  describe('wrong types for keys — refused', () => {
    it('refuses when summary is not a string', () => {
      const modelOutput = JSON.stringify({
        summary: 123,
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBeDefined()
      }
    })

    it('refuses when summary is null', () => {
      const modelOutput = JSON.stringify({
        summary: null,
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses when summary is an array', () => {
      const modelOutput = JSON.stringify({
        summary: ['item'],
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses when citations is not an array', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: { id: 'id-a' },
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('citations')
      }
    })

    it('refuses when citations is a string (not an array)', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: 'id-a, id-b',
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses when citations is null', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: null,
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })
  })

  describe('non-string citation elements — refused', () => {
    it('refuses when citation is a number', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: [123],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBeDefined()
      }
    })

    it('refuses when citation is null', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: [null],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses when citation is a boolean', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: [true],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses when citation is an object', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: [{ id: 'id-a' }],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses when citation is an array', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: [['id-a']],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })

    it('refuses mixed types in citations array', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: ['id-a', 123, 'id-b'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('accepts empty retrieved set when summary and citations are both empty', () => {
      const emptySet = new Set<string>()
      const modelOutput = JSON.stringify({
        summary: '',
        citations: [],
      })
      const result = validateCitedSummary(modelOutput, emptySet)

      expect(result.ok).toBe(true)
    })

    it('refuses citation against empty retrieved set', () => {
      const emptySet = new Set<string>()
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, emptySet)

      expect(result.ok).toBe(false)
    })

    it('accepts extra keys in JSON object (ignores them)', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: ['id-a'],
        extra_field: 'should be ignored',
        another_field: 42,
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe('Summary.')
        expect(result.citations).toEqual(['id-a'])
      }
    })

    it('handles very long summary text', () => {
      const longSummary = 'A'.repeat(100000)
      const modelOutput = JSON.stringify({
        summary: longSummary,
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe(longSummary)
      }
    })

    it('handles many citations', () => {
      const largeSet = new Set(
        Array.from({ length: 1000 }, (_, i) => `id-${i}`)
      )
      const citations = Array.from(largeSet).slice(0, 500)
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations,
      })
      const result = validateCitedSummary(modelOutput, largeSet)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.citations.length).toBe(500)
      }
    })

    it('treats duplicate citations as valid (no deduplication required)', () => {
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: ['id-a', 'id-a', 'id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        // Duplicates are kept as-is; no deduplication is performed.
        expect(result.citations).toEqual(['id-a', 'id-a', 'id-a'])
      }
    })

    it('accepts unicode in summary text', () => {
      const modelOutput = JSON.stringify({
        summary: 'مرحبا بالعالم 你好世界 🌍',
        citations: ['id-a'],
      })
      const result = validateCitedSummary(modelOutput, setABC)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toContain('مرحبا')
        expect(result.summary).toContain('你好')
        expect(result.summary).toContain('🌍')
      }
    })

    it('accepts numeric-looking strings as citation IDs', () => {
      const numericSet = new Set(['123', '456', '789'])
      const modelOutput = JSON.stringify({
        summary: 'Summary.',
        citations: ['123', '456'],
      })
      const result = validateCitedSummary(modelOutput, numericSet)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.citations).toEqual(['123', '456'])
      }
    })
  })
})
