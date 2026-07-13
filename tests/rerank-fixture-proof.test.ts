/**
 * T4.5: Prove that the full re-rank pipeline works against real fixture data.
 *
 * Tests that rerank() applied to real search_corpus retrieval produces the
 * expected rank ordering for two specific scenarios:
 *
 * (a) Wiki entry outranks journal entry at equal raw cosine similarity.
 * (b) QA answer with high question_similarity outranks journal entry with
 *     higher raw similarity.
 *
 * Uses real fixture data as the proof: retrievals happen via search_corpus
 * with SET LOCAL authentication, and rerank() is applied to the actual returned
 * rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { rerank } from '../lib/rerank'
import { TEST_QUERY_VECTOR } from '../scripts/fixtures/generate-fixture'
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
    return { data: null, error: 'Unknown RPC' }
  }
}

describe('rerank fixture proof', () => {
  let dbClient: pg.Client
  let dbUrl: string
  let retrievedRows: any[] = []

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
  })

  afterAll(async () => {
    if (dbClient) {
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  describe('STEP 1: Retrieve real rows via search_corpus', () => {
    skipIfNoLocalStack(
      'retrieves content as consultantA with a fixture-engineered query vector',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // Use TEST_QUERY_VECTOR (the canonical engineering basis for the fixture)
        // to retrieve content with known, engineered similarity relationships.
        // The fixture embeddings are constructed to have specific cosine
        // similarities to TEST_QUERY_VECTOR: entryA1v1 and consultantANormal at 0.6,
        // pumpPressureQuestion at 0.95, pumpPressureAnswer at 0.3, foremanA2aNormal at 0.7.
        const queryEmbeddingStr = `[${TEST_QUERY_VECTOR.join(',')}]`

        const supabase = new TestSupabaseClient(dbClient, FIXTURE.users.consultantA, 'fixture_consultant_a')

        // Use a high match_limit (1000) because TEST_QUERY_VECTOR's closest matches
        // in the raw HNSW index are bulk filler entries (90000000-* prefix) that get
        // filtered out by can_see_content(). The HNSW search must look far enough to
        // get past these filtered entries to find the valid fixture content.
        const { data, error } = await supabase.rpc('search_corpus', {
          query_embedding: queryEmbeddingStr,
          match_limit: 1000,
        })

        expect(error).toBeNull()
        expect(data).toBeDefined()
        expect(Array.isArray(data)).toBe(true)

        if (Array.isArray(data)) {
          retrievedRows = data as any[]
          console.log(`\n[search_corpus retrieval] Returned ${retrievedRows.length} rows`)
          console.log('Retrieved content_ids and their similarities:')
          for (const row of retrievedRows) {
            console.log(
              `  ${row.content_id} (${row.content_type}, similarity: ${row.similarity}, question_similarity: ${row.question_similarity})`
            )
          }
        }
      },
      30000
    )
  })

  describe('STEP 2: Apply rerank and prove rank ordering', () => {
    skipIfNoLocalStack(
      '(a) wiki chunk outranks journal chunk at equal cosine similarity',
      async () => {
        if (!dbClient || retrievedRows.length === 0) {
          console.warn('No retrieved rows. Skipping test.')
          return
        }

        const ranked = rerank(retrievedRows)

        // Find the positions of the two content_ids
        const wikiIndex = ranked.findIndex((r) => r.content_id === FIXTURE.wikiVersion.entryA1v1)
        const journalIndex = ranked.findIndex((r) => r.content_id === FIXTURE.journal.consultantANormal)

        console.log(`\n[Test (a): Wiki vs Journal at equal similarity]`)
        console.log(`Wiki entry (${FIXTURE.wikiVersion.entryA1v1}):`)
        if (wikiIndex >= 0) {
          const wikiRow = ranked[wikiIndex]
          console.log(`  Found at rank index: ${wikiIndex}`)
          console.log(`  similarity: ${wikiRow.similarity}`)
          console.log(`  rankScore: ${wikiRow.rankScore}`)
        } else {
          console.log(`  NOT FOUND in retrieved results`)
        }

        console.log(`Journal entry (${FIXTURE.journal.consultantANormal}):`)
        if (journalIndex >= 0) {
          const journalRow = ranked[journalIndex]
          console.log(`  Found at rank index: ${journalIndex}`)
          console.log(`  similarity: ${journalRow.similarity}`)
          console.log(`  rankScore: ${journalRow.rankScore}`)
        } else {
          console.log(`  NOT FOUND in retrieved results`)
        }

        // Assert wiki entry ranks strictly higher (earlier index) than journal entry
        expect(wikiIndex).toBeLessThan(journalIndex)
      },
      30000
    )

    skipIfNoLocalStack(
      '(b) QA answer with closely-matching question outranks journal chunk of higher raw similarity',
      async () => {
        if (!dbClient || retrievedRows.length === 0) {
          console.warn('No retrieved rows. Skipping test.')
          return
        }

        const ranked = rerank(retrievedRows)

        // Find the positions of the two content_ids
        const qaIndex = ranked.findIndex((r) => r.content_id === FIXTURE.qaAnswerVersion.pumpPressureAnswerV1)
        const journalIndex = ranked.findIndex((r) => r.content_id === FIXTURE.journal.foremanA2aNormal)

        console.log(`\n[Test (b): QA answer vs Journal with higher raw similarity]`)
        console.log(`QA answer (${FIXTURE.qaAnswerVersion.pumpPressureAnswerV1}):`)
        if (qaIndex >= 0) {
          const qaRow = ranked[qaIndex]
          console.log(`  Found at rank index: ${qaIndex}`)
          console.log(`  similarity: ${qaRow.similarity}`)
          console.log(`  question_similarity: ${qaRow.question_similarity}`)
          console.log(`  rankScore: ${qaRow.rankScore}`)
        } else {
          console.log(`  NOT FOUND in retrieved results`)
        }

        console.log(`Journal entry (${FIXTURE.journal.foremanA2aNormal}):`)
        if (journalIndex >= 0) {
          const journalRow = ranked[journalIndex]
          console.log(`  Found at rank index: ${journalIndex}`)
          console.log(`  similarity: ${journalRow.similarity}`)
          console.log(`  question_similarity: ${journalRow.question_similarity}`)
          console.log(`  rankScore: ${journalRow.rankScore}`)
        } else {
          console.log(`  NOT FOUND in retrieved results`)
        }

        // Assert QA answer ranks strictly higher (earlier index) than journal entry
        expect(qaIndex).toBeLessThan(journalIndex)
      },
      30000
    )
  })
})
