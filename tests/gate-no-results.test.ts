import { describe, it, expect } from 'vitest'
import pg from 'pg'
import { getCrossTeamQueryCore } from '../lib/actions/query'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

class StubbedSearchCorpusClient {
  constructor(private pgClient: pg.Client, private callerClerkId: string) {}

  async rpc(name: string, params: Record<string, unknown>) {
    if (name === 'search_corpus') {
      return { data: [], error: null }
    }
    if (name === 'escalate_refused_question') {
      try {
        await this.pgClient.query('BEGIN')
        await this.pgClient.query('SET LOCAL role authenticated')
        await this.pgClient.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: this.callerClerkId })}'`)
        const result = await this.pgClient.query('SELECT escalate_refused_question($1) as id', [params.p_question])
        await this.pgClient.query('COMMIT')
        return { data: result.rows[0]?.id || null, error: null }
      } catch (err) {
        await this.pgClient.query('ROLLBACK').catch(() => {})
        return { data: null, error: (err as Error).message }
      }
    }
    return { data: null, error: 'unhandled rpc in stub' }
  }

  from(table: string) {
    return {
      insert: async (row: Record<string, unknown>) => {
        const columns = Object.keys(row)
        const values = Object.values(row)
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        await this.pgClient.query(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
          values
        )
        return { data: null, error: null }
      },
    }
  }
}

describe('gate assertion #12: no_results refusal', () => {
  it('refuses, logs citations_valid=false, no summary text, when search_corpus returns nothing', async () => {
    const { execSync } = await import('child_process')
    const output = execSync('supabase status -o json', { encoding: 'utf-8' })
    const json = JSON.parse(output.substring(output.indexOf('{')))
    const pgClient = new Client({ connectionString: json.DB_URL })
    await pgClient.connect()

    const supabase = new StubbedSearchCorpusClient(pgClient, 'fixture_consultant_a')

    const result = await getCrossTeamQueryCore(
      supabase as any,
      FIXTURE.users.consultantA,
      'a query that will hit the stubbed empty retrieval',
      'gpt-4-turbo',
      async () => new Array(1024).fill(0.1),
      async () => ({ output: '', tokensIn: null, tokensOut: null, latencyMs: 0 })
    )

    console.log('[result]', JSON.stringify(result))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('no_results')
      expect((result as Record<string, unknown>).summary).toBeUndefined()
    }

    const logCheck = await pgClient.query(
      `SELECT citations_valid, function FROM ai_call_log WHERE query = $1 ORDER BY created_at DESC LIMIT 1`,
      ['a query that will hit the stubbed empty retrieval']
    )
    console.log('[ai_call_log row]', JSON.stringify(logCheck.rows[0]))
    expect(logCheck.rows[0].citations_valid).toBe(false)
    expect(logCheck.rows[0].function).toBe('cross_team_query')

    await pgClient.end()
  })
})
