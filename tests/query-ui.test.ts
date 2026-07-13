/**
 * T6.1 — Query Interface Tests
 *
 * Tests submitQueryCore with:
 * 1. Real fixture users (foremanA2a calling, siteManagerA2 as escalation target)
 * 2. Real qa_escalations record created via escalate_refused_question
 * 3. Real usage_events rows created as side effects of calling submitQueryCore
 * 4. Escalation-name lookup verified against actual stored display_name
 *
 * Uses TestSupabaseClient + SET LOCAL request.jwt.claims pattern for RLS context.
 * Tests run against a real Supabase instance (local or remote).
 * Configure via env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 *
 * Run: npx vitest run tests/query-ui.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { submitQueryCore, type QueryUIResult } from '../lib/actions/query-ui'
import { getCrossTeamQueryCore, type CompletionGenerator } from '../lib/actions/query'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

// Test double implementing minimal interface of SupabaseClient
// Backed by real pg.Client with SET LOCAL for RLS context
class TestSupabaseClient {
  constructor(private pgClient: pg.Client, private callerId: string, private callerClerkId: string) {}

  async rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    if (name === 'search_corpus') {
      // Return empty results to trigger the no_results path and escalation
      return { data: [], error: null }
    }
    if (name === 'escalate_refused_question') {
      const question = params.p_question as string
      try {
        await this.pgClient.query('BEGIN')
        try {
          const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
          await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

          const result = await this.pgClient.query(
            `SELECT escalate_refused_question($1) as thread_id`,
            [question]
          )

          await this.pgClient.query('COMMIT')
          const threadId = result.rows[0]?.thread_id
          console.log(`[escalate_refused_question] Created thread ${threadId}`)
          return { data: threadId, error: null }
        } catch (err) {
          await this.pgClient.query('ROLLBACK').catch(() => {})
          throw err
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[escalate_refused_question] error:`, error)
        return { data: null, error }
      }
    }
    return { data: null, error: 'Unknown RPC' }
  }

  from(table: string) {
    if (table === 'usage_events') {
      return {
        insert: async (row: Record<string, unknown>) => {
          try {
            await this.pgClient.query(
              `
              INSERT INTO usage_events (
                user_id, event_type, metadata
              ) VALUES ($1, $2, $3)
              `,
              [row.user_id, row.event_type, JSON.stringify(row.metadata)]
            )
            return { data: null, error: null }
          } catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error'
            return { data: null, error }
          }
        },
      }
    }
    if (table === 'qa_escalations') {
      return {
        select: (cols: string) => {
          return {
            eq: (field: string, value: unknown) => {
              return {
                order: (orderField: string, options: { ascending: boolean }) => {
                  return {
                    limit: (n: number) => {
                      return {
                        single: async () => {
                          try {
                            const result = await this.pgClient.query(
                              `SELECT ${cols} FROM qa_escalations WHERE ${field} = $1 ORDER BY ${orderField} ${options.ascending ? 'ASC' : 'DESC'} LIMIT $2`,
                              [value, n]
                            )
                            const row = result.rows[0]
                            if (!row) return { data: null, error: null }
                            const data = {} as Record<string, unknown>
                            cols.split(',').forEach((col) => {
                              const trimmed = col.trim()
                              data[trimmed] = row[trimmed]
                            })
                            return { data, error: null }
                          } catch (err) {
                            const error = err instanceof Error ? err.message : 'Unknown error'
                            console.error('[TestSupabaseClient] qa_escalations query error:', error)
                            return { data: null, error }
                          }
                        },
                      }
                    },
                  }
                },
              }
            },
          }
        },
      }
    }
    if (table === 'users') {
      return {
        select: (cols: string) => {
          return {
            eq: (field: string, value: unknown) => {
              return {
                single: async () => {
                  try {
                    const result = await this.pgClient.query(
                      `SELECT ${cols} FROM users WHERE ${field} = $1`,
                      [value]
                    )
                    const row = result.rows[0]
                    if (!row) return { data: null, error: null }
                    const data = {} as Record<string, unknown>
                    cols.split(',').forEach((col) => {
                      const trimmed = col.trim()
                      data[trimmed] = row[trimmed]
                    })
                    return { data, error: null }
                  } catch (err) {
                    const error = err instanceof Error ? err.message : 'Unknown error'
                    return { data: null, error }
                  }
                },
              }
            },
          }
        },
      }
    }
    return {
      insert: async () => ({ data: null, error: 'Unknown table' }),
    }
  }
}

describe('submitQueryCore — with real fixture data', () => {
  let dbClient: pg.Client
  let dbUrl: string
  let siteManagerA2DisplayName: string
  let escalationThreadId: string

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
    const embeddingCount = await dbClient.query(`SELECT COUNT(*) as count FROM embeddings`)
    console.log(`[test-setup] Current embedding count: ${embeddingCount.rows[0].count}`)

    if (parseInt(embeddingCount.rows[0].count, 10) === 0) {
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

    // Fetch siteManagerA2's actual display_name from fixture
    const siteManagerQuery = await dbClient.query(
      `SELECT display_name FROM users WHERE id = $1`,
      [FIXTURE.users.siteManagerA2]
    )
    if (siteManagerQuery.rows.length > 0) {
      siteManagerA2DisplayName = siteManagerQuery.rows[0].display_name
      console.log(`[test-setup] siteManagerA2 display_name: "${siteManagerA2DisplayName}"`)
    } else {
      throw new Error(`Fixture user siteManagerA2 not found: ${FIXTURE.users.siteManagerA2}`)
    }

    // Verify foremanA2a exists
    const foremanQuery = await dbClient.query(
      `SELECT id, display_name, supervisor_id FROM users WHERE id = $1`,
      [FIXTURE.users.foremanA2a]
    )
    if (foremanQuery.rows.length > 0) {
      console.log(`[test-setup] Fixture user found: ${foremanQuery.rows[0].display_name} (supervisor: ${foremanQuery.rows[0].supervisor_id})`)
    } else {
      throw new Error(`Fixture user foremanA2a not found: ${FIXTURE.users.foremanA2a}`)
    }
  })

  afterAll(async () => {
    if (dbClient) {
      // Clean up any escalations created during tests
      if (escalationThreadId) {
        await dbClient.query(`DELETE FROM qa_escalations WHERE thread_id = $1`, [escalationThreadId])
        await dbClient.query(`DELETE FROM qa_threads WHERE id = $1`, [escalationThreadId])
      }
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  skipIfNoLocalStack('calls submitQueryCore and creates usage_events rows', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    const beforeTime = new Date()
    const testQuestion = 'What is the current status of the south plot expansion?'

    // Create TestSupabaseClient with foremanA2a as the caller
    const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.foremanA2a, 'fixture_foreman_a2a')

    // Create a mock embedder that returns a small vector
    const mockEmbedder = async () => Array(1536).fill(0.1)

    // Create a mock generator that returns a refusal (no_results scenario)
    const mockGenerator: CompletionGenerator = async () => ({
      output: JSON.stringify({ summary: '', citations: [] }),
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
    })

    // Call submitQueryCore
    const result = await submitQueryCore(
      supabase as any,
      FIXTURE.users.foremanA2a,
      testQuestion,
      mockEmbedder,
      mockGenerator
    )

    // Capture the escalation thread ID created by the call
    escalationThreadId = result.escalatedThreadId as string

    // Verify the escalation was created and points to siteManagerA2
    const escalationCheck = await dbClient.query(
      `SELECT escalated_to FROM qa_escalations WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [escalationThreadId]
    )
    expect(escalationCheck.rows.length).toBeGreaterThan(0)
    expect(escalationCheck.rows[0].escalated_to).toBe(FIXTURE.users.siteManagerA2)

    // Verify the escalationName matches the real stored display_name
    expect(result.ok).toBe(false)
    expect(result.escalatedThreadId).toBe(escalationThreadId)
    expect(result.escalationName).toBe(siteManagerA2DisplayName)

    // Verify usage_events rows were actually created in the database
    const submittedEvents = await dbClient.query(
      `SELECT * FROM usage_events WHERE user_id = $1 AND event_type = 'query_submitted' AND created_at >= $2`,
      [FIXTURE.users.foremanA2a, beforeTime]
    )
    expect(submittedEvents.rows.length).toBeGreaterThan(0)
    expect(submittedEvents.rows[0].metadata).toEqual({
      question_length: testQuestion.length,
    })

    const refusedEvents = await dbClient.query(
      `SELECT * FROM usage_events WHERE user_id = $1 AND event_type = 'query_refused' AND created_at >= $2`,
      [FIXTURE.users.foremanA2a, beforeTime]
    )
    expect(refusedEvents.rows.length).toBeGreaterThan(0)
    expect(refusedEvents.rows[0].metadata.refusal_kind).toBe('no_results')
    expect(refusedEvents.rows[0].metadata.has_escalation).toBe(true)
  })
})
