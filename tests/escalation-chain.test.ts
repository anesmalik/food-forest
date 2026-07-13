/**
 * T4.7: Escalation chain appends tests.
 *
 * Tests the pass_escalation_up_chain function. This function allows a human
 * (the current addressee of an escalation) to pass the escalation further up
 * the chain. It appends new rows to qa_escalations without ever mutating
 * existing rows or the qa_threads status.
 *
 * The function must detect and refuse self-referential escalation (if the
 * computed next target is the same as the caller, raise an exception).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { FIXTURE } from '../scripts/fixtures/fixture-ids'

const { Client } = pg

describe('escalation chain appends', () => {
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

  // Clerk ID mappings for fixture users
  const clerkIds: Record<string, string> = {
    admin: 'fixture_admin_fixture',
    consultantA: 'fixture_consultant_a',
    siteManagerA1: 'fixture_site_manager_a1',
    foremanA1a: 'fixture_foreman_a1a',
    foremanA1b: 'fixture_foreman_a1b',
    siteManagerA2: 'fixture_site_manager_a2',
    foremanA2a: 'fixture_foreman_a2a',
    consultantB: 'fixture_consultant_b',
    siteManagerB1: 'fixture_site_manager_b1',
    foremanB1a: 'fixture_foreman_b1a',
    foremanB1b: 'fixture_foreman_b1b',
    consultantC: 'fixture_consultant_c',
    foremanC1: 'fixture_foreman_c1',
    unplacedBare: 'fixture_unplaced_bare',
  }

  // Helper to set auth context and execute a query
  async function executeWithAuth(clerkId: string, query: string, params?: unknown[]) {
    await dbClient.query('BEGIN')
    try {
      const jwtClaimsEscaped = JSON.stringify({ sub: clerkId }).replace(/'/g, "''")
      await dbClient.query(`SET LOCAL request.jwt.claims = '${jwtClaimsEscaped}'`)
      const result = await dbClient.query(query, params)
      await dbClient.query('COMMIT')
      return result
    } catch (err) {
      await dbClient.query('ROLLBACK').catch(() => {})
      throw err
    }
  }

  describe('pass_escalation_up_chain', () => {
    skipIfNoLocalStack(
      '(a) escalating twice produces two rows, not an overwritten assignee',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // Create a new thread via escalate_refused_question as foremanA1a
        // This creates hop 1: escalated_to = consultantA, reason='ai_refusal', escalated_by=null
        const createThreadResult = await executeWithAuth(
          clerkIds.foremanA1a,
          `SELECT escalate_refused_question($1) as thread_id`,
          ['Test question for escalation chain']
        )
        const threadId = createThreadResult.rows[0]?.thread_id

        console.log(`\n[case a] Created thread: ${threadId}`)

        // Query the escalations for this thread (should be 1 row)
        const initialEscalations = await dbClient.query(
          `SELECT id, thread_id, escalated_to, escalated_by, reason, created_at
           FROM qa_escalations
           WHERE thread_id = $1
           ORDER BY created_at ASC`,
          [threadId]
        )

        console.log(`[case a] After hop 1:`)
        console.log(initialEscalations.rows)
        expect(initialEscalations.rows.length).toBe(1)

        const hop1EscalatedTo = initialEscalations.rows[0].escalated_to
        const hop1EscalatedBy = initialEscalations.rows[0].escalated_by
        const hop1Reason = initialEscalations.rows[0].reason

        console.log(
          `[case a] Hop 1: escalated_to=${hop1EscalatedTo}, escalated_by=${hop1EscalatedBy}, reason=${hop1Reason}`
        )

        // Now, as consultantA (the current addressee), call pass_escalation_up_chain
        // This should create hop 2
        const hop2Result = await executeWithAuth(
          clerkIds.consultantA,
          `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
          [threadId]
        )

        const secondEscalationId = hop2Result.rows[0]?.new_escalation_id
        console.log(`[case a] Hop 2 created: ${secondEscalationId}`)

        // Query all escalations for this thread
        const finalEscalations = await dbClient.query(
          `SELECT id, thread_id, escalated_to, escalated_by, reason, created_at
           FROM qa_escalations
           WHERE thread_id = $1
           ORDER BY created_at ASC`,
          [threadId]
        )

        console.log(`[case a] After hop 2 (final):`)
        console.log(finalEscalations.rows)

        expect(finalEscalations.rows.length).toBe(2)
        expect(finalEscalations.rows[0].escalated_by).toBeNull()
        expect(finalEscalations.rows[0].reason).toBe('ai_refusal')
        expect(finalEscalations.rows[1].escalated_by).not.toBeNull()
        expect(finalEscalations.rows[1].reason).toBe('human_passed_up')
        expect(finalEscalations.rows[0].escalated_to).not.toBe(finalEscalations.rows[1].escalated_to)
      },
      30000
    )

    skipIfNoLocalStack(
      '(b) a user who is not the current addressee cannot pass the escalation up',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // Create a new thread via escalate_refused_question as foremanA1a
        const createThreadResult = await executeWithAuth(
          clerkIds.foremanA1a,
          `SELECT escalate_refused_question($1) as thread_id`,
          ['Test question for unauthorized escalation']
        )
        const threadId = createThreadResult.rows[0]?.thread_id

        console.log(`\n[case b] Created thread: ${threadId}`)

        // Verify there's 1 escalation row
        const initialEscalations = await dbClient.query(
          `SELECT COUNT(*) as count FROM qa_escalations WHERE thread_id = $1`,
          [threadId]
        )
        console.log(`[case b] Initial escalation count: ${initialEscalations.rows[0].count}`)

        // Now, as foremanB1a (an unrelated user), try to call pass_escalation_up_chain
        // This should fail
        let errorMessage = ''
        try {
          await executeWithAuth(
            clerkIds.foremanB1a,
            `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
            [threadId]
          )
        } catch (e: any) {
          errorMessage = e.message
          console.log(`[case b] Expected error: ${errorMessage}`)
        }

        // Verify the error was raised
        expect(errorMessage).toContain('only the current addressee may pass this escalation up the chain')

        // Verify no new row was inserted
        const finalEscalations = await dbClient.query(
          `SELECT COUNT(*) as count FROM qa_escalations WHERE thread_id = $1`,
          [threadId]
        )
        console.log(`[case b] Final escalation count: ${finalEscalations.rows[0].count}`)
        expect(parseInt(finalEscalations.rows[0].count)).toBe(1)
      },
      30000
    )

    skipIfNoLocalStack(
      '(c) passing up three times produces three rows, walking further each time',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // Create a new thread via escalate_refused_question as foremanA2a
        // This user has a longer escalation chain: foremanA2a -> siteManagerA2 -> consultantA -> admin
        const createThreadResult = await executeWithAuth(
          clerkIds.foremanA2a,
          `SELECT escalate_refused_question($1) as thread_id`,
          ['Test question for three-hop escalation']
        )
        const threadId = createThreadResult.rows[0]?.thread_id

        console.log(`\n[case c] Created thread: ${threadId}`)

        // Hop 1 is already created by escalate_refused_question
        const hop1Escalations = await dbClient.query(
          `SELECT id, thread_id, escalated_to, escalated_by, reason, created_at
           FROM qa_escalations
           WHERE thread_id = $1
           ORDER BY created_at ASC`,
          [threadId]
        )
        console.log(`[case c] After hop 1:`)
        console.log(hop1Escalations.rows)

        // Get the current addressee for hop 2
        const hop1AddresseeId = hop1Escalations.rows[0].escalated_to
        // Find the clerk id for this user
        let hop1AddresseeClerkId = ''
        for (const [key, value] of Object.entries(FIXTURE.users)) {
          if (value === hop1AddresseeId) {
            hop1AddresseeClerkId = clerkIds[key as keyof typeof clerkIds] || ''
            break
          }
        }

        // Hop 2: Call pass_escalation_up_chain as the current addressee
        const hop2Result = await executeWithAuth(
          hop1AddresseeClerkId,
          `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
          [threadId]
        )
        console.log(`[case c] Hop 2 created: ${hop2Result.rows[0]?.new_escalation_id}`)

        // Get the new addressee for hop 3
        const hop2Escalations = await dbClient.query(
          `SELECT id, thread_id, escalated_to, escalated_by, reason, created_at
           FROM qa_escalations
           WHERE thread_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [threadId]
        )
        const hop2AddresseeId = hop2Escalations.rows[0].escalated_to
        let hop2AddresseeClerkId = ''
        for (const [key, value] of Object.entries(FIXTURE.users)) {
          if (value === hop2AddresseeId) {
            hop2AddresseeClerkId = clerkIds[key as keyof typeof clerkIds] || ''
            break
          }
        }

        // Hop 3: Call pass_escalation_up_chain again as the new addressee
        const hop3Result = await executeWithAuth(
          hop2AddresseeClerkId,
          `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
          [threadId]
        )
        console.log(`[case c] Hop 3 created: ${hop3Result.rows[0]?.new_escalation_id}`)

        // Query all escalations
        const finalEscalations = await dbClient.query(
          `SELECT id, thread_id, escalated_to, escalated_by, reason, created_at
           FROM qa_escalations
           WHERE thread_id = $1
           ORDER BY created_at ASC`,
          [threadId]
        )

        console.log(`[case c] After hop 3 (final):`)
        console.log(finalEscalations.rows)

        expect(finalEscalations.rows.length).toBe(3)

        // Verify escalated_to differs at each hop
        const hop1To = finalEscalations.rows[0].escalated_to
        const hop2To = finalEscalations.rows[1].escalated_to
        const hop3To = finalEscalations.rows[2].escalated_to

        console.log(`[case c] Escalation targets: hop1=${hop1To}, hop2=${hop2To}, hop3=${hop3To}`)

        expect(hop1To).not.toBe(hop2To)
        expect(hop2To).not.toBe(hop3To)
        expect(hop1To).not.toBe(hop3To)
      },
      30000
    )

    skipIfNoLocalStack(
      '(d) admin cannot pass an escalation further — no target above the top',
      async () => {
        if (!dbClient) {
          console.warn('Database not connected. Skipping test.')
          return
        }

        // Create a new thread via escalate_refused_question as foremanC1
        // foremanC1's escalation chain goes up to admin
        const createThreadResult = await executeWithAuth(
          clerkIds.foremanC1,
          `SELECT escalate_refused_question($1) as thread_id`,
          ['Test question for admin escalation']
        )
        const threadId = createThreadResult.rows[0]?.thread_id

        console.log(`\n[case d] Created thread: ${threadId}`)

        // Get the initial escalation
        const initialEscalations = await dbClient.query(
          `SELECT id, thread_id, escalated_to, escalated_by, reason, created_at
           FROM qa_escalations
           WHERE thread_id = $1
           ORDER BY created_at ASC`,
          [threadId]
        )
        console.log(`[case d] Initial escalation:`)
        console.log(initialEscalations.rows)

        const initialCount = initialEscalations.rows.length

        // Check where the escalation went
        const firstAddresseeId = initialEscalations.rows[0].escalated_to
        console.log(`[case d] First addressee: ${firstAddresseeId}`)
        console.log(`[case d] Admin ID: ${FIXTURE.users.admin}`)

        // If it's not already at admin, escalate further
        let currentThreadId = threadId
        let currentAddresseeId = firstAddresseeId
        if (firstAddresseeId !== FIXTURE.users.admin) {
          // Get clerk id for first addressee
          let currentAddresseeClerkId = ''
          for (const [key, value] of Object.entries(FIXTURE.users)) {
            if (value === currentAddresseeId) {
              currentAddresseeClerkId = clerkIds[key as keyof typeof clerkIds] || ''
              break
            }
          }

          // Try to escalate further to reach admin
          const hop2Result = await executeWithAuth(
            currentAddresseeClerkId,
            `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
            [currentThreadId]
          )
          console.log(`[case d] Escalated to hop 2: ${hop2Result.rows[0]?.new_escalation_id}`)

          // Check if we've reached admin now
          const hop2Escalations = await dbClient.query(
            `SELECT id, thread_id, escalated_to, escalated_by, reason, created_at
             FROM qa_escalations
             WHERE thread_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [currentThreadId]
          )
          currentAddresseeId = hop2Escalations.rows[0].escalated_to
          console.log(`[case d] Current addressee after hop 2: ${currentAddresseeId}`)

          if (currentAddresseeId !== FIXTURE.users.admin) {
            // Get clerk id for hop 2 addressee
            let hop2AddresseeClerkId = ''
            for (const [key, value] of Object.entries(FIXTURE.users)) {
              if (value === currentAddresseeId) {
                hop2AddresseeClerkId = clerkIds[key as keyof typeof clerkIds] || ''
                break
              }
            }

            // Try one more hop
            const hop3Result = await executeWithAuth(
              hop2AddresseeClerkId,
              `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
              [currentThreadId]
            )
            console.log(`[case d] Escalated to hop 3: ${hop3Result.rows[0]?.new_escalation_id}`)

            // Update current addressee
            const hop3Escalations = await dbClient.query(
              `SELECT escalated_to FROM qa_escalations WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [currentThreadId]
            )
            currentAddresseeId = hop3Escalations.rows[0].escalated_to
          }
        }

        // Now we should be at admin. Try to escalate further.
        let errorMessage = ''
        const beforeAdminAttempt = await dbClient.query(
          `SELECT COUNT(*) as count FROM qa_escalations WHERE thread_id = $1`,
          [currentThreadId]
        )
        console.log(`[case d] Row count before admin escalation attempt: ${beforeAdminAttempt.rows[0].count}`)

        try {
          await executeWithAuth(
            clerkIds.admin,
            `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
            [currentThreadId]
          )
        } catch (e: any) {
          errorMessage = e.message
          console.log(`[case d] Expected error: ${errorMessage}`)
        }

        // Verify the specific error
        expect(errorMessage).toContain('already the top of the chain')

        // Verify no new row was inserted
        const afterAdminAttempt = await dbClient.query(
          `SELECT COUNT(*) as count FROM qa_escalations WHERE thread_id = $1`,
          [currentThreadId]
        )
        console.log(`[case d] Row count after admin escalation attempt: ${afterAdminAttempt.rows[0].count}`)
        expect(afterAdminAttempt.rows[0].count).toBe(beforeAdminAttempt.rows[0].count)
      },
      30000
    )
  })

  skipIfNoLocalStack(
    'STEP 4: qa_threads.status remains untouched after escalation hops',
    async () => {
      if (!dbClient) {
        console.warn('Database not connected. Skipping test.')
        return
      }

      // Create a new thread via escalate_refused_question as foremanA1a
      const createThreadResult = await executeWithAuth(
        clerkIds.foremanA1a,
        `SELECT escalate_refused_question($1) as thread_id`,
        ['Test question for status check']
      )
      const threadId = createThreadResult.rows[0]?.thread_id

      console.log(`\n[STEP 4] Created thread: ${threadId}`)

      // Get initial status
      const initialStatus = await dbClient.query(`SELECT status FROM qa_threads WHERE id = $1`, [threadId])
      console.log(`[STEP 4] Initial status: ${initialStatus.rows[0].status}`)
      expect(initialStatus.rows[0].status).toBe('escalated')

      // Escalate once - as consultantA (the current addressee)
      // foremanA1a's escalation goes to consultantA, so consultantA is the current addressee
      await executeWithAuth(
        clerkIds.consultantA,
        `SELECT pass_escalation_up_chain($1) as new_escalation_id`,
        [threadId]
      )

      // Query to confirm we now have 2 rows
      const escalationsAfterHop2 = await dbClient.query(
        `SELECT COUNT(*) as count FROM qa_escalations WHERE thread_id = $1`,
        [threadId]
      )
      console.log(`[STEP 4] Escalation count after one hop: ${escalationsAfterHop2.rows[0].count}`)

      // Check status again - should still be escalated
      const finalStatus = await dbClient.query(`SELECT status FROM qa_threads WHERE id = $1`, [threadId])
      console.log(`[STEP 4] Final status: ${finalStatus.rows[0].status}`)
      expect(finalStatus.rows[0].status).toBe('escalated')
    },
    30000
  )
})
