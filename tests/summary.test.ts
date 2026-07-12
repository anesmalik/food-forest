/**
 * T2.2 — Summary Retrieval Tests
 *
 * Tests the retrieveSummaryEntries core function with focus on:
 * 1. Correct retrieval of entries within the 30-day/50-entry bound
 * 2. RLS boundary enforcement (access control via the journal_entries_select policy)
 * 3. Ordering (oldest-to-newest for chronological summaries)
 * 4. Soft-deletion exclusion
 *
 * These tests run against a real Supabase instance (local or remote).
 * Configure via env vars:
 *   SUPABASE_URL              — project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (for setup/teardown)
 *   SUPABASE_ANON_KEY         — anon key (for authenticated client)
 *   SUPABASE_JWT_SECRET       — JWT signing secret
 *
 * Run: npx vitest run tests/summary.test.ts
 */

import { describe, beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'
import ws from 'ws'
import { retrieveSummaryEntries } from '../lib/summary-retrieval'
import { validateCitedSummary } from '../lib/citation-validator'

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
const superClerkId = `clerk-super-${ts}`
const reportClerkId = `clerk-report-${ts}`
const outsideClerkId = `clerk-outside-${ts}`

const SUPER_JWT = signTestJwt(superClerkId)
const REPORT_JWT = signTestJwt(reportClerkId)
const OUTSIDE_JWT = signTestJwt(outsideClerkId)

// Fixture entries must be inserted as their own author (RLS requirement — see
// insertJournalEntry below), so these are needed at setup time, not just for the
// assertions.
const reportClient = authClient(REPORT_JWT)
const outsideClient = authClient(OUTSIDE_JWT)

let superId: string
let reportId: string
let outsideId: string

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
// can insert, and RLS restricts it to author_id = current_app_user(). Fixture setup
// must insert as the entry's own author, matching the real app's only write path.
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
      author_id: userId,
      body,
      sensitivity: 'normal',
      created_at: createdAt,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to insert journal entry: ${error.message}`)
  return data.id
}

// Same T1.1b grants gap as insertJournalEntry: journal_entries UPDATE is authenticated-only
// (author-scoped via RLS), no service_role grant. Soft-delete as the entry's own author.
async function softDeleteJournalEntry(client: ReturnType<typeof authClient>, entryId: string) {
  const { error } = await client
    .from('journal_entries')
    .update({ soft_deleted_at: new Date().toISOString() })
    .eq('id', entryId)

  if (error) throw new Error(`Failed to soft-delete entry: ${error.message}`)
}

describe('retrieveSummaryEntries', () => {
  beforeAll(async () => {
    // Setup: create three users
    // - super: supervisor
    // - report: direct report of super (accessible via RLS)
    // - outside: unrelated user (NOT in super's subtree)
    superId = await insertUser(superClerkId, 'super@test.local', 'Supervisor')
    reportId = await insertUser(reportClerkId, 'report@test.local', 'Reporter', superId)
    outsideId = await insertUser(outsideClerkId, 'outside@test.local', 'Outside', null) // no supervisor
  })

  afterAll(async () => {
    // Cleanup: delete test users and their entries
    // (Supabase cascade should handle entries, but be explicit)
    if (superId) {
      await admin.from('journal_entries').delete().eq('author_id', superId)
      await admin.from('users').delete().eq('id', superId)
    }
    if (reportId) {
      await admin.from('journal_entries').delete().eq('author_id', reportId)
      await admin.from('users').delete().eq('id', reportId)
    }
    if (outsideId) {
      await admin.from('journal_entries').delete().eq('author_id', outsideId)
      await admin.from('users').delete().eq('id', outsideId)
    }
  })

  describe('basic retrieval', () => {
    it('retrieves entries for a user with recent journal activity', async () => {
      // Create some entries for reportId
      const entry1Id = await insertJournalEntry(reportClient, reportId, 'Entry from 10 days ago', 10)
      const entry2Id = await insertJournalEntry(reportClient, reportId, 'Entry from 5 days ago', 5)
      const entry3Id = await insertJournalEntry(reportClient, reportId, 'Entry from today', 0)

      // Call the function as the supervisor (RLS enforced via the authenticated client)
      const supervisorClient = authClient(SUPER_JWT)
      const entries = await retrieveSummaryEntries(supervisorClient, reportId)

      expect(entries).not.toBeNull()
      expect(entries.length).toBeGreaterThanOrEqual(3)

      // Verify entries are present and ordered oldest-to-newest
      const ids = entries.map((e) => e.id)
      expect(ids).toContain(entry1Id)
      expect(ids).toContain(entry2Id)
      expect(ids).toContain(entry3Id)

      // Verify order is ascending (oldest first)
      const dates = entries.map((e) => new Date(e.created_at).getTime())
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1])
      }
    })

    it('excludes soft-deleted entries', async () => {
      // Create a live entry and a soft-deleted entry
      const liveId = await insertJournalEntry(reportClient, reportId, 'This stays', 2)
      const deletedId = await insertJournalEntry(reportClient, reportId, 'This will be deleted', 3)
      await softDeleteJournalEntry(reportClient, deletedId)

      // Call the function as supervisor
      const supervisorClient = authClient(SUPER_JWT)
      const entries = await retrieveSummaryEntries(supervisorClient, reportId)

      const ids = entries.map((e) => e.id)
      expect(ids).toContain(liveId)
      expect(ids).not.toContain(deletedId)
    })
  })

  describe('RLS boundary enforcement', () => {
    it('allows supervisor to query their direct report', async () => {
      const entry1Id = await insertJournalEntry(reportClient, reportId, 'Supervisor can see this', 5)

      const supervisorClient = authClient(SUPER_JWT)
      const entries = await retrieveSummaryEntries(supervisorClient, reportId)

      expect(entries.length).toBeGreaterThan(0)
      expect(entries.map((e) => e.id)).toContain(entry1Id)
    })

    it('denies access to user outside supervisor subtree', async () => {
      const entry1Id = await insertJournalEntry(outsideClient, outsideId, 'Outside user entry', 5)

      const supervisorClient = authClient(SUPER_JWT)
      const entries = await retrieveSummaryEntries(supervisorClient, outsideId)

      // RLS should return empty array (correct refusal via RLS boundary)
      expect(entries.length).toBe(0)

      // Contrast: journal_entries has no service_role grant at all (T1.1b — authenticated-only
      // by design), so service-role can't be used to prove "RLS boundary, not a broken query."
      // Use the entry's own author reading their own entry instead — proves the query itself
      // is capable of returning rows, and the supervisor's empty result above is RLS denying
      // access, not a query bug.
      const selfEntries = await retrieveSummaryEntries(outsideClient, outsideId)
      expect(selfEntries.length).toBeGreaterThan(0)
      expect(selfEntries.map((e) => e.id)).toContain(entry1Id)
    })

    it('allows user to query their own entries', async () => {
      const entry1Id = await insertJournalEntry(reportClient, reportId, 'Own entry', 2)

      const entries = await retrieveSummaryEntries(reportClient, reportId)

      expect(entries.length).toBeGreaterThan(0)
      expect(entries.map((e) => e.id)).toContain(entry1Id)
    })
  })

  describe('window bounds', () => {
    it('respects the 30-day window bound', async () => {
      // This test verifies the date filtering works.
      // We can't easily test "last 30 days OR last 50 entries" without creating
      // many entries, but we can verify that old entries are filtered out.
      const recentId = await insertJournalEntry(reportClient, reportId, 'Within 30 days', 10)
      const oldId = await insertJournalEntry(reportClient, reportId, 'Beyond 30 days', 40)

      const supervisorClient = authClient(SUPER_JWT)
      const entries = await retrieveSummaryEntries(supervisorClient, reportId)

      const ids = entries.map((e) => e.id)
      expect(ids).toContain(recentId)
      expect(ids).not.toContain(oldId)
    })

    it('respects the 50-entry limit', async () => {
      // Create 60 entries and verify only 50 are returned
      const entryIds: string[] = []
      for (let i = 0; i < 60; i++) {
        const id = await insertJournalEntry(
          reportClient,
          reportId,
          `Entry ${i}`,
          Math.floor(i / 2) // spread them across 30 days
        )
        entryIds.push(id)
      }

      const supervisorClient = authClient(SUPER_JWT)
      const entries = await retrieveSummaryEntries(supervisorClient, reportId)

      // Should get at most 50
      expect(entries.length).toBeLessThanOrEqual(50)
    })
  })
})

describe('check_recent_summary_call RPC', () => {
  let callerId: string
  let targetId: string

  beforeAll(async () => {
    callerId = await insertUser(`clerk-rpc-caller-${ts}`, 'caller@test.local', 'Caller')
    targetId = await insertUser(`clerk-rpc-target-${ts}`, 'target@test.local', 'Target')
  })

  // Each test's own ai_call_log inserts (or the deliberate setup rows) otherwise leak
  // into the next test's 5-minute window and produce false positives/negatives —
  // same isolation gap as get-summary.test.ts.
  beforeEach(async () => {
    await admin.from('ai_call_log').delete().eq('user_id', callerId).eq('query', targetId)
  })

  afterAll(async () => {
    if (callerId) {
      await admin.from('ai_call_log').delete().eq('user_id', callerId)
      await admin.from('users').delete().eq('id', callerId)
    }
    if (targetId) {
      await admin.from('users').delete().eq('id', targetId)
    }
  })

  it('authenticated user can execute the function', async () => {
    const callerJwt = signTestJwt(`clerk-rpc-caller-${ts}`)
    const callerClient = authClient(callerJwt)

    const { data, error } = await callerClient.rpc('check_recent_summary_call', {
      target_user_id: targetId,
    })

    expect(error).toBeNull()
    expect(typeof data).toBe('boolean')
  })

  it('returns false when no recent call exists', async () => {
    const callerJwt = signTestJwt(`clerk-rpc-caller-${ts}`)
    const callerClient = authClient(callerJwt)

    const { data, error } = await callerClient.rpc('check_recent_summary_call', {
      target_user_id: targetId,
    })

    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('returns true when a recent call exists within the window', async () => {
    // Insert an ai_call_log row for this caller and target
    const now = new Date().toISOString()
    await admin.from('ai_call_log').insert({
      user_id: callerId,
      function: 'supervisor_summary',
      query: targetId,
      model_name: 'gpt-4-turbo',
      prompt: 'test prompt',
      response: 'test response',
      created_at: now,
    })

    const callerJwt = signTestJwt(`clerk-rpc-caller-${ts}`)
    const callerClient = authClient(callerJwt)

    const { data, error } = await callerClient.rpc('check_recent_summary_call', {
      target_user_id: targetId,
      window_minutes: 5,
    })

    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('returns false when the call is outside the window', async () => {
    // Insert a row from 10 minutes ago
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await admin.from('ai_call_log').insert({
      user_id: callerId,
      function: 'supervisor_summary',
      query: targetId,
      model_name: 'gpt-4-turbo',
      prompt: 'test',
      response: 'test',
      created_at: tenMinutesAgo,
    })

    const callerJwt = signTestJwt(`clerk-rpc-caller-${ts}`)
    const callerClient = authClient(callerJwt)

    const { data, error } = await callerClient.rpc('check_recent_summary_call', {
      target_user_id: targetId,
      window_minutes: 5,
    })

    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('does not expose row content (only returns boolean)', async () => {
    // This is implicit — the RPC is defined to return boolean only, not a full row
    // But we verify by checking that we can't ever get more than boolean type
    const callerJwt = signTestJwt(`clerk-rpc-caller-${ts}`)
    const callerClient = authClient(callerJwt)

    const { data, error } = await callerClient.rpc('check_recent_summary_call', {
      target_user_id: targetId,
    })

    expect(error).toBeNull()
    expect(typeof data).toBe('boolean')
    expect(data).not.toHaveProperty('prompt')
    expect(data).not.toHaveProperty('response')
    expect(data).not.toHaveProperty('id')
  })
})

describe('citation validator', () => {
  it('validates correct JSON with valid citations', () => {
    const entryIds = ['id-1', 'id-2', 'id-3']
    const modelOutput = JSON.stringify({
      summary: 'This is a summary',
      citations: ['id-1', 'id-3'],
    })

    const result = validateCitedSummary(modelOutput, new Set(entryIds))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary).toBe('This is a summary')
      expect(result.citations).toEqual(['id-1', 'id-3'])
    }
  })

  it('rejects fabricated citations', () => {
    const entryIds = ['id-1', 'id-2']
    const modelOutput = JSON.stringify({
      summary: 'This is a summary',
      citations: ['id-1', 'id-fake'],
    })

    const result = validateCitedSummary(modelOutput, new Set(entryIds))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('not found in retrieved set')
    }
  })

  it('rejects substantive summary with no citations', () => {
    const entryIds = ['id-1']
    const modelOutput = JSON.stringify({
      summary: 'This is a substantial summary with content',
      citations: [],
    })

    const result = validateCitedSummary(modelOutput, new Set(entryIds))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('substantive summary')
    }
  })

  it('accepts empty summary with no citations', () => {
    const entryIds = ['id-1']
    const modelOutput = JSON.stringify({
      summary: '   ',
      citations: [],
    })

    const result = validateCitedSummary(modelOutput, new Set(entryIds))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.summary.trim()).toBe('')
      expect(result.citations).toEqual([])
    }
  })

  it('rejects invalid JSON', () => {
    const modelOutput = 'not json at all'

    const result = validateCitedSummary(modelOutput, new Set(['id-1']))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('not valid JSON')
    }
  })

  it('rejects missing summary key', () => {
    const modelOutput = JSON.stringify({
      citations: ['id-1'],
    })

    const result = validateCitedSummary(modelOutput, new Set(['id-1']))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('missing the summary key')
    }
  })

  it('rejects missing citations key', () => {
    const modelOutput = JSON.stringify({
      summary: 'Test summary',
    })

    const result = validateCitedSummary(modelOutput, new Set(['id-1']))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('missing the citations key')
    }
  })
})
