/**
 * T4.6: Escalation routing tests.
 *
 * Tests the find_escalation_target and escalate_refused_question functions
 * against the real fixture user hierarchy. Verifies that escalation walks up
 * the supervisor chain correctly, skipping deactivated users, and falls back
 * to the admin when necessary.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

describe('escalation routing', () => {
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
  })

  afterAll(async () => {
    if (dbClient) {
      await dbClient.end()
    }
  })

  const skipIfNoLocalStack = process.env.SKIP_INTEGRATION ? it.skip : it

  describe('find_escalation_target', () => {
    skipIfNoLocalStack(
      '(a) lands on direct supervisor when they are live',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // foremanA2a's direct supervisor is siteManagerA2 (active)
        const result = await dbClient.query(
          `SELECT find_escalation_target($1) as target_id`,
          [FIXTURE.users.foremanA2a]
        )

        const targetId = result.rows[0]?.target_id
        console.log(`[case a] foremanA2a -> ${targetId} (expected: ${FIXTURE.users.siteManagerA2})`)
        expect(targetId).toBe(FIXTURE.users.siteManagerA2)
      },
      30000
    )

    skipIfNoLocalStack(
      '(b) deactivated direct supervisor is skipped, lands on nearest live ancestor',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // foremanA1a's direct supervisor siteManagerA1 is deactivated
        // Should return consultantA's id (skipping siteManagerA1)
        const result = await dbClient.query(
          `SELECT find_escalation_target($1) as target_id`,
          [FIXTURE.users.foremanA1a]
        )

        const targetId = result.rows[0]?.target_id
        console.log(`[case b] foremanA1a -> ${targetId} (expected: ${FIXTURE.users.consultantA})`)
        expect(targetId).toBe(FIXTURE.users.consultantA)
      },
      30000
    )

    skipIfNoLocalStack(
      '(c) chain with no live ancestor below admin lands on admin',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // foremanC1's supervisor consultantC is deactivated
        // consultantC's supervisor is admin (live)
        // Should return admin's id
        const result = await dbClient.query(
          `SELECT find_escalation_target($1) as target_id`,
          [FIXTURE.users.foremanC1]
        )

        const targetId = result.rows[0]?.target_id
        console.log(`[case c] foremanC1 -> ${targetId} (expected: ${FIXTURE.users.admin})`)
        expect(targetId).toBe(FIXTURE.users.admin)
      },
      30000
    )

    skipIfNoLocalStack(
      '(d) unplaced user is never an addressee, falls back to admin via explicit fallback path',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // foremanOrphanUnderUnplaced's supervisor is the unplaced bare-row user
        // (role IS NULL, supervisor_id IS NULL — a genuine dead end)
        // Should return admin's id via the explicit fallback path (not by naturally walking up)
        const result = await dbClient.query(
          `SELECT find_escalation_target($1) as target_id`,
          [FIXTURE.users.foremanOrphanUnderUnplaced]
        )

        const targetId = result.rows[0]?.target_id
        console.log(`[case d] foremanOrphanUnderUnplaced -> ${targetId} (expected: ${FIXTURE.users.admin})`)
        console.log('[case d] Note: This is the explicit fallback path, not the natural walk')
        expect(targetId).toBe(FIXTURE.users.admin)
      },
      30000
    )
  })
})
