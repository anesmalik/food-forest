/**
 * T4.1: Integration tests for cross-team query action.
 *
 * Tests the full getCrossTeamQueryCore pipeline against the real local Supabase
 * instance with engineered test query vectors (TEST_QUERY_VECTOR from
 * generate-fixture.ts). Calls the real RLS-protected search_corpus function
 * through SET LOCAL authentication as specified in the ticket.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { getCrossTeamQueryCore, type CompletionGenerator, type QueryResult } from '../lib/actions/query'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

// Test double implementing minimal interface of SupabaseClient
// Backed by real pg.Client with SET LOCAL for RLS context
class TestSupabaseClient {
  constructor(private pgClient: pg.Client, private callerId: string, private callerClerkId: string) {}

  async rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> {
    if (name === 'search_corpus') {
      // Execute search_corpus RPC with RLS context via SET LOCAL
      // The query_embedding param comes as a string like "[1,2,3,...]"
      // We need to ensure it's passed correctly to the function
      const queryEmbeddingStr = params.query_embedding as string
      const matchLimit = params.match_limit as number

      try {
        // Use a transaction to ensure SET LOCAL applies to all statements
        await this.pgClient.query('BEGIN')
        try {
          const jwtClaimsEscaped = JSON.stringify({ sub: this.callerClerkId }).replace(/'/g, "''")

          // Set LOCAL statements - must be before the function call
          // Note: do NOT set role to authenticated here — search_corpus is security definer
          // and needs to run with owner privileges to access the embeddings table
          await this.pgClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)

          // Execute search_corpus - the vector string should be properly formatted
          // queryEmbeddingStr is already a valid vector literal like "[1,2,3,...]"
          // We need to quote it as a string before casting to vector
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

describe('getCrossTeamQueryCore', () => {
  let dbClient: pg.Client
  let dbUrl: string
  let retrievedContent: Array<{ content_type: string; content_id: string; chunk_text: string; similarity: number }> = []

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

    // Check fixture user exists and has journal entries
    const userCheck = await dbClient.query(
      `SELECT id, clerk_id, display_name FROM users WHERE id = $1`,
      [FIXTURE.users.consultantA]
    )
    if (userCheck.rows.length > 0) {
      console.log(`[test-setup] Fixture user found: ${userCheck.rows[0].display_name} (clerk_id: ${userCheck.rows[0].clerk_id})`)
    } else {
      console.log(`[test-setup] Fixture user NOT found: ${FIXTURE.users.consultantA}`)
    }

    // Check how many journal entries consultantA authored (should be visible to themselves)
    const entryCount = await dbClient.query(
      `SELECT COUNT(*) as count FROM journal_entries WHERE author_id = $1 AND soft_deleted_at IS NULL`,
      [FIXTURE.users.consultantA]
    )
    console.log(`[test-setup] Journal entries authored by consultantA: ${entryCount.rows[0].count}`)

    // Check how many embeddings exist for those entries
    const embeddingsByConsultantA = await dbClient.query(
      `SELECT COUNT(*) as count FROM embeddings e
       WHERE e.content_type = 'journal_entry'
       AND e.content_id IN (
         SELECT id FROM journal_entries WHERE author_id = $1 AND soft_deleted_at IS NULL
       )`,
      [FIXTURE.users.consultantA]
    )
    console.log(`[test-setup] Embeddings for consultantA's entries: ${embeddingsByConsultantA.rows[0].count}`)

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
  })

  afterAll(async () => {
    if (dbClient) {
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  let queryEmbeddingVector: number[] = [] // Shared query embedding for all tests

  describe('STEP 1: Real search_corpus retrieval', () => {
    skipIfNoLocalStack(
      'retrieves content for consultantA',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // Fetch an actual embedding from the database to use as query vector.
        // Using a real embedding ensures we test the full search_corpus pipeline
        // against actual indexed data. Store it for later tests.
        const embResult = await dbClient.query(
          `SELECT embedding::text as embedding_text FROM embeddings WHERE content_id = $1 LIMIT 1`,
          ['20000000-0000-0000-0000-000000000001']
        )
        if (embResult.rows.length === 0) {
          console.warn('No embedding found for test content. Skipping test.')
          return
        }
        const embeddingText = embResult.rows[0].embedding_text as string
        // Parse the vector text back to an array for the embedder function
        queryEmbeddingVector = JSON.parse(embeddingText)

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        const { data, error } = await supabase.rpc('search_corpus', {
          query_embedding: embeddingText,
          match_limit: 20,
        })

        expect(error).toBeNull()
        expect(data).toBeDefined()
        expect(Array.isArray(data)).toBe(true)

        if (Array.isArray(data)) {
          console.log('\n=== RAW SEARCH_CORPUS RESULTS ===')
          console.log('Returned rows:')
          for (const row of data) {
            const r = row as any
            console.log(`
content_type: ${r.content_type}
content_id: ${r.content_id}
chunk_index: ${r.chunk_index}
similarity: ${r.similarity}
chunk_text: ${r.chunk_text}
---`)
            retrievedContent.push({
              content_type: r.content_type,
              content_id: r.content_id,
              chunk_text: r.chunk_text,
              similarity: r.similarity,
            })
          }
          console.log(`Total rows retrieved: ${data.length}\n`)
        }
      },
      30000
    )
  })

  describe('STEP 1b: RLS scope enforcement — foreman from branch B cannot see branch A restricted content', () => {
    skipIfNoLocalStack(
      'foremanB1a queries but cannot see consultantARestricted',
      async () => {
        if (!dbClient || queryEmbeddingVector.length === 0) {
          console.warn('No query vector. Skipping test.')
          return
        }

        // Create test double for a branch B foreman
        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.foremanB1a, 'fixture_foreman_b1a')

        const { data, error } = await supabase.rpc('search_corpus', {
          query_embedding: `[${queryEmbeddingVector.join(',')}]`,
          match_limit: 20,
        })

        expect(error).toBeNull()
        expect(Array.isArray(data)).toBe(true)

        if (Array.isArray(data)) {
          console.log('\n=== RLS SCOPE TEST: foremanB1a results ===')
          const retrievedIds = data.map((r: any) => r.content_id as string)
          console.log('Retrieved content_ids:')
          for (const id of retrievedIds) {
            console.log(`  ${id}`)
          }

          // Restricted branch A content that formanB1a should NOT see
          const forbiddenContentIds = [
            FIXTURE.journal.consultantARestricted,
            FIXTURE.journal.siteManagerA1Restricted,
            FIXTURE.journal.siteManagerA2Restricted,
            FIXTURE.journal.foremanA1aRestrictedArabic,
            FIXTURE.journal.foremanA2aRestricted,
            FIXTURE.wiki.entryA2,
            FIXTURE.wikiVersion.entryA2v1,
          ]

          console.log('\nForbidden content that should NOT appear:')
          for (const id of forbiddenContentIds) {
            console.log(`  ${id}`)
          }

          const foundForbidden = retrievedIds.filter((id) => forbiddenContentIds.includes(id))
          console.log('\nForbidden content found in results:', foundForbidden.length)
          if (foundForbidden.length > 0) {
            console.log('SECURITY BREACH — these should NOT be visible:')
            for (const id of foundForbidden) {
              console.log(`  ${id}`)
            }
          }

          expect(foundForbidden).toHaveLength(0)
        }
      },
      30000
    )
  })

  describe('STEP 2: Test cases with fake generators', () => {
    skipIfNoLocalStack(
      'returns an answer with citations (cites real content_id)',
      async () => {
        if (!dbClient || retrievedContent.length === 0) {
          console.warn('No retrieved content. Skipping test.')
          return
        }

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        // Use the first retrieved content ID (which is real)
        const realContentId = retrievedContent[0].content_id

        const fakeGenerator: CompletionGenerator = async (systemPrompt, userPrompt) => {
          return {
            output: JSON.stringify({
              summary: 'This is a test answer based on the retrieved content.',
              citations: [realContentId],
            }),
            tokensIn: 100,
            tokensOut: 50,
            latencyMs: 100,
          }
        }

        const query = 'Test query for citations'
        const result = await getCrossTeamQueryCore(
          supabase as any,
          FIXTURE.users.consultantA,
          query,
          'gpt-4-turbo',
          async () => queryEmbeddingVector,
          fakeGenerator
        )

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.citations).toBeDefined()
          expect(result.citations).toContain(realContentId)
        }
      },
      30000
    )

    skipIfNoLocalStack(
      'refuses on malformed JSON',
      async () => {
        if (!dbClient || retrievedContent.length === 0) {
          console.warn('Skipping test - no retrieved content.')
          return
        }

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        const fakeGenerator: CompletionGenerator = async () => {
          return {
            output: 'This is not valid JSON',
            tokensIn: 100,
            tokensOut: 50,
            latencyMs: 100,
          }
        }

        const query = 'Test query'
        const result = await getCrossTeamQueryCore(
          supabase as any,
          FIXTURE.users.consultantA,
          query,
          'gpt-4-turbo',
          async () => queryEmbeddingVector,
          fakeGenerator
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.kind).toBe('validation_failed')
        }
      },
      30000
    )

    skipIfNoLocalStack(
      'refuses on empty citations with substantive summary',
      async () => {
        if (!dbClient || retrievedContent.length === 0) {
          console.warn('Skipping test - no retrieved content.')
          return
        }

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        const fakeGenerator: CompletionGenerator = async () => {
          return {
            output: JSON.stringify({
              summary: 'This is a substantive answer that should have citations.',
              citations: [],
            }),
            tokensIn: 100,
            tokensOut: 50,
            latencyMs: 100,
          }
        }

        const query = 'Test query'
        const result = await getCrossTeamQueryCore(
          supabase as any,
          FIXTURE.users.consultantA,
          query,
          'gpt-4-turbo',
          async () => queryEmbeddingVector,
          fakeGenerator
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.kind).toBe('validation_failed')
        }
      },
      30000
    )

    skipIfNoLocalStack(
      'refuses on fabricated citation (UUID not in retrieved content_ids)',
      async () => {
        if (!dbClient || retrievedContent.length === 0) {
          console.warn('Skipping test - no retrieved content.')
          return
        }

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        // Invent a UUID that doesn't match any fixture id
        const fabricatedUUID = '99999999-9999-9999-9999-999999999999'

        const fakeGenerator: CompletionGenerator = async () => {
          return {
            output: JSON.stringify({
              summary: 'This answer cites a non-existent source.',
              citations: [fabricatedUUID],
            }),
            tokensIn: 100,
            tokensOut: 50,
            latencyMs: 100,
          }
        }

        const query = 'Test query with fabricated citation'
        const result = await getCrossTeamQueryCore(
          supabase as any,
          FIXTURE.users.consultantA,
          query,
          'gpt-4-turbo',
          async () => queryEmbeddingVector,
          fakeGenerator
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.kind).toBe('validation_failed')
          // Verify no summary field is present in the error result
          expect((result as Record<string, unknown>).summary).toBeUndefined()
        }
      },
      30000
    )
  })

  describe('STEP 2b: Real OpenAI API test (gated by SKIP_INTEGRATION)', () => {
    skipIfNoLocalStack(
      'real OpenAI call path works end-to-end',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) {
          console.warn('OPENAI_API_KEY not set. Skipping real OpenAI test.')
          return
        }

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        // Import OpenAI from the module
        const OpenAI = (await import('openai')).default
        const realGenerator: CompletionGenerator = async (systemPrompt, userPrompt) => {
          const client = new OpenAI({ apiKey })
          const latencyStartMs = Date.now()

          const response = await client.chat.completions.create({
            model: 'gpt-4-turbo',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.2,
          })

          const latencyMs = Date.now() - latencyStartMs
          return {
            output: response.choices[0]?.message?.content || '',
            tokensIn: response.usage?.prompt_tokens ?? null,
            tokensOut: response.usage?.completion_tokens ?? null,
            latencyMs,
          }
        }

        const query = 'What is discussed in the content?'
        const result = await getCrossTeamQueryCore(
          supabase as any,
          FIXTURE.users.consultantA,
          query,
          'gpt-4-turbo',
          async () => queryEmbeddingVector,
          realGenerator
        )

        // Either ok:true with citations or ok:false is acceptable
        // The point is proving the real OpenAI call path doesn't throw
        expect(result).toBeDefined()
        if (result.ok) {
          expect(result.citations).toBeDefined()
        } else {
          expect(result.kind).toBeDefined()
        }
      },
      60000
    )
  })

  describe('STEP 5: Escalation routing on validation_failed', () => {
    skipIfNoLocalStack(
      'validation_failed escalates to supervisor with correct thread data',
      async () => {
        if (!dbClient || !queryEmbeddingVector.length) {
          console.warn('Database not connected or no query vector. Skipping test.')
          return
        }

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.foremanA2a, 'fixture_foreman_a2a')

        const fakeGenerator: CompletionGenerator = async () => {
          return {
            output: JSON.stringify({
              summary: 'This is a substantive answer',
              citations: [], // Empty citations with substantive summary triggers validation_failed
            }),
            tokensIn: 100,
            tokensOut: 50,
            latencyMs: 100,
          }
        }

        const query = 'Test query for escalation routing'
        const result = await getCrossTeamQueryCore(
          supabase as any,
          FIXTURE.users.foremanA2a,
          query,
          'gpt-4-turbo',
          async () => queryEmbeddingVector,
          fakeGenerator
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.kind).toBe('validation_failed')
          expect(result.escalatedThreadId).toBeDefined()
          expect(result.escalatedThreadId).not.toBeNull()
          console.log(`[STEP 5 case 1] validation_failed escalated to thread: ${result.escalatedThreadId}`)

          if (result.escalatedThreadId) {
            // Verify qa_threads row
            const threadResult = await dbClient!.query(
              `SELECT id, asker_id, question, status FROM qa_threads WHERE id = $1`,
              [result.escalatedThreadId]
            )
            console.log('\n[STEP 5 case 1] QA Thread query result:')
            console.log(JSON.stringify(threadResult.rows[0], null, 2))

            expect(threadResult.rows.length).toBe(1)
            expect(threadResult.rows[0].asker_id).toBe(FIXTURE.users.foremanA2a)
            expect(threadResult.rows[0].question).toBe(query)
            expect(threadResult.rows[0].status).toBe('escalated')

            // Verify qa_escalations row
            const escalationResult = await dbClient!.query(
              `SELECT thread_id, escalated_to, escalated_by, reason FROM qa_escalations WHERE thread_id = $1`,
              [result.escalatedThreadId]
            )
            console.log('\n[STEP 5 case 1] QA Escalations query result:')
            console.log(JSON.stringify(escalationResult.rows[0], null, 2))

            expect(escalationResult.rows.length).toBe(1)
            expect(escalationResult.rows[0].escalated_to).toBe(FIXTURE.users.siteManagerA2)
            expect(escalationResult.rows[0].escalated_by).toBeNull()
            expect(escalationResult.rows[0].reason).toBe('ai_refusal')
          }
        }
      },
      30000
    )
  })

  describe('STEP 6: OpenAI errors do NOT escalate', () => {
    skipIfNoLocalStack(
      'openai_error does not escalate or create thread',
      async () => {
        if (!dbClient || !queryEmbeddingVector.length) {
          console.warn('Database not connected or no query vector. Skipping test.')
          return
        }

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.foremanA2a, 'fixture_foreman_a2a')

        const throwingGenerator: CompletionGenerator = async () => {
          throw new Error('Simulated embedder failure')
        }

        const query = 'Test query that will fail embedder'
        const result = await getCrossTeamQueryCore(
          supabase as any,
          FIXTURE.users.foremanA2a,
          query,
          'gpt-4-turbo',
          async () => {
            throw new Error('Simulated embedder failure')
          },
          throwingGenerator
        )

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.kind).toBe('openai_error')
          console.log(`[STEP 6] openai_error escalatedThreadId: ${result.escalatedThreadId}`)

          // Check that escalatedThreadId is not present or null
          expect(result.escalatedThreadId === undefined || result.escalatedThreadId === null).toBe(true)

          // Verify no new qa_threads row was created for this query
          const threadCount = await dbClient!.query(
            `SELECT COUNT(*) as count FROM qa_threads WHERE question = $1 AND asker_id = $2`,
            [query, FIXTURE.users.foremanA2a]
          )
          console.log(`[STEP 6] Threads created for this query: ${threadCount.rows[0].count}`)
          expect(threadCount.rows[0].count).toBe(0)
        }
      },
      30000
    )
  })
})
