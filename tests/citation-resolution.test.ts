/**
 * T4.3: Integration tests for citation resolution and the laundering gate.
 *
 * Tests getCitationsForAnswerVersion and resolveCitationsForReader against
 * the real local Supabase instance. The laundering gate validates that readers
 * can only see citations they have permission to access through can_see_content.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { getCitationsForAnswerVersion, resolveCitationsForReader, type Citation } from '../lib/citation-resolution'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

// Test double implementing minimal interface of SupabaseClient
// Backed by real pg.Client with SET LOCAL for RLS context
class TestSupabaseClient {
  constructor(private pgClient: pg.Client, private callerId: string, private callerClerkId: string) {}

  async rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    if (name === 'can_see_content') {
      const contentType = params.p_content_type as string
      const contentId = params.p_content_id as string

      try {
        // Execute can_see_content RPC with RLS context via SET LOCAL
        await this.pgClient.query('BEGIN')
        try {
          const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")

          // Set LOCAL statement - must be before the function call
          // can_see_content is security_definer so runs with owner privileges
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

describe('Citation resolution (T4.3)', () => {
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

    // Verify ancestry: consultantA → site_manager_a1 → foremanA1a
    console.log('\n[test-setup] Verifying user ancestry...')
    const ancestryCheck = await dbClient.query(
      `SELECT is_in_subtree($1::uuid, $2::uuid) as is_ancestor`,
      [FIXTURE.users.consultantA, FIXTURE.users.foremanA1a]
    )
    console.log(`is_in_subtree(consultantA, foremanA1a): ${ancestryCheck.rows[0].is_ancestor}`)
    expect(ancestryCheck.rows[0].is_ancestor).toBe(true)
  })

  afterAll(async () => {
    if (dbClient) {
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  skipIfNoLocalStack(
    'setup: insert test citation as service role (bypassing RLS)',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      // Insert one row into qa_citations as postgres/service role
      // This bypasses RLS since no INSERT policy exists yet
      const insertResult = await dbClient.query(
        `INSERT INTO qa_citations (answer_version_id, content_type, content_id)
         VALUES ($1, $2::content_type, $3)
         RETURNING id`,
        [FIXTURE.qaAnswerVersion.pumpPressureAnswerV1, 'journal_entry', FIXTURE.journal.foremanA1aRestrictedArabic]
      )

      console.log(`\nInserted citation:`)
      console.log(`  answer_version_id: ${FIXTURE.qaAnswerVersion.pumpPressureAnswerV1}`)
      console.log(`  content_type: journal_entry`)
      console.log(`  content_id: ${FIXTURE.journal.foremanA1aRestrictedArabic}`)
      console.log(`  id: ${insertResult.rows[0].id}`)

      expect(insertResult.rows).toHaveLength(1)
    }
  )

  skipIfNoLocalStack(
    'reader who can see the cited entry gets a working link',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      // Create test double for consultantA (an ancestor of foremanA1a)
      const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

      // Fetch citations from database (don't hand-construct)
      const citations = await getCitationsForAnswerVersion(supabase as any, FIXTURE.qaAnswerVersion.pumpPressureAnswerV1)

      console.log(`\nFetched ${citations.length} citation(s)`)
      for (const citation of citations) {
        console.log(`  ${citation.contentType}/${citation.contentId}`)
      }

      expect(citations).toHaveLength(1)
      expect(citations[0].contentType).toBe('journal_entry')
      expect(citations[0].contentId).toBe(FIXTURE.journal.foremanA1aRestrictedArabic)

      // Now resolve through the laundering gate
      const resolved = await resolveCitationsForReader(supabase as any, citations)

      console.log(`\nResolved citations for consultantA:`)
      for (const r of resolved) {
        console.log(`  ${r.contentType}/${r.contentId} visible=${r.visible}`)
      }

      expect(resolved).toHaveLength(1)
      expect(resolved[0].visible).toBe(true)
    }
  )

  skipIfNoLocalStack(
    'reader who cannot see the cited entry gets no link',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      // Create test double for foremanB1a (unrelated branch, not an ancestor)
      const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.foremanB1a, 'fixture_foreman_b1a')

      // Fetch the same citations from database
      const citations = await getCitationsForAnswerVersion(supabase as any, FIXTURE.qaAnswerVersion.pumpPressureAnswerV1)

      console.log(`\nFetched ${citations.length} citation(s) as foremanB1a`)
      for (const citation of citations) {
        console.log(`  ${citation.contentType}/${citation.contentId}`)
      }

      expect(citations).toHaveLength(1)

      // Now resolve through the laundering gate
      const resolved = await resolveCitationsForReader(supabase as any, citations)

      console.log(`\nResolved citations for foremanB1a:`)
      for (const r of resolved) {
        console.log(`  ${r.contentType}/${r.contentId} visible=${r.visible}`)
      }

      expect(resolved).toHaveLength(1)
      expect(resolved[0].visible).toBe(false)
    }
  )

  skipIfNoLocalStack(
    'resolveCitationsForReader handles nonexistent content gracefully',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      // Create test double for consultantA
      const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

      // Manually construct a citation with a content_id that doesn't exist
      const nonexistentCitation: Citation = {
        contentType: 'journal_entry',
        contentId: '99999999-9999-9999-9999-999999999999',
      }

      console.log(`\nResolving nonexistent citation:`)
      console.log(`  ${nonexistentCitation.contentType}/${nonexistentCitation.contentId}`)

      // Should not throw, should resolve to visible: false
      const resolved = await resolveCitationsForReader(supabase as any, [nonexistentCitation])

      console.log(`\nResolved result:`)
      console.log(`  visible=${resolved[0].visible}`)

      expect(resolved).toHaveLength(1)
      expect(resolved[0].visible).toBe(false)
    }
  )
})
