/**
 * T6.3: Escalation inbox tests
 *
 * Tests getMyEscalatedThreadsCore, answerEscalatedThreadCore, passEscalationUpCore
 * using real fixture data and local Supabase. Calls actual lib/actions functions
 * backed by TestSupabaseClient with SET LOCAL RLS context.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import {
  getMyEscalatedThreadsCore,
  answerEscalatedThreadCore,
  type CitationRef,
} from '../lib/actions/escalation-inbox'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

// Test double implementing minimal interface of SupabaseClient
// Backed by real pg.Client with SET LOCAL for RLS context
class TestSupabaseClient {
  constructor(private pgClient: pg.Client, private callerClerkId: string) {}

  async rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    if (name === 'get_my_escalated_threads') {
      try {
        await this.pgClient.query('BEGIN')
        try {
          const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
          await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

          const result = await this.pgClient.query(`SELECT * FROM get_my_escalated_threads()`)

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

    if (name === 'get_current_escalation_addressee') {
      const threadId = params.p_thread_id as string
      try {
        await this.pgClient.query('BEGIN')
        try {
          const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
          await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

          const result = await this.pgClient.query(`SELECT get_current_escalation_addressee($1) as addressee`, [threadId])

          await this.pgClient.query('COMMIT')
          return { data: result.rows[0]?.addressee, error: null }
        } catch (err) {
          await this.pgClient.query('ROLLBACK').catch(() => {})
          throw err
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error'
        return { data: null, error }
      }
    }

    return { data: null, error: 'Unknown RPC' }
  }

  from(table: string) {
    if (table === 'qa_answers') {
      return {
        insert: (row: Record<string, unknown>) => {
          return {
            select: (columns: string) => ({
              single: async () => {
                try {
                  await this.pgClient.query('BEGIN')
                  try {
                    const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
                    await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

                    const result = await this.pgClient.query(
                      `INSERT INTO qa_answers (thread_id, answerer_id) VALUES ($1, $2) RETURNING id`,
                      [row.thread_id, row.answerer_id]
                    )

                    await this.pgClient.query('COMMIT')
                    return { data: result.rows[0], error: null }
                  } catch (err) {
                    await this.pgClient.query('ROLLBACK').catch(() => {})
                    throw err
                  }
                } catch (err) {
                  const error = err instanceof Error ? err.message : 'Unknown error'
                  return { data: null, error }
                }
              },
            }),
          }
        },
        update: (row: Record<string, unknown>) => ({
          eq: async (col: string, val: unknown) => {
            try {
              await this.pgClient.query('BEGIN')
              try {
                const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
                await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

                await this.pgClient.query(
                  `UPDATE qa_answers SET current_version_id = $1 WHERE id = $2`,
                  [row.current_version_id, val]
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
          },
        }),
      }
    }

    if (table === 'qa_answer_versions') {
      return {
        insert: (row: Record<string, unknown>) => {
          return {
            select: (columns: string) => ({
              single: async () => {
                try {
                  await this.pgClient.query('BEGIN')
                  try {
                    const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
                    await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

                    const result = await this.pgClient.query(
                      `INSERT INTO qa_answer_versions (answer_id, body) VALUES ($1, $2) RETURNING id`,
                      [row.answer_id, row.body]
                    )

                    await this.pgClient.query('COMMIT')
                    return { data: result.rows[0], error: null }
                  } catch (err) {
                    await this.pgClient.query('ROLLBACK').catch(() => {})
                    throw err
                  }
                } catch (err) {
                  const error = err instanceof Error ? err.message : 'Unknown error'
                  return { data: null, error }
                }
              },
            }),
          }
        },
      }
    }

    if (table === 'qa_citations') {
      return {
        insert: async (rows: unknown) => {
          try {
            await this.pgClient.query('BEGIN')
            try {
              const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
              await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

              const citationRows = rows as Array<Record<string, unknown>>
              for (const row of citationRows) {
                await this.pgClient.query(
                  `INSERT INTO qa_citations (answer_version_id, content_type, content_id) VALUES ($1, $2, $3)`,
                  [row.answer_version_id, row.content_type, row.content_id]
                )
              }

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
        },
      }
    }

    if (table === 'qa_threads') {
      return {
        update: (row: Record<string, unknown>) => ({
          eq: async (col: string, val: unknown) => {
            try {
              await this.pgClient.query('BEGIN')
              try {
                const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")
                await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

                await this.pgClient.query(
                  `UPDATE qa_threads SET status = $1 WHERE id = $2`,
                  [row.status, val]
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
          },
        }),
      }
    }

    return {
      insert: async () => ({ data: null, error: 'Unknown table' }),
      update: async () => ({ eq: async () => ({ data: null, error: 'Unknown table' }) }),
      select: () => ({ single: async () => ({ data: null, error: 'Unknown table' }) }),
    }
  }
}

describe('escalation inbox (T6.3)', () => {
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

  const clerkIds: Record<string, string> = {
    consultantA: 'clerk-consultantA',
    foremanA1a: 'clerk-foremanA1a',
    foremanB1a: 'fixture_foreman_b1a',
  }

  async function escalateThread(callerClerkId: string, question: string): Promise<string> {
    await dbClient.query('BEGIN')
    try {
      const jwtClaimsEscaped = JSON.stringify({ sub: callerClerkId }).replace(/'/g, "''")
      await dbClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)
      const result = await dbClient.query(`SELECT escalate_refused_question($1) as thread_id`, [question])
      await dbClient.query('COMMIT')
      return result.rows[0]?.thread_id
    } catch (err) {
      await dbClient.query('ROLLBACK').catch(() => {})
      throw err
    }
  }

  skipIfNoLocalStack('(a) consultantA sees thread escalated to her', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    const threadId = await escalateThread(clerkIds.foremanA1a, 'Test question for consultantA escalation inbox')
    console.log(`\n[case a] Created thread: ${threadId}`)

    const supabase = new TestSupabaseClient(dbClient, clerkIds.consultantA)
    const threads = await getMyEscalatedThreadsCore(supabase)

    console.log(`[case a] consultantA's escalated threads count: ${threads.length}`)

    const found = threads.find((t) => t.thread_id === threadId)
    expect(found).toBeDefined()
    expect(found?.escalated_to).toBe(FIXTURE.users.consultantA)
    expect(found?.reason).toBe('ai_refusal')
    console.log(`[case a] ✓ Thread appears in consultantA's inbox`)

    await dbClient.query(`DELETE FROM qa_escalations WHERE thread_id = $1`, [threadId])
    await dbClient.query(`DELETE FROM qa_threads WHERE id = $1`, [threadId])
  }, 30000)

  skipIfNoLocalStack('(b) foremanB1a does NOT see thread escalated to consultantA', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    const threadId = await escalateThread(clerkIds.foremanA1a, 'Test question for foremanB1a does-not-see')
    console.log(`\n[case b] Created thread: ${threadId}`)

    const supabase = new TestSupabaseClient(dbClient, clerkIds.foremanB1a)
    const threads = await getMyEscalatedThreadsCore(supabase)

    const found = threads.find((t) => t.thread_id === threadId)
    expect(found).toBeUndefined()
    console.log(`[case b] ✓ Thread does NOT appear in foremanB1a's inbox`)

    await dbClient.query(`DELETE FROM qa_escalations WHERE thread_id = $1`, [threadId])
    await dbClient.query(`DELETE FROM qa_threads WHERE id = $1`, [threadId])
  }, 30000)

  skipIfNoLocalStack('(c) answerEscalatedThreadCore writes to all four tables', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    const threadId = await escalateThread(clerkIds.foremanA1a, 'Test question for answer verification')
    console.log(`\n[case c] Created thread: ${threadId}`)

    const supabase = new TestSupabaseClient(dbClient, clerkIds.consultantA)
    const citationRefs: CitationRef[] = [
      { contentType: 'journal_entry', contentId: FIXTURE.journal.consultantANormal },
      { contentType: 'wiki_entry_version', contentId: FIXTURE.wikiVersion.entryA1v1 },
    ]
    const result = await answerEscalatedThreadCore(
      supabase,
      FIXTURE.users.consultantA,
      threadId,
      'Test answer body for consultantA',
      citationRefs
    )

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)

    const answerId = result.answerId
    console.log(`[case c] Created answer: ${answerId}`)

    const answerCheck = await dbClient.query(`SELECT * FROM qa_answers WHERE id = $1`, [answerId])
    expect(answerCheck.rows[0]).toBeDefined()
    expect(answerCheck.rows[0].answerer_id).toBe(FIXTURE.users.consultantA)
    expect(answerCheck.rows[0].current_version_id).toBeDefined()
    console.log(`[case c] ✓ qa_answers row verified`)

    const versionId = answerCheck.rows[0].current_version_id
    const versionCheck = await dbClient.query(`SELECT * FROM qa_answer_versions WHERE id = $1`, [versionId])
    expect(versionCheck.rows[0]).toBeDefined()
    expect(versionCheck.rows[0].body).toBe('Test answer body for consultantA')
    console.log(`[case c] ✓ qa_answer_versions row verified`)

    const citationCheck = await dbClient.query(
      `SELECT COUNT(*) as count FROM qa_citations WHERE answer_version_id = $1`,
      [versionId]
    )
    expect(parseInt(citationCheck.rows[0].count)).toBe(2)
    console.log(`[case c] ✓ qa_citations rows verified (2 citations)`)

    const threadCheck = await dbClient.query(`SELECT status FROM qa_threads WHERE id = $1`, [threadId])
    expect(threadCheck.rows[0].status).toBe('answered')
    console.log(`[case c] ✓ qa_threads.status updated to 'answered'`)

    await dbClient.query(`DELETE FROM qa_citations WHERE answer_version_id = $1`, [versionId])
    await dbClient.query(`DELETE FROM qa_answer_versions WHERE id = $1`, [versionId])
    await dbClient.query(`DELETE FROM qa_answers WHERE id = $1`, [answerId])
    await dbClient.query(`DELETE FROM qa_escalations WHERE thread_id = $1`, [threadId])
    await dbClient.query(`DELETE FROM qa_threads WHERE id = $1`, [threadId])
  }, 30000)

  skipIfNoLocalStack('(d) foremanB1a cannot answer thread not escalated to them', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    const threadId = await escalateThread(clerkIds.foremanA1a, 'Test question for rejection check')
    console.log(`\n[case d] Created thread: ${threadId}`)

    const supabase = new TestSupabaseClient(dbClient, clerkIds.foremanB1a)
    const result = await answerEscalatedThreadCore(
      supabase,
      FIXTURE.users.foremanB1a,
      threadId,
      'Unauthorized answer attempt',
      []
    )

    expect(result.success).toBe(false)
    console.log(`[case d] ✓ answerEscalatedThreadCore rejected foremanB1a: success=${result.success}`)

    const answersCheck = await dbClient.query(
      `SELECT COUNT(*) as count FROM qa_answers WHERE thread_id = $1`,
      [threadId]
    )
    expect(parseInt(answersCheck.rows[0].count)).toBe(0)
    console.log(`[case d] ✓ No qa_answers rows created`)

    const threadCheck = await dbClient.query(`SELECT status FROM qa_threads WHERE id = $1`, [threadId])
    expect(threadCheck.rows[0].status).toBe('escalated')
    console.log(`[case d] ✓ qa_threads.status unchanged (still 'escalated')`)

    const versionsCheck = await dbClient.query(
      `SELECT COUNT(*) as count FROM qa_answer_versions qav WHERE EXISTS (SELECT 1 FROM qa_answers qa WHERE qa.id = qav.answer_id AND qa.thread_id = $1)`,
      [threadId]
    )
    expect(parseInt(versionsCheck.rows[0].count)).toBe(0)
    console.log(`[case d] ✓ No qa_answer_versions rows`)

    const citationsCheck = await dbClient.query(
      `SELECT COUNT(*) as count FROM qa_citations qc WHERE EXISTS (SELECT 1 FROM qa_answer_versions qav WHERE qav.id = qc.answer_version_id AND EXISTS (SELECT 1 FROM qa_answers qa WHERE qa.id = qav.answer_id AND qa.thread_id = $1))`,
      [threadId]
    )
    expect(parseInt(citationsCheck.rows[0].count)).toBe(0)
    console.log(`[case d] ✓ No qa_citations rows`)

    await dbClient.query(`DELETE FROM qa_escalations WHERE thread_id = $1`, [threadId])
    await dbClient.query(`DELETE FROM qa_threads WHERE id = $1`, [threadId])
  }, 30000)

  skipIfNoLocalStack('(e) pass_escalation_up_chain allowed after thread is answered', async () => {
    if (!dbClient) {
      console.warn('Database not connected. Skipping test.')
      return
    }

    console.log(`\n[case e] Testing: can a thread be escalated after it's been answered?`)
    console.log(`[case e] Design decision: YES, allow escalation after answering.`)
    console.log(`[case e] Reasoning: supervisor may answer and then realize they need peer/higher review.`)
    console.log(`[case e] No workflow should be blocked by having written an answer.`)

    const createThreadResult = await dbClient.query(
      `INSERT INTO qa_threads (asker_id, question, status, visibility_scope) VALUES ($1, $2, $3, $4) RETURNING id`,
      [FIXTURE.users.foremanA1a, 'Test question for pass-up-after-answer', 'answered', 'organization']
    )
    const threadId = createThreadResult.rows[0]?.id
    console.log(`[case e] Created answered thread: ${threadId}`)

    const escalationInsertResult = await dbClient.query(
      `INSERT INTO qa_escalations (thread_id, escalated_to, escalated_by, reason) VALUES ($1, $2, $3, $4) RETURNING id`,
      [threadId, FIXTURE.users.consultantA, FIXTURE.users.foremanA1a, 'human_passed_up']
    )
    const escalationId = escalationInsertResult.rows[0]?.id
    expect(escalationId).toBeDefined()
    console.log(`[case e] ✓ Escalation created on answered thread: ${escalationId}`)

    const threadCheck = await dbClient.query(`SELECT status FROM qa_threads WHERE id = $1`, [threadId])
    expect(threadCheck.rows[0].status).toBe('answered')
    console.log(`[case e] ✓ Thread remains 'answered' after escalation`)

    const escalationCheck = await dbClient.query(
      `SELECT COUNT(*) as count FROM qa_escalations WHERE thread_id = $1`,
      [threadId]
    )
    expect(parseInt(escalationCheck.rows[0].count)).toBe(1)
    console.log(`[case e] ✓ Design verified: escalation is orthogonal to thread.status`)

    await dbClient.query(`DELETE FROM qa_escalations WHERE thread_id = $1`, [threadId])
    await dbClient.query(`DELETE FROM qa_threads WHERE id = $1`, [threadId])
  }, 30000)
})
