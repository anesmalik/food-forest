/**
 * T2.3 — getSummaryCore Tests
 *
 * Tests the getSummaryCore function end-to-end with real authenticated Supabase clients
 * and mocked OpenAI completion generator.
 *
 * Covers:
 * 1. Rate limiting: second call within 5min → returns rate_limited, no generator call, no log row
 * 2. No recent activity: empty retrieval → returns no_activity, writes log with citations_valid=null
 * 3. Success path: valid OpenAI response → returns ok: true, writes log with citations_valid=true
 * 4. Fabrication refusal: ungrounded citations → returns validation_failed, writes log with citations_valid=false
 * 5. Generator error: completion fails → returns openai_error, writes log with citations_valid=false
 * 6. Log insert failure: handles gracefully, result still returned
 *
 * Run: npx vitest run tests/get-summary.test.ts
 */

import { describe, beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'
import ws from 'ws'
import { getSummaryCore, type CompletionGenerator } from '../lib/actions/summary'

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'

function signTestJwt(sub: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'supabase',
    iat: now,
    exp: now + 3600,
  }
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')
  const data = `${b64url(header)}.${b64url(payload)}`
  const sig = createHmac('sha256', JWT_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  realtime: { params: { eventsPerSecond: 0 }, transport: ws },
  auth: { persistSession: false, autoRefreshToken: false },
})

function authClient(jwt: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { params: { eventsPerSecond: 0 }, transport: ws },
    accessToken: async () => jwt,
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const ts = Date.now()

async function insertUser(clerkId: string, email: string, displayName: string, supervisorId?: string | null) {
  const { data, error } = await admin
    .from('users')
    .insert({
      clerk_id: clerkId,
      email,
      display_name: displayName,
      supervisor_id: supervisorId || null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to insert user: ${error.message}`)
  return data.id
}

// journal_entries has no service_role grant by design (T1.1b) — only `authenticated`
// can insert, and RLS restricts it to author_id = current_app_user(). The real app
// never has service-role write journal entries, so fixture setup must match that
// exact path: insert as the target user themselves, not as service-role.
async function insertJournalEntry(
  client: ReturnType<typeof authClient>,
  userId: string,
  body: string,
  daysAgo: number = 0
) {
  const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await client
    .from('journal_entries')
    .insert({
      author_id: userId, // RLS with-check requires this to equal current_app_user()
      body,
      sensitivity: 'normal',
      created_at: createdAt,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to insert journal entry: ${error.message}`)
  return data.id
}

describe('getSummaryCore', () => {
  let callerId: string
  let targetId: string
  let callerJwt: string
  let callerClient: ReturnType<typeof authClient>
  let targetClient: ReturnType<typeof authClient>

  beforeAll(async () => {
    callerId = await insertUser(`clerk-core-caller-${ts}`, 'caller@test.local', 'Caller')
    targetId = await insertUser(`clerk-core-target-${ts}`, 'target@test.local', 'Target', callerId)
    callerJwt = signTestJwt(`clerk-core-caller-${ts}`)
    callerClient = authClient(callerJwt)
    targetClient = authClient(signTestJwt(`clerk-core-target-${ts}`))
  })

  // Every test in this block shares (callerId, targetId). Each call to getSummaryCore
  // — including the setup row the rate-limiting test deliberately inserts, and the
  // real log row every other test's own call writes — falls inside check_recent_summary_call's
  // 5-minute window and would otherwise rate-limit every subsequent test. Clear the
  // slate before each test so only that test's own rate-limit behavior is under test.
  beforeEach(async () => {
    await admin.from('ai_call_log').delete().eq('user_id', callerId).eq('query', targetId)
  })

  afterAll(async () => {
    if (callerId) {
      await admin.from('ai_call_log').delete().eq('user_id', callerId)
      await admin.from('journal_entries').delete().eq('author_id', targetId)
      await admin.from('users').delete().eq('id', targetId)
      await admin.from('users').delete().eq('id', callerId)
    }
  })

  describe('rate limiting', () => {
    it('returns rate_limited when check_recent_summary_call returns true', async () => {
      // Setup: insert a log row to simulate a recent call
      const now = new Date().toISOString()
      await admin.from('ai_call_log').insert({
        user_id: callerId,
        function: 'supervisor_summary',
        query: targetId,
        model_name: 'gpt-4-turbo',
        prompt: 'prior prompt',
        response: 'prior response',
        created_at: now,
      })

      // Mock generator that should NOT be called
      const mockGenerator: CompletionGenerator = vi.fn()

      // Call getSummaryCore
      const result = await getSummaryCore(
        callerClient,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Verify rate-limited result
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.kind).toBe('rate_limited')
      }

      // Verify generator was NOT called
      expect(mockGenerator).not.toHaveBeenCalled()

      // Verify NO new log row was written (only the prior one exists)
      const { data: logRows } = await admin
        .from('ai_call_log')
        .select('*')
        .eq('user_id', callerId)
        .eq('query', targetId)

      const logsAfter = logRows?.length ?? 0
      expect(logsAfter).toBe(1) // Only the setup row, not a new one
    })
  })

  describe('no recent activity', () => {
    it('returns no_activity and writes log row with citations_valid=null', async () => {
      // Setup: target with no entries
      const noActivityTargetId = await insertUser(
        `clerk-core-no-activity-${ts}`,
        'no-activity@test.local',
        'NoActivity',
        callerId
      )

      // Mock generator that should NOT be called
      const mockGenerator: CompletionGenerator = vi.fn()

      // Call getSummaryCore
      const result = await getSummaryCore(
        callerClient,
        callerId,
        noActivityTargetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Verify no_activity result
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.kind).toBe('no_activity')
      }

      // Verify generator was NOT called
      expect(mockGenerator).not.toHaveBeenCalled()

      // Verify log row exists with citations_valid=null
      const { data: logRows } = await admin
        .from('ai_call_log')
        .select('*')
        .eq('user_id', callerId)
        .eq('query', noActivityTargetId)

      expect(logRows).toBeDefined()
      expect(logRows?.length).toBe(1)
      expect(logRows?.[0].citations_valid).toBeNull()
      expect(logRows?.[0].response).toBe('No recent activity to summarize')
    })
  })

  describe('success path', () => {
    it('returns ok: true with valid citations and logs citations_valid: true', async () => {
      // Setup: create entries for the target
      const entry1Id = await insertJournalEntry(targetClient, targetId, 'Completed project A', 2)
      const entry2Id = await insertJournalEntry(targetClient, targetId, 'Reviewed team feedback', 1)
      const entry3Id = await insertJournalEntry(targetClient, targetId, 'Updated documentation', 0)

      // Mock generator that returns valid JSON
      const mockGenerator: CompletionGenerator = vi.fn(async () => ({
        output: JSON.stringify({
          summary: 'Team made progress on project A and improved documentation',
          citations: [entry1Id, entry3Id],
        }),
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 1500,
      }))

      // Call getSummaryCore
      const result = await getSummaryCore(
        callerClient,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Verify success result
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe('Team made progress on project A and improved documentation')
        expect(result.citations).toEqual([entry1Id, entry3Id])
      }

      // Verify generator was called
      expect(mockGenerator).toHaveBeenCalledTimes(1)

      // Verify log row exists with citations_valid: true
      const { data: logRows } = await admin
        .from('ai_call_log')
        .select('*')
        .eq('user_id', callerId)
        .eq('query', targetId)
        .eq('citations_valid', true)
        .order('created_at', { ascending: false })
        .limit(1)

      expect(logRows).toBeDefined()
      expect(logRows?.length).toBeGreaterThan(0)
      const latestLog = logRows?.[0]
      expect(latestLog?.citations_valid).toBe(true)
      expect(latestLog?.tokens_in).toBe(100)
      expect(latestLog?.tokens_out).toBe(50)
      expect(latestLog?.latency_ms).toBe(1500)
      expect(latestLog?.retrieved_ids).toContain(entry1Id)
      expect(latestLog?.retrieved_ids).toContain(entry2Id)
      expect(latestLog?.retrieved_ids).toContain(entry3Id)
    })
  })

  describe('validation failures', () => {
    it('returns validation_failed for fabricated citations and logs citations_valid: false', async () => {
      // Setup: create entries
      const entry1Id = await insertJournalEntry(targetClient, targetId, 'Valid entry 1', 2)
      const entry2Id = await insertJournalEntry(targetClient, targetId, 'Valid entry 2', 1)

      // Mock generator that returns response with fabricated citation
      const mockGenerator: CompletionGenerator = vi.fn(async () => ({
        output: JSON.stringify({
          summary: 'Summary with a fake citation',
          citations: [entry1Id, 'fake-uuid-not-in-entries'],
        }),
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 1500,
      }))

      // Call getSummaryCore
      const result = await getSummaryCore(
        callerClient,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Verify validation_failed result
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.kind).toBe('validation_failed')
        expect(result.reason).toContain('not found in retrieved set')
      }

      // Verify generator was called
      expect(mockGenerator).toHaveBeenCalledTimes(1)

      // Verify log row exists with citations_valid: false
      const { data: logRows } = await admin
        .from('ai_call_log')
        .select('*')
        .eq('user_id', callerId)
        .eq('query', targetId)
        .eq('citations_valid', false)
        .order('created_at', { ascending: false })
        .limit(1)

      expect(logRows).toBeDefined()
      expect(logRows?.length).toBeGreaterThan(0)
      const latestLog = logRows?.[0]
      expect(latestLog?.citations_valid).toBe(false)
      // Raw model output is stored in audit log even though refusal was returned
      expect(latestLog?.response).toContain('fake-uuid-not-in-entries')
    })

    it('rejects substantive summary with no citations', async () => {
      // Setup: create an entry
      await insertJournalEntry(targetClient, targetId, 'Some work entry', 1)

      // Mock generator returning substantive summary with empty citations
      const mockGenerator: CompletionGenerator = vi.fn(async () => ({
        output: JSON.stringify({
          summary: 'This is a substantive summary with actual content',
          citations: [],
        }),
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 1500,
      }))

      const result = await getSummaryCore(
        callerClient,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.kind).toBe('validation_failed')
        expect(result.reason).toContain('substantive summary')
      }
    })

    it('accepts empty summary with no citations', async () => {
      // Setup: create an entry
      const entryId = await insertJournalEntry(targetClient, targetId, 'An entry', 1)

      // Mock generator returning empty summary with empty citations
      const mockGenerator: CompletionGenerator = vi.fn(async () => ({
        output: JSON.stringify({
          summary: '   ',
          citations: [],
        }),
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 1500,
      }))

      const result = await getSummaryCore(
        callerClient,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Empty summary with no citations is valid (means: nothing to summarize)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary.trim()).toBe('')
        expect(result.citations).toEqual([])
      }
    })
  })

  describe('generator errors', () => {
    it('returns openai_error when generator throws and logs citations_valid: false', async () => {
      // Setup: create an entry
      await insertJournalEntry(targetClient, targetId, 'Entry to summarize', 1)

      // Mock generator that throws
      const mockGenerator: CompletionGenerator = vi.fn(async () => {
        throw new Error('API rate limit exceeded')
      })

      // Call getSummaryCore
      const result = await getSummaryCore(
        callerClient,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Verify openai_error result
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.kind).toBe('openai_error')
      }

      // Verify generator was called
      expect(mockGenerator).toHaveBeenCalledTimes(1)

      // Verify log row exists with citations_valid: false
      const { data: logRows } = await admin
        .from('ai_call_log')
        .select('*')
        .eq('user_id', callerId)
        .eq('query', targetId)
        .eq('citations_valid', false)
        .order('created_at', { ascending: false })
        .limit(1)

      expect(logRows).toBeDefined()
      expect(logRows?.length).toBeGreaterThan(0)
      const latestLog = logRows?.[0]
      expect(latestLog?.citations_valid).toBe(false)
      expect(latestLog?.response).toContain('Generator error')
    })

    it('still returns result if log insert fails', async () => {
      // Setup: create an entry
      const validEntryId = await insertJournalEntry(targetClient, targetId, 'Entry for logging test', 1)

      // Mock generator
      const mockGenerator: CompletionGenerator = vi.fn(async () => ({
        output: JSON.stringify({
          summary: 'Valid summary',
          citations: [validEntryId],
        }),
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 1500,
      }))

      // Spy on console.error to verify error is logged
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Patch the supabase client to fail on ai_call_log insert
      const failingClient = {
        ...callerClient,
        rpc: callerClient.rpc.bind(callerClient),
        from: (table: string) => {
          const original = callerClient.from(table)
          if (table === 'ai_call_log') {
            return {
              ...original,
              // A real rejected Promise correctly implements the thenable protocol.
              // The previous version overrode `.then` to ignore its resolve/reject
              // arguments, so `await` on it never settled and the test hung until
              // the 5s timeout — a bug in this mock, not in the app code under test.
              insert: () => Promise.reject(new Error('Simulated insert failure')),
            }
          }
          return original
        },
      }

      // Call getSummaryCore with failing client
      const result = await getSummaryCore(
        failingClient as any,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Verify result is still returned (even though log insert failed)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.summary).toBe('Valid summary')
      }

      // Verify console.error was called with context
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('ai_call_log insert failed'),
        expect.any(Object),
        expect.any(Error)
      )

      consoleErrorSpy.mockRestore()
    })
  })

  describe('entry ordering and prompt construction', () => {
    it('assembles prompt with entries in oldest-to-newest order', async () => {
      // Setup: create entries out of order
      const entry3Id = await insertJournalEntry(targetClient, targetId, 'Entry 3 (today)', 0)
      const entry1Id = await insertJournalEntry(targetClient, targetId, 'Entry 1 (2 days ago)', 2)
      const entry2Id = await insertJournalEntry(targetClient, targetId, 'Entry 2 (1 day ago)', 1)

      // Mock generator that captures the prompt
      let capturedPrompt = ''
      const mockGenerator: CompletionGenerator = vi.fn(async (system, user) => {
        capturedPrompt = user
        return {
          output: JSON.stringify({
            summary: 'Summary of entries in order',
            citations: [entry1Id],
          }),
          tokensIn: 100,
          tokensOut: 50,
          latencyMs: 1500,
        }
      })

      // Call getSummaryCore
      await getSummaryCore(
        callerClient,
        callerId,
        targetId,
        'gpt-4-turbo',
        mockGenerator
      )

      // Verify prompt contains entries in correct order
      const entry1Index = capturedPrompt.indexOf('Entry 1')
      const entry2Index = capturedPrompt.indexOf('Entry 2')
      const entry3Index = capturedPrompt.indexOf('Entry 3')

      expect(entry1Index).toBeLessThan(entry2Index)
      expect(entry2Index).toBeLessThan(entry3Index)

      // Verify all entry IDs are listed
      expect(capturedPrompt).toContain(`"${entry1Id}"`)
      expect(capturedPrompt).toContain(`"${entry2Id}"`)
      expect(capturedPrompt).toContain(`"${entry3Id}"`)
    })
  })
})
