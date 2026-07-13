/**
 * T6.2: Defense-in-depth downgrade test.
 *
 * Verifies that resolveCitationWithContent downgrades a citation from
 * visible: true to visible: false when the content fetch returns null,
 * even though can_see_content() claimed visibility.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { resolveCitationWithContent, type CitationWithContent } from '../lib/citation-content'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

// Test double that can mock specific query results
class MockSupabaseClient {
  constructor(private pgClient: pg.Client, private mockNullFor?: string) {}

  async rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    return { data: null, error: 'Unknown RPC' }
  }

  from(table: string) {
    if (table === 'journal_entries') {
      return {
        select: (columns: string) => ({
          eq: (column: string, value: string) => ({
            single: async () => {
              // Mock: return null for specific content_id, otherwise fetch real data
              if (this.mockNullFor === value) {
                console.log(`[mock] journal_entries.select().eq('id', '${value}').single() → null (mocked)`)
                return { data: null, error: null }
              }

              try {
                const result = await this.pgClient.query(
                  `SELECT ${columns} FROM journal_entries WHERE ${column} = $1`,
                  [value]
                )
                return { data: result.rows[0] ?? null, error: null }
              } catch (err) {
                const error = err instanceof Error ? err.message : 'Unknown error'
                return { data: null, error }
              }
            },
          }),
        }),
      }
    }

    return {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: 'Unknown table' }),
        }),
      }),
    }
  }
}

describe('Citation content downgrade (T6.2 defense-in-depth)', () => {
  let dbClient: pg.Client
  let dbUrl: string

  beforeAll(async () => {
    // Resolve local Supabase connection
    if (process.env.DATABASE_URL) {
      dbUrl = process.env.DATABASE_URL
    } else {
      try {
        const { execSync } = await import('child_process')
        const output = execSync('supabase status -o json', { encoding: 'utf-8' })
        const jsonStart = output.indexOf('{')
        if (jsonStart === -1) throw new Error('No JSON in supabase status')
        const json = JSON.parse(output.substring(jsonStart))
        dbUrl = json.DB_URL
      } catch {
        console.warn('Could not resolve local Supabase connection. Skipping integration test.')
        return
      }
    }

    dbClient = new Client({ connectionString: dbUrl })
    await dbClient.connect()

    // Load fixture if not already loaded
    const tableCheck = await dbClient.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'users'
      ) as exists
    `)

    if (!tableCheck.rows[0].exists) {
      console.log('[test-setup] Loading fixture...')
      try {
        const { truncateTables, loadFixture, reindexEmbeddingsIndex } = await import('../scripts/fixtures/seed-local')
        const path = await import('path')
        await truncateTables(dbClient)
        const fixturePath = path.join(__dirname, '..', 'scripts', 'fixtures', 'output', 'stage-three-fixture.sql')
        await loadFixture(dbClient, fixturePath)
        await reindexEmbeddingsIndex(dbClient)
      } catch (err) {
        console.warn('Could not load fixture:', err instanceof Error ? err.message : 'Unknown error')
      }
    }

    // Verify the test content exists
    const contentCheck = await dbClient.query(
      `SELECT id, body FROM journal_entries WHERE id = $1`,
      [FIXTURE.journal.foremanA1aRestrictedArabic]
    )
    console.log(
      `[test-setup] Fixture journal entry ${FIXTURE.journal.foremanA1aRestrictedArabic} exists: ${contentCheck.rows.length > 0}`
    )
  })

  afterAll(async () => {
    if (dbClient) {
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  skipIfNoLocalStack(
    'downgrade: visible: true becomes visible: false when content fetch returns null',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      console.log(
        '\n=== Test: Defense-in-depth downgrade (content fetch returns null despite can_see_content: true) ==='
      )

      // Construct a citation that LOOKS like it resolved to visible: true
      const mockResolvedCitation = {
        contentType: 'journal_entry' as const,
        contentId: FIXTURE.journal.foremanA1aRestrictedArabic,
        visible: true, // Claim it's visible (as if can_see_content returned true)
      }

      console.log('\nInput citation: visible=true')
      console.log(`  ${mockResolvedCitation.contentType}/${mockResolvedCitation.contentId}`)

      // Create a mock supabase that returns null for this specific content_id
      const mockSupabase = new MockSupabaseClient(
        dbClient,
        FIXTURE.journal.foremanA1aRestrictedArabic
      ) as any

      // Call the defense-in-depth function
      const result = await resolveCitationWithContent(mockSupabase, mockResolvedCitation)

      console.log('\nOutput citation after resolveCitationWithContent:')
      console.log(`  visible=${result.visible}`)
      console.log(`  content=${result.content ? '(present)' : '(absent)'}`)

      // The citation should be DOWNGRADED to visible: false
      expect(result.visible).toBe(false)
      expect(result.content).toBeUndefined()
      expect(result.contentType).toBe('journal_entry')
      expect(result.contentId).toBe(FIXTURE.journal.foremanA1aRestrictedArabic)
    }
  )

  skipIfNoLocalStack(
    'no downgrade: visible: true stays visible: true when content fetch succeeds',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      console.log(
        '\n=== Test: No downgrade (content fetch succeeds, so citation stays visible: true) ==='
      )

      // Construct a citation that resolved to visible: true
      const mockResolvedCitation = {
        contentType: 'journal_entry' as const,
        contentId: FIXTURE.journal.foremanA1aRestrictedArabic,
        visible: true,
      }

      console.log('\nInput citation: visible=true')
      console.log(`  ${mockResolvedCitation.contentType}/${mockResolvedCitation.contentId}`)

      // Create a mock supabase that does NOT mock-null this content_id
      // (empty string means no mocking, so real query happens)
      const mockSupabase = new MockSupabaseClient(dbClient, '') as any

      // Call the defense-in-depth function
      const result = await resolveCitationWithContent(mockSupabase, mockResolvedCitation)

      console.log('\nOutput citation after resolveCitationWithContent:')
      console.log(`  visible=${result.visible}`)
      console.log(`  content length=${result.content?.length ?? 0}`)

      // The citation should remain visible: true with content populated
      expect(result.visible).toBe(true)
      expect(result.content).toBeDefined()
      expect(result.content!.length).toBeGreaterThan(0)
      expect(result.contentType).toBe('journal_entry')
      expect(result.contentId).toBe(FIXTURE.journal.foremanA1aRestrictedArabic)
    }
  )

  skipIfNoLocalStack('already not visible citations are passed through unchanged', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    console.log('\n=== Test: Already non-visible citations pass through unchanged ===')

    // Construct a citation that already resolved to visible: false
    const mockResolvedCitation = {
      contentType: 'journal_entry' as const,
      contentId: FIXTURE.journal.foremanA1aRestrictedArabic,
      visible: false, // Already not visible
    }

    console.log('\nInput citation: visible=false')
    console.log(`  ${mockResolvedCitation.contentType}/${mockResolvedCitation.contentId}`)

    const mockSupabase = new MockSupabaseClient(dbClient) as any

    // Call the defense-in-depth function
    const result = await resolveCitationWithContent(mockSupabase, mockResolvedCitation)

    console.log('\nOutput citation:')
    console.log(`  visible=${result.visible}`)
    console.log(`  content=${result.content ? '(present)' : '(absent)'}`)

    // Non-visible citations should NOT trigger a content fetch at all
    // (verify by checking no content was fetched, even if it was available)
    expect(result.visible).toBe(false)
    expect(result.content).toBeUndefined()
  })
})
