/**
 * STEP 6: Verify openai_error does NOT escalate
 *
 * This test runs getCrossTeamQueryCore with an embedder that throws,
 * triggering an openai_error refusal. It then verifies:
 * 1. result.escalatedThreadId is undefined or null
 * 2. No qa_threads row was created for this query
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { getCrossTeamQueryCore, type CompletionGenerator } from '../lib/actions/query'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

class TestSupabaseClient {
  constructor(private pgClient: pg.Client, private callerId: string, private callerClerkId: string) {}

  async rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    if (name === 'search_corpus') {
      const queryEmbeddingStr = params.query_embedding as string
      const matchLimit = params.match_limit as number

      try {
        await this.pgClient.query('BEGIN')
        try {
          const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
          await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

          const result = await this.pgClient.query(
            `SELECT * FROM search_corpus(
              '${queryEmbeddingStr}'::vector,
              ${matchLimit}
            )`
          )

          await this.pgClient.query('COMMIT')

          const rows = result.rows || []
          console.log(`[search_corpus] Query from user ${this.callerClerkId}: returned ${rows.length} rows`)
          return { data: rows, error: null }
        } catch (err) {
          await this.pgClient.query('ROLLBACK').catch(() => {})
          throw err
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[search_corpus] Query from user ${this.callerClerkId}: error:`, error)
        return { data: null, error }
      }
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
          console.log(`[escalate_refused_question] Query from user ${this.callerClerkId}: created thread ${threadId}`)
          return { data: threadId, error: null }
        } catch (err) {
          await this.pgClient.query('ROLLBACK').catch(() => {})
          throw err
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        console.error(`[escalate_refused_question] Query from user ${this.callerClerkId}: error:`, error)
        return { data: null, error }
      }
    }
    return { data: null, error: 'Unknown RPC' }
  }

  from(table: string) {
    if (table === 'ai_call_log') {
      return {
        insert: async (rows: unknown) => {
          try {
            const row = rows as Record<string, unknown>
            await this.pgClient.query(
              `
              INSERT INTO ai_call_log (
                user_id, function, query, model_name, prompt, response,
                citations_valid, latency_ms, tokens_in, tokens_out, retrieved_ids
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              `,
              [
                row.user_id,
                row.function,
                row.query,
                row.model_name,
                row.prompt,
                row.response,
                row.citations_valid,
                row.latency_ms,
                row.tokens_in,
                row.tokens_out,
                JSON.stringify(row.retrieved_ids),
              ]
            )
            return { data: null, error: null }
          } catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error'
            return { data: null, error }
          }
        },
      }
    }
    return {
      insert: async () => {
        return { data: null, error: 'Unknown table' }
      },
    }
  }
}

describe('STEP 6: openai_error does NOT escalate', () => {
  let dbClient: pg.Client
  let dbUrl: string

  beforeAll(async () => {
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
  })

  afterAll(async () => {
    if (dbClient) {
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  skipIfNoLocalStack(
    'embedder throws → openai_error with no escalation and no qa_threads created',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.foremanA2a, 'fixture_foreman_a2a')

      const queryText = 'Test query that will trigger embedder failure for step 6'

      const result = await getCrossTeamQueryCore(
        supabase as any,
        FIXTURE.users.foremanA2a,
        queryText,
        'gpt-4-turbo',
        async () => {
          throw new Error('Simulated embedder failure')
        },
        async () => ({ output: '', tokensIn: null, tokensOut: null, latencyMs: 0 })
      )

      console.log('\n=== STEP 6 Test Result ===')
      console.log('result.ok:', result.ok)
      console.log('result.kind:', result.kind)
      console.log('result.escalatedThreadId:', result.escalatedThreadId)
      console.log('Has escalatedThreadId property:', 'escalatedThreadId' in result)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.kind).toBe('openai_error')
        expect('escalatedThreadId' in result ? result.escalatedThreadId : undefined).toBeUndefined()
      }

      // Query database to verify no qa_threads row was created
      const threadCheck = await dbClient.query(
        `SELECT count(*) as count FROM qa_threads WHERE question = $1`,
        [queryText]
      )

      console.log('\n=== QA Threads Query Result ===')
      console.log('SELECT count(*) FROM qa_threads WHERE question = ?')
      console.log('Result:', threadCheck.rows[0])

      expect(threadCheck.rows[0].count).toBe('0')
    },
    30000
  )
})
