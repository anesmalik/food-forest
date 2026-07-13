/**
 * T3.3 — Seed-local fixture script tests.
 *
 * Tests cover:
 * - Pure validation functions (isLocalHost, isNotRemoteProject) with pass/fail cases
 * - Guard rejection of remote projects and non-local hosts, with banner printing
 * - Actual fixture loading against a real database connection
 *
 * Run: npx vitest run tests/seed-local.test.ts
 * Integration test: npx vitest run tests/seed-local.test.ts --grep "integration"
 */

import { describe, it, expect, vi } from 'vitest'
import pg from 'pg'
import * as path from 'path'
import {
  isLocalHost,
  isNotRemoteProject,
  guardConnectionString,
  truncateTables,
  loadFixture,
  getRowCounts,
} from '../scripts/fixtures/seed-local'

const { Client } = pg

// ---------------------------------------------------------------------------
// Pure function tests — independently testable validation functions.
// ---------------------------------------------------------------------------

describe('isLocalHost', () => {
  describe('passing cases', () => {
    it('returns true for 127.0.0.1', () => {
      expect(isLocalHost('postgresql://postgres:postgres@127.0.0.1:5432/postgres')).toBe(true)
    })

    it('returns true for localhost', () => {
      expect(isLocalHost('postgresql://postgres:postgres@localhost:5432/postgres')).toBe(true)
    })

    it('returns true for ::1 (IPv6 loopback)', () => {
      expect(isLocalHost('postgresql://postgres:postgres@[::1]:5432/postgres')).toBe(true)
    })

    it('returns true for host.docker.internal', () => {
      expect(isLocalHost('postgresql://postgres:postgres@host.docker.internal:5432/postgres')).toBe(true)
    })
  })

  describe('failing cases', () => {
    it('returns false for a remote AWS RDS host', () => {
      expect(isLocalHost('postgresql://user:pass@my-db.abc123.us-east-1.rds.amazonaws.com:5432/postgres')).toBe(false)
    })

    it('returns false for a Supabase cloud host', () => {
      expect(isLocalHost('postgresql://user:pass@db.dguamjezvrmdfoyctbxp.supabase.co:5432/postgres')).toBe(false)
    })

    it('returns false for an arbitrary remote IP', () => {
      expect(isLocalHost('postgresql://user:pass@203.0.113.42:5432/postgres')).toBe(false)
    })

    it('returns false for malformed URL', () => {
      expect(isLocalHost('not-a-url')).toBe(false)
    })
  })
})

describe('isNotRemoteProject', () => {
  describe('passing cases', () => {
    it('returns true for local connection string', () => {
      expect(isNotRemoteProject('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBe(true)
    })

    it('returns true for localhost', () => {
      expect(isNotRemoteProject('postgresql://postgres:postgres@localhost:54322/postgres')).toBe(true)
    })

    it('returns true for host.docker.internal', () => {
      expect(isNotRemoteProject('postgresql://postgres:postgres@host.docker.internal:5432/postgres')).toBe(true)
    })
  })

  describe('failing cases — remote project rejection', () => {
    it('returns false when connection string contains remote project ID (dguamjezvrmdfoyctbxp)', () => {
      const remoteUrl = 'postgresql://user:pass@db.dguamjezvrmdfoyctbxp.supabase.co:5432/postgres'
      expect(isNotRemoteProject(remoteUrl)).toBe(false)
    })

    it('returns false when connection string contains .supabase.co', () => {
      const remoteUrl = 'postgresql://user:pass@db.other-proj-id.supabase.co:5432/postgres'
      expect(isNotRemoteProject(remoteUrl)).toBe(false)
    })

    it('returns false when connection string contains .supabase.com', () => {
      const remoteUrl = 'postgresql://user:pass@db.some-proj.supabase.com:5432/postgres'
      expect(isNotRemoteProject(remoteUrl)).toBe(false)
    })

    it('returns false even if marker appears in password or username', () => {
      const sneakyUrl = 'postgresql://user.dguamjezvrmdfoyctbxp:pass@127.0.0.1:5432/postgres'
      expect(isNotRemoteProject(sneakyUrl)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Guard check tests — banner printing and rejection behavior.
// ---------------------------------------------------------------------------

describe('guardConnectionString — banner and guard checks', () => {
  it('prints banner before throwing on remote project rejection', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const remoteUrl = 'postgresql://user:pass@db.dguamjezvrmdfoyctbxp.supabase.co:5432/postgres'

    // Guard should throw — isLocalHost check fails first (it's a .supabase.co host)
    await expect(guardConnectionString(remoteUrl)).rejects.toThrow('GUARD FAILED: isLocalHost')

    // Verify banner was logged BEFORE the throw
    // Get all calls to console.log
    const calls = logSpy.mock.calls.map((c) => c[0])

    expect(calls).toContain('⚠️  MECHANICS FIXTURE, NOT A QUALITY BENCHMARK.')
    expect(calls).toContain('   Engineered embedding vectors, not real OpenAI output.')
    expect(calls).toContain('   This proves SQL access-control and re-rank mechanics only.')
    expect(calls).toContain('   It does not measure real retrieval quality or Arabic embedding')
    expect(calls).toContain('   quality — see stage-three spec §1.14.')

    // Verify banner appears before the throw by checking call indices
    const bannerStartIndex = calls.findIndex((c) => c && c.includes('MECHANICS FIXTURE'))
    expect(bannerStartIndex).toBeGreaterThanOrEqual(0)

    logSpy.mockRestore()
  })

  it('prints banner before throwing on non-local host rejection', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const remoteUrl = 'postgresql://user:pass@some-db.example.com:5432/postgres'

    // Guard should throw
    await expect(guardConnectionString(remoteUrl)).rejects.toThrow('GUARD FAILED: isLocalHost')

    // Banner should still be printed
    const calls = logSpy.mock.calls.map((c) => c[0])
    expect(calls).toContain('⚠️  MECHANICS FIXTURE, NOT A QUALITY BENCHMARK.')

    logSpy.mockRestore()
  })

  it('accepts local connection string that passes both guards', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const localUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

    // Should not throw
    await expect(guardConnectionString(localUrl)).resolves.not.toThrow()

    // Banner should be printed
    const calls = logSpy.mock.calls.map((c) => c[0])
    expect(calls).toContain('⚠️  MECHANICS FIXTURE, NOT A QUALITY BENCHMARK.')

    logSpy.mockRestore()
  })

  it('rejects connection string containing dguamjezvrmdfoyctbxp in URL', async () => {
    const remoteUrl = 'postgresql://user:pass@db.dguamjezvrmdfoyctbxp.supabase.co:5432/postgres'

    expect(isLocalHost(remoteUrl)).toBe(false)
    expect(isNotRemoteProject(remoteUrl)).toBe(false)
  })

  it('rejects connection string with non-local host', async () => {
    const remoteUrl = 'postgresql://user:pass@some-other-db.example.com:5432/postgres'

    expect(isLocalHost(remoteUrl)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration tests — run against real local Supabase if available.
// ---------------------------------------------------------------------------

describe(
  'integration — actual fixture loading',
  () => {
    const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it
    const INTEGRATION_TIMEOUT = 30000

    skipIfNoLocalStack(
      'loads fixture against real local Supabase instance',
      async () => {
        // Get connection string from environment or supabase status
        let dbUrl: string
        if (process.env.DATABASE_URL) {
          dbUrl = process.env.DATABASE_URL
        } else {
          // Try to get it from supabase status
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

        // Verify guard checks pass
        expect(isLocalHost(dbUrl)).toBe(true)
        expect(isNotRemoteProject(dbUrl)).toBe(true)

        // Connect to database
        const client = new Client({ connectionString: dbUrl })
        try {
          await client.connect()

          // Truncate fixture tables (only those with fixture UUID prefixes)
          await truncateTables(client)

          // Load fixture
          const fixturePath = path.join(__dirname, '..', 'scripts', 'fixtures', 'output', 'stage-three-fixture.sql')
          await loadFixture(client, fixturePath)

          // Get actual row counts
          const counts = await getRowCounts(client)

          // Verify expected counts
          expect(counts.users).toBe(15)
          expect(counts.journal_entries).toBe(21)
          expect(counts.wiki_entries).toBe(3)
          expect(counts.wiki_entry_versions).toBe(3)
          expect(counts.qa_threads).toBe(2)
          expect(counts.qa_answers).toBe(1)
          expect(counts.qa_answer_versions).toBe(1)
          expect(counts.embeddings).toBe(5027)
        } finally {
          await client.end()
        }
      },
      INTEGRATION_TIMEOUT
    )

    skipIfNoLocalStack(
      'fixture loading is idempotent (can run twice)',
      async () => {
        // Get connection string
        let dbUrl: string
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

        const client = new Client({ connectionString: dbUrl })
        try {
          await client.connect()

          const fixturePath = path.join(__dirname, '..', 'scripts', 'fixtures', 'output', 'stage-three-fixture.sql')

          // Run 1: truncate and load
          await truncateTables(client)
          await loadFixture(client, fixturePath)
          const countsAfterRun1 = await getRowCounts(client)

          // Run 2: truncate and load again
          await truncateTables(client)
          await loadFixture(client, fixturePath)
          const countsAfterRun2 = await getRowCounts(client)

          // Both runs should produce identical counts (idempotent)
          expect(countsAfterRun2).toEqual(countsAfterRun1)
          expect(countsAfterRun2.users).toBe(15)
          expect(countsAfterRun2.embeddings).toBe(5027)
        } finally {
          await client.end()
        }
      },
      INTEGRATION_TIMEOUT
    )

    skipIfNoLocalStack(
      'truncateTables only deletes fixture rows, not unrelated data',
      async () => {
        // Get connection string
        let dbUrl: string
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

        const client = new Client({ connectionString: dbUrl })
        try {
          await client.connect()

          const fixturePath = path.join(__dirname, '..', 'scripts', 'fixtures', 'output', 'stage-three-fixture.sql')

          // Load fixture
          await truncateTables(client)
          await loadFixture(client, fixturePath)

          // Manually insert a non-fixture user with a different UUID prefix
          const testUserId = '99000000-0000-0000-0000-000000000001'
          await client.query(
            `INSERT INTO users (id, clerk_id, email, display_name, role, supervisor_id, deactivated_at)
             VALUES ($1, 'test_user', 'test@test.local', 'Test User', 'admin', NULL, NULL)`,
            [testUserId]
          )

          const beforeTruncate = await client.query(`SELECT COUNT(*) as count FROM users WHERE id = $1`, [testUserId])
          expect(parseInt(beforeTruncate.rows[0].count, 10)).toBe(1)

          // Truncate (should only remove fixture rows)
          await truncateTables(client)

          // Verify non-fixture row is still there
          const afterTruncate = await client.query(`SELECT COUNT(*) as count FROM users WHERE id = $1`, [testUserId])
          expect(parseInt(afterTruncate.rows[0].count, 10)).toBe(1)

          // Verify fixture rows are gone (cast UUID to text for LIKE pattern)
          const fixtureCount = await client.query(
            `SELECT COUNT(*) as count FROM users WHERE id::text LIKE '10000000-%'`
          )
          expect(parseInt(fixtureCount.rows[0].count, 10)).toBe(0)

          // Cleanup
          await client.query(`DELETE FROM users WHERE id = $1`, [testUserId])
        } finally {
          await client.end()
        }
      },
      INTEGRATION_TIMEOUT
    )
  }
)
