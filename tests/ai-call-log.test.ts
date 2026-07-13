/**
 * T4.4: RLS policy enforcement tests for ai_call_log table.
 *
 * Tests the actual INSERT and SELECT policies:
 * - INSERT: authenticated users can only insert rows with their own user_id
 * - SELECT admin: admins can SELECT any row
 * - SELECT non-admin: non-admins cannot SELECT any row, even their own (no-SELECT-own asymmetry)
 *
 * Unlike query-action.test.ts, this test DOES set SET LOCAL role authenticated
 * and SET LOCAL request.jwt.claims before each insert, so it actually exercises
 * the real RLS policies instead of bypassing them via superuser.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

/**
 * Test double for Supabase client that respects RLS by setting proper
 * authenticated context before each operation.
 */
class AuthenticatedTestSupabaseClient {
  constructor(private pgClient: pg.Client, private userId: string, private clerkId: string) {}

  /**
   * Insert a row into ai_call_log with authenticated context.
   * Sets SET LOCAL role authenticated and jwt.claims before insert.
   */
  async insertAiCallLog(row: {
    user_id: string
    function: string
    query: string
    model_name: string
    prompt: string
    response: string
    citations_valid: boolean | null
    latency_ms?: number | null
    tokens_in?: number | null
    tokens_out?: number | null
    retrieved_ids?: string[]
  }): Promise<{ data: null; error: null } | { data: null; error: string }> {
    try {
      await this.pgClient.query('BEGIN')
      try {
        // Set authenticated role and JWT claims for this transaction
        await this.pgClient.query('SET LOCAL role authenticated')

        const jwtClaimsEscaped = JSON.stringify({ sub: this.clerkId }).replace(/'/g, "''")
        await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

        // Debug: verify what current_app_user() sees
        const debugCheck = await this.pgClient.query(
          `SELECT auth.jwt()->>'sub' as jwt_sub, current_app_user() as caller_id`
        )
        console.log(`[debug insertAiCallLog] JWT check: jwt_sub=${debugCheck.rows[0]?.jwt_sub}, caller_id=${debugCheck.rows[0]?.caller_id}, trying to insert user_id=${row.user_id}`)

        // Now try to insert — RLS policy will check if user_id = current_app_user()
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
            row.latency_ms ?? null,
            row.tokens_in ?? null,
            row.tokens_out ?? null,
            JSON.stringify(row.retrieved_ids ?? []),
          ]
        )

        await this.pgClient.query('COMMIT')
        return { data: null, error: null }
      } catch (err) {
        await this.pgClient.query('ROLLBACK').catch(() => {})
        throw err
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      return { data: null, error }
    }
  }

  /**
   * Select from ai_call_log with authenticated context.
   * Sets SET LOCAL role authenticated and jwt.claims before select.
   */
  async selectAiCallLog(whereClause: string): Promise<{ data: unknown[]; error: null } | { data: null; error: string }> {
    try {
      await this.pgClient.query('BEGIN')
      try {
        await this.pgClient.query('SET LOCAL role authenticated')

        const jwtClaimsEscaped = JSON.stringify({ sub: this.clerkId }).replace(/'/g, "''")
        await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

        const result = await this.pgClient.query(`SELECT * FROM ai_call_log WHERE ${whereClause}`)

        await this.pgClient.query('COMMIT')
        return { data: result.rows, error: null }
      } catch (err) {
        await this.pgClient.query('ROLLBACK').catch(() => {})
        throw err
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      return { data: null, error }
    }
  }
}

/**
 * Admin-context client that can SELECT any row via is_admin() RLS policy.
 */
class AdminTestSupabaseClient {
  constructor(private pgClient: pg.Client, private userId: string, private clerkId: string) {}

  async selectAiCallLog(whereClause: string): Promise<{ data: unknown[]; error: null } | { data: null; error: string }> {
    try {
      await this.pgClient.query('BEGIN')
      try {
        await this.pgClient.query('SET LOCAL role authenticated')

        const jwtClaimsEscaped = JSON.stringify({ sub: this.clerkId }).replace(/'/g, "''")
        await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

        // Debug: verify admin status
        const debugCheck = await this.pgClient.query(
          `SELECT auth.jwt()->>'sub' as jwt_sub, current_app_user() as caller_id, is_admin() as is_admin`
        )
        console.log(`[debug admin selectAiCallLog] JWT check: jwt_sub=${debugCheck.rows[0]?.jwt_sub}, caller_id=${debugCheck.rows[0]?.caller_id}, is_admin=${debugCheck.rows[0]?.is_admin}`)

        const result = await this.pgClient.query(`SELECT * FROM ai_call_log WHERE ${whereClause}`)

        await this.pgClient.query('COMMIT')
        return { data: result.rows, error: null }
      } catch (err) {
        await this.pgClient.query('ROLLBACK').catch(() => {})
        throw err
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error'
      return { data: null, error }
    }
  }
}

describe('ai_call_log RLS policies', () => {
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

    // Verify fixture users exist
    const consultantACheck = await dbClient.query(
      `SELECT id, clerk_id FROM users WHERE id = $1`,
      [FIXTURE.users.consultantA]
    )
    if (consultantACheck.rows.length > 0) {
      console.log(`[test-setup] consultantA found: ${consultantACheck.rows[0].clerk_id}`)
    } else {
      console.log(`[test-setup] consultantA NOT found: ${FIXTURE.users.consultantA}`)
    }

    const foremanB1aCheck = await dbClient.query(
      `SELECT id, clerk_id FROM users WHERE id = $1`,
      [FIXTURE.users.foremanB1a]
    )
    if (foremanB1aCheck.rows.length > 0) {
      console.log(`[test-setup] foremanB1a found: ${foremanB1aCheck.rows[0].clerk_id}`)
    } else {
      console.log(`[test-setup] foremanB1a NOT found: ${FIXTURE.users.foremanB1a}`)
    }

    const adminCheck = await dbClient.query(
      `SELECT id, clerk_id FROM users WHERE id = $1`,
      [FIXTURE.users.admin]
    )
    if (adminCheck.rows.length > 0) {
      console.log(`[test-setup] admin found: ${adminCheck.rows[0].clerk_id}`)
    } else {
      console.log(`[test-setup] admin NOT found: ${FIXTURE.users.admin}`)
    }

    // Clean up ai_call_log for tests (delete rows from this test run)
    await dbClient.query(`DELETE FROM ai_call_log WHERE user_id IN ($1, $2, $3)`, [
      FIXTURE.users.consultantA,
      FIXTURE.users.foremanB1a,
      FIXTURE.users.admin,
    ])
  })

  afterAll(async () => {
    if (dbClient) {
      // Cleanup
      await dbClient.query(`DELETE FROM ai_call_log WHERE user_id IN ($1, $2, $3)`, [
        FIXTURE.users.consultantA,
        FIXTURE.users.foremanB1a,
        FIXTURE.users.admin,
      ])
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  describe('INSERT policy', () => {
    skipIfNoLocalStack(
      '(a) authenticated user can insert their own ai_call_log row',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        const client = new AuthenticatedTestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        const { error } = await client.insertAiCallLog({
          user_id: FIXTURE.users.consultantA,
          function: 'cross_team_query',
          query: 'test query (a)',
          model_name: 'gpt-4-turbo',
          prompt: 'test prompt',
          response: 'test response',
          citations_valid: true,
        })

        expect(error).toBeNull()

        // Verify the row was actually written by querying as postgres
        const result = await dbClient.query(
          `SELECT user_id FROM ai_call_log WHERE user_id = $1 AND query = $2`,
          [FIXTURE.users.consultantA, 'test query (a)']
        )
        expect(result.rows.length).toBe(1)
        console.log('[case a] ✓ authenticated user can insert their own row')
      },
      30000
    )

    skipIfNoLocalStack(
      '(b) authenticated user CANNOT insert a row claiming to be someone else',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        const client = new AuthenticatedTestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        const { error } = await client.insertAiCallLog({
          user_id: FIXTURE.users.foremanB1a, // Different user!
          function: 'cross_team_query',
          query: 'test query (b)',
          model_name: 'gpt-4-turbo',
          prompt: 'test prompt',
          response: 'test response',
          citations_valid: true,
        })

        // The RLS policy should reject this — we expect an error or the row not to be written
        if (error) {
          console.log(`[case b] ✓ RLS rejected insert: ${error}`)
          expect(error).toBeTruthy()
        } else {
          // If no error is returned by our client wrapper (silent RLS filtering),
          // verify the row was NOT actually written to the database
          const result = await dbClient.query(
            `SELECT user_id FROM ai_call_log WHERE user_id = $1 AND query = $2`,
            [FIXTURE.users.foremanB1a, 'test query (b)']
          )
          expect(result.rows.length).toBe(0)
          console.log(`[case b] ✓ RLS silently rejected insert (row not found in DB)`)
        }
      },
      30000
    )
  })

  describe('SELECT policy', () => {
    skipIfNoLocalStack(
      '(c) non-admin cannot SELECT even their own row (no-SELECT-own asymmetry)',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // First insert consultantA's own row as postgres (to guarantee it exists)
        await dbClient.query(
          `INSERT INTO ai_call_log (
            user_id, function, query, model_name, prompt, response, citations_valid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            FIXTURE.users.consultantA,
            'cross_team_query',
            'test query (c)',
            'gpt-4-turbo',
            'test prompt',
            'test response',
            true,
          ]
        )

        // Now try to SELECT it as consultantA (authenticated)
        const client = new AuthenticatedTestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')
        const { data, error } = await client.selectAiCallLog(`user_id = '${FIXTURE.users.consultantA}'`)

        expect(error).toBeNull()
        expect(data).toBeDefined()

        if (Array.isArray(data)) {
          // RLS policy silently filters — should return 0 rows, not an error
          const ownRows = (data as any[]).filter((r) => r.query === 'test query (c)')
          expect(ownRows.length).toBe(0)
          console.log('[case c] ✓ non-admin cannot SELECT even their own row (0 rows returned)')
        }
      },
      30000
    )

    skipIfNoLocalStack(
      '(d) admin can SELECT any user\'s row',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // Insert consultantA's row as postgres (to guarantee it exists)
        await dbClient.query(
          `INSERT INTO ai_call_log (
            user_id, function, query, model_name, prompt, response, citations_valid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            FIXTURE.users.consultantA,
            'cross_team_query',
            'test query (d)',
            'gpt-4-turbo',
            'test prompt',
            'test response',
            true,
          ]
        )

        // Admin should be able to select it
        const client = new AdminTestSupabaseClient(dbClient, FIXTURE.users.admin, 'fixture_admin_fixture')
        const { data, error } = await client.selectAiCallLog(`user_id = '${FIXTURE.users.consultantA}'`)

        expect(error).toBeNull()
        expect(data).toBeDefined()

        if (Array.isArray(data)) {
          const foundRows = (data as any[]).filter((r) => r.query === 'test query (d)')
          expect(foundRows.length).toBe(1)
          console.log('[case d] ✓ admin can SELECT any user\'s row (1 row returned)')
        }
      },
      30000
    )
  })
})
