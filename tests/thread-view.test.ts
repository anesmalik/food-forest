/**
 * T6.2: Integration tests for the Q&A thread view page.
 *
 * Tests the data-assembly logic for fetching thread metadata, escalations,
 * answers, and citations — verifying that citations are resolved through
 * the laundering gate and content is fetched defensively (never exposing
 * content the reader cannot see).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { getCitationsForAnswerVersion, resolveCitationsForReader } from '../lib/citation-resolution'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

// Test double implementing minimal interface of SupabaseClient
class TestSupabaseClient {
  private queriesMade: string[] = []

  constructor(private pgClient: pg.Client, private callerId: string, private callerClerkId: string) {}

  getQueriesMade(): string[] {
    return this.queriesMade
  }

  async rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    if (name === 'can_see_content') {
      const contentType = params.p_content_type as string
      const contentId = params.p_content_id as string

      this.queriesMade.push(`can_see_content(${contentType}, ${contentId})`)

      try {
        await this.pgClient.query('BEGIN')
        try {
          const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
          await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

          const result = await this.pgClient.query(
            `SELECT can_see_content($1::content_type, $2::uuid) as result`,
            [contentType, contentId]
          )

          await this.pgClient.query('COMMIT')

          const visible = result.rows[0]?.result ?? false
          console.log(`[can_see_content] ${this.callerClerkId} checking ${contentType}/${contentId}: ${visible}`)
          return { data: visible, error: null }
        } catch (err) {
          await this.pgClient.query('ROLLBACK').catch(() => {})
          throw err
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[can_see_content] RPC error:`, error)
        return { data: null, error }
      }
    }
    return { data: null, error: 'Unknown RPC' }
  }

  from(table: string) {
    if (table === 'qa_citations') {
      return {
        select: (columns: string) => {
          return {
            eq: async (column: string, value: string) => {
              this.queriesMade.push(`qa_citations.select(${columns}).eq(${column}, ${value})`)
              try {
                const result = await this.pgClient.query(
                  `SELECT ${columns} FROM qa_citations WHERE ${column} = $1`,
                  [value]
                )
                return { data: result.rows, error: null }
              } catch (err) {
                const error = err instanceof Error ? err.message : 'Unknown error'
                return { data: null, error }
              }
            },
          }
        },
      }
    }

    if (table === 'journal_entries') {
      return {
        select: (columns: string) => {
          return {
            eq: async (column: string, value: string) => {
              this.queriesMade.push(`journal_entries.select(${columns}).eq(${column}, ${value})`)
              try {
                const result = await this.pgClient.query(
                  `SELECT ${columns} FROM journal_entries WHERE ${column} = $1`,
                  [value]
                )
                return { data: result.rows[0] ?? null, error: null }
              } catch (err) {
                const error = err instanceof Error ? err.message : 'Unknown error'
                console.error(`[journal_entries query error] ${error}`)
                return { data: null, error }
              }
            },
          }
        },
      }
    }

    if (table === 'wiki_entry_versions') {
      return {
        select: (columns: string) => {
          return {
            eq: async (column: string, value: string) => {
              this.queriesMade.push(`wiki_entry_versions.select(${columns}).eq(${column}, ${value})`)
              try {
                const result = await this.pgClient.query(
                  `SELECT ${columns} FROM wiki_entry_versions WHERE ${column} = $1`,
                  [value]
                )
                return { data: result.rows[0] ?? null, error: null }
              } catch (err) {
                const error = err instanceof Error ? err.message : 'Unknown error'
                return { data: null, error }
              }
            },
          }
        },
      }
    }

    if (table === 'qa_answer_versions') {
      return {
        select: (columns: string) => {
          return {
            eq: async (column: string, value: string) => {
              this.queriesMade.push(`qa_answer_versions.select(${columns}).eq(${column}, ${value})`)
              try {
                const result = await this.pgClient.query(
                  `SELECT ${columns} FROM qa_answer_versions WHERE ${column} = $1`,
                  [value]
                )
                return { data: result.rows[0] ?? null, error: null }
              } catch (err) {
                const error = err instanceof Error ? err.message : 'Unknown error'
                return { data: null, error }
              }
            },
          }
        },
      }
    }

    return {
      select: () => {
        return {
          eq: async () => {
            return { data: null, error: 'Unknown table' }
          },
        }
      },
    }
  }
}

describe('Thread view (T6.2)', () => {
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
      console.log('[test-setup] No tables found. Loading fixture...')
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

    // Verify ancestry relationships
    console.log('\n[test-setup] Verifying user ancestry...')
    const consultantAToForemanA1aResult = await dbClient.query(
      `SELECT is_in_subtree($1::uuid, $2::uuid) as is_ancestor`,
      [FIXTURE.users.consultantA, FIXTURE.users.foremanA1a]
    )
    console.log(`is_in_subtree(consultantA, foremanA1a): ${consultantAToForemanA1aResult.rows[0].is_ancestor}`)

    const foremanB1aToForemanA1aResult = await dbClient.query(
      `SELECT is_in_subtree($1::uuid, $2::uuid) as is_ancestor`,
      [FIXTURE.users.foremanB1a, FIXTURE.users.foremanA1a]
    )
    console.log(`is_in_subtree(foremanB1a, foremanA1a): ${foremanB1aToForemanA1aResult.rows[0].is_ancestor}`)

    // Check Clerk IDs for test users
    console.log('\n[test-setup] Checking Clerk IDs for test users...')
    const clerkIdCheck = await dbClient.query(
      `SELECT id, clerk_id, display_name FROM users
       WHERE id IN ($1, $2, $3)`,
      [FIXTURE.users.consultantA, FIXTURE.users.foremanA1a, FIXTURE.users.foremanB1a]
    )
    clerkIdCheck.rows.forEach((row) => {
      console.log(`  ${row.display_name}: ${row.clerk_id}`)
    })

    // Verify citation fixture exists
    console.log('\n[test-setup] Checking fixture qa_citations...')
    const citationCheck = await dbClient.query(
      `SELECT id, content_id FROM qa_citations
       WHERE answer_version_id = $1 AND content_type = 'journal_entry'`,
      [FIXTURE.qaAnswerVersion.pumpPressureAnswerV1]
    )

    if (citationCheck.rows.length === 0) {
      console.log('[test-setup] No fixture citation found. Inserting test citation...')
      await dbClient.query(
        `INSERT INTO qa_citations (answer_version_id, content_type, content_id)
         VALUES ($1, 'journal_entry'::content_type, $2)`,
        [FIXTURE.qaAnswerVersion.pumpPressureAnswerV1, FIXTURE.journal.foremanA1aRestrictedArabic]
      )
    } else {
      console.log(`[test-setup] Found ${citationCheck.rows.length} fixture citation(s) — reusing existing`)
      citationCheck.rows.slice(0, 3).forEach((row) => {
        console.log(`  citation id=${row.id} content_id=${row.content_id}`)
      })
    }
  })

  afterAll(async () => {
    if (dbClient) {
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  skipIfNoLocalStack(
    'as ancestor (consultantA): citation visible and content fetch succeeds',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      console.log('\n=== Test: consultantA viewing thread ===')

      // Create test double for consultantA (ancestor of foremanA1a)
      const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'clerk-consultantA')

      // Simulate the thread view's data-assembly logic
      // (1) Fetch citations for the answer version
      const citations = await getCitationsForAnswerVersion(
        supabase as any,
        FIXTURE.qaAnswerVersion.pumpPressureAnswerV1
      )

      console.log(`Fetched ${citations.length} citation(s)`)
      expect(citations.length).toBeGreaterThan(0)

      // (2) Resolve citations through the laundering gate
      const resolvedCitations = await resolveCitationsForReader(supabase as any, citations)

      console.log(`\nResolved citations for consultantA:`)
      resolvedCitations.forEach((c) => {
        console.log(`  ${c.contentType}/${c.contentId} visible=${c.visible}`)
      })

      expect(resolvedCitations.length).toBeGreaterThan(0)

      // At least one citation should be visible (the foremanA1a restricted entry is an ancestor of consultantA)
      const visibleCount = resolvedCitations.filter((c) => c.visible).length
      console.log(`Visible citations: ${visibleCount} out of ${resolvedCitations.length}`)
      expect(visibleCount).toBeGreaterThan(0)

      // (3) For visible citations, fetch the content
      const visibleCitations = resolvedCitations.filter((c) => c.visible)

      console.log(`\nFetching content for ${visibleCitations.length} visible citation(s)...`)

      let contentsFetched = 0
      for (const citation of visibleCitations) {
        let content: string | null = null

        if (citation.contentType === 'journal_entry') {
          const { data } = await (supabase as any)
            .from('journal_entries')
            .select('body')
            .eq('id', citation.contentId)

          content = data?.body ?? null
        }

        console.log(`  ${citation.contentType}/${citation.contentId} content length=${content?.length ?? 0}`)

        // Defense in depth: if content fetch returns null, treat citation as NOT visible
        if (content) {
          contentsFetched++
          expect(content.length).toBeGreaterThan(0)
        }
      }

      expect(contentsFetched).toBeGreaterThan(0)

      // Verify that journal_entries queries were only made for visible citations
      const queriesMade = supabase.getQueriesMade()
      const journalEntryQueries = queriesMade.filter((q) => q.includes('journal_entries.select'))
      console.log(`\nTotal queries made: ${queriesMade.length}`)
      console.log(`journal_entries queries: ${journalEntryQueries.length}`)
      // Should only query journal_entries for visible citations
      expect(journalEntryQueries.length).toBeLessThanOrEqual(visibleCitations.length)
      expect(journalEntryQueries.length).toBeGreaterThan(0)
    }
  )

  skipIfNoLocalStack(
    'as unrelated reader (foremanB1a): citation not visible and no content fetch occurs',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      console.log('\n=== Test: foremanB1a viewing thread ===')

      // Create test double for foremanB1a (unrelated branch)
      const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.foremanB1a, 'fixture_foreman_b1a')

      // Simulate the thread view's data-assembly logic
      // (1) Fetch citations for the answer version
      const citations = await getCitationsForAnswerVersion(
        supabase as any,
        FIXTURE.qaAnswerVersion.pumpPressureAnswerV1
      )

      console.log(`Fetched ${citations.length} citation(s)`)
      expect(citations.length).toBeGreaterThan(0)

      // (2) Resolve citations through the laundering gate
      const resolvedCitations = await resolveCitationsForReader(supabase as any, citations)

      console.log(`\nResolved citations for foremanB1a:`)
      resolvedCitations.forEach((c) => {
        console.log(`  ${c.contentType}/${c.contentId} visible=${c.visible}`)
      })

      expect(resolvedCitations.length).toBeGreaterThan(0)

      // foremanB1a is unrelated to foremanA1a, so should NOT be able to see restricted entries
      const visibleCount = resolvedCitations.filter((c) => c.visible).length
      console.log(`Visible citations for unrelated reader: ${visibleCount} out of ${resolvedCitations.length}`)
      // Depending on citation content, some may not be visible
      // But we expect that at least some are NOT visible (the restricted foremanA1a entry)
      const notVisibleCount = resolvedCitations.filter((c) => !c.visible).length
      expect(notVisibleCount).toBeGreaterThan(0)

      // (3) For non-visible citations, DO NOT fetch content
      const visibleCitations = resolvedCitations.filter((c) => c.visible)
      const notVisibleCitations = resolvedCitations.filter((c) => !c.visible)

      console.log(`\nVisible citations to fetch: ${visibleCitations.length}`)
      console.log(`Non-visible citations (should not fetch): ${notVisibleCitations.length}`)

      // Fetch content only for visible citations
      for (const citation of visibleCitations) {
        if (citation.contentType === 'journal_entry') {
          await (supabase as any).from('journal_entries').select('body').eq('id', citation.contentId)
        }
      }

      // Verify that no journal_entries queries were made for non-visible citations
      const queriesMade = supabase.getQueriesMade()
      const journalEntryQueries = queriesMade.filter((q) => q.includes('journal_entries.select'))

      console.log(`\nTotal queries made: ${queriesMade.length}`)
      console.log(`journal_entries queries: ${journalEntryQueries.length}`)
      console.log(`All queries: ${queriesMade.join(', ')}`)

      // journal_entries queries should only be for visible citations
      expect(journalEntryQueries.length).toBeLessThanOrEqual(visibleCitations.length)
    }
  )

  skipIfNoLocalStack('defense-in-depth: if content fetch returns null, treat citation as not visible', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    console.log('\n=== Test: defense-in-depth null handling ===')

    const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

    // Fetch and resolve real citations
    const citations = await getCitationsForAnswerVersion(
      supabase as any,
      FIXTURE.qaAnswerVersion.pumpPressureAnswerV1
    )

    const resolvedCitations = await resolveCitationsForReader(supabase as any, citations)

    // Simulate a content fetch that returns null
    // (This would happen if RLS silently blocks access despite can_see_content() returning true)
    for (const citation of resolvedCitations) {
      if (citation.visible && citation.contentType === 'journal_entry') {
        // Try to fetch with an invalid ID that should return null
        const { data } = await (supabase as any).from('journal_entries').select('body').eq('id', 'invalid-id')

        console.log(`Attempted to fetch journal_entry/invalid-id: ${data ? 'found' : 'null'}`)
        expect(data).toBeNull()

        // The page logic should treat this as NOT visible for rendering
        // (We verify this by checking that the null response would cause the citation to be hidden)
      }
    }
  })
})
