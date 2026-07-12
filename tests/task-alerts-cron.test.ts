/**
 * T2.5 Task-Alerts Cron Tests
 *
 * These tests run against a real Supabase instance and test the task-alerts cron
 * for both alert (24h) and missed (7d) transitions.
 *
 * Configure via env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *   CRON_SECRET
 *
 * Run: npx vitest run tests/task-alerts-cron.test.ts
 */

import { describe, beforeAll, afterAll, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
const CRON_SECRET =
  process.env.CRON_SECRET ||
  '71d85f4bb3f3e821f41b6b5b76dfce34a5957e55962cc3dbb38da845310afae4'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  realtime: { params: { eventsPerSecond: 0 }, transport: ws },
  auth: { persistSession: false, autoRefreshToken: false },
})

const cronBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

let testAssignerId: string
let testAssigneeId: string

async function createTestUser(email: string) {
  const { data, error } = await admin
    .from('users')
    .insert({
      clerk_id: `test-clerk-${Date.now()}-${Math.random()}`,
      email,
      display_name: 'Test User',
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create test user: ${error.message}`)
  return data.id
}

async function createTask(
  assignerId: string,
  assigneeId: string,
  daysOverdue: number,
  state: 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'missed' = 'assigned'
) {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() - daysOverdue)
  const dueDateStr = dueDate.toISOString().split('T')[0]

  const { data, error } = await admin
    .from('tasks')
    .insert({
      title: `Test task overdue by ${daysOverdue} days`,
      description: 'Test task',
      assigner_id: assignerId,
      assignee_id: assigneeId,
      due_date: dueDateStr,
      state,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create task: ${error.message}`)
  return data.id
}

async function createJournalEntry(authorId: string, taskId?: string | null, hoursAgo: number = 0) {
  const createdAt = new Date()
  createdAt.setHours(createdAt.getHours() - hoursAgo)

  const { data, error } = await admin
    .from('journal_entries')
    .insert({
      author_id: authorId,
      task_id: taskId,
      body: 'Test journal entry',
      sensitivity: 'normal',
      created_at: createdAt.toISOString(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create journal entry: ${error.message}`)
  return data.id
}

async function callCronEndpoint(authHeader?: string): Promise<Response> {
  const url = `${cronBaseUrl}/api/cron/task-alerts`
  const headers: Record<string, string> = {}

  if (authHeader) {
    headers['authorization'] = authHeader
  }

  return fetch(url, { method: 'GET', headers })
}

async function getTaskAlert(taskId: string) {
  const { data, error } = await admin
    .from('task_alerts')
    .select('*')
    .eq('task_id', taskId)
    .eq('alert_type', 'overdue_quiet')
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows found
    throw error
  }

  return data || null
}

async function getTaskState(taskId: string) {
  const { data, error } = await admin
    .from('tasks')
    .select('state')
    .eq('id', taskId)
    .single()

  if (error) throw error
  return data.state
}

async function getUsageEventCount(eventType: string, taskId?: string) {
  let query = admin
    .from('usage_events')
    .select('*')
    .eq('event_type', eventType)

  if (taskId) {
    query = query.filter('metadata->>task_id', 'eq', taskId)
  }

  const { data, error } = await query

  if (error) throw error
  return data?.length || 0
}

describe('task-alerts cron (T2.5)', () => {
  beforeAll(async () => {
    testAssignerId = await createTestUser(`assigner-${Date.now()}@test.com`)
    testAssigneeId = await createTestUser(`assignee-${Date.now()}@test.com`)
  })

  afterAll(async () => {
    // Clean up test data
    if (testAssignerId && testAssigneeId) {
      await admin.from('task_alerts').delete().eq('id', 'not-null')
      await admin.from('journal_entries').delete().in('author_id', [testAssignerId, testAssigneeId])
      await admin.from('tasks').delete().in('assignee_id', [testAssigneeId])
      await admin.from('users').delete().in('id', [testAssignerId, testAssigneeId])
    }
  })

  describe('authentication', () => {
    it('returns 401 on missing auth header', async () => {
      const res = await callCronEndpoint()
      expect(res.status).toBe(401)
    })

    it('returns 401 on invalid CRON_SECRET', async () => {
      const res = await callCronEndpoint('Bearer invalid-secret')
      expect(res.status).toBe(401)
    })

    it('accepts correct CRON_SECRET', async () => {
      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)
    })
  })

  describe('alert path (24h threshold)', () => {
    it('creates alert for overdue+quiet task in assigned state', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 30, 'assigned')

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alert = await getTaskAlert(taskId)
      expect(alert).not.toBeNull()
      expect(alert?.alert_type).toBe('overdue_quiet')
      expect(alert?.dismissed_at).toBeNull()
    })

    it('creates alert for overdue+quiet task in in_progress state', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 30, 'in_progress')

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alert = await getTaskAlert(taskId)
      expect(alert).not.toBeNull()
      expect(alert?.alert_type).toBe('overdue_quiet')
    })

    it('does not create alert for task due today', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 0, 'assigned')

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alert = await getTaskAlert(taskId)
      expect(alert).toBeNull()
    })

    it('creates alert for task overdue by 2+ days', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 3, 'assigned')

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alert = await getTaskAlert(taskId)
      expect(alert).not.toBeNull()
    })

    it('does not create alert if assignee has recent journal entry', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 30, 'assigned')
      // Create a journal entry within 48h
      await createJournalEntry(testAssigneeId, null, 24)

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alert = await getTaskAlert(taskId)
      expect(alert).toBeNull()
    })
  })

  describe('idempotency', () => {
    it('does not create duplicate alert on second run', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 30, 'assigned')

      // First run
      let res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alertBefore = await getTaskAlert(taskId)
      expect(alertBefore).not.toBeNull()

      // Second run
      res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alertAfter = await getTaskAlert(taskId)
      expect(alertAfter).not.toBeNull()
      expect(alertAfter?.id).toBe(alertBefore?.id)
    })
  })

  describe('dismiss behavior', () => {
    it('does not re-fire alert after dismissal', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 30, 'assigned')

      // First run: create alert
      let res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alert = await getTaskAlert(taskId)
      expect(alert).not.toBeNull()

      // Dismiss the alert
      const now = new Date().toISOString()
      await admin
        .from('task_alerts')
        .update({ dismissed_at: now })
        .eq('id', alert!.id)

      // Second run: alert should still be dismissed, not recreated
      res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const alertAfter = await getTaskAlert(taskId)
      expect(alertAfter).not.toBeNull()
      expect(alertAfter?.dismissed_at).not.toBeNull()
      expect(alertAfter?.id).toBe(alert?.id)
    })
  })

  describe('missed path (7 day threshold)', () => {
    it('transitions task to missed after 7 days overdue+quiet', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 8, 'assigned')

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const state = await getTaskState(taskId)
      expect(state).toBe('missed')
    })

    it('does not transition task if it has recent journal entry', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 8, 'assigned')
      // Create a journal entry within 48h
      await createJournalEntry(testAssigneeId, null, 24)

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const state = await getTaskState(taskId)
      expect(state).not.toBe('missed')
    })
  })

  describe('race conditions', () => {
    it('handles task completed between select and expire_task', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 8, 'assigned')

      // Simulate task completion before expire_task is called
      // by manually setting it to completed
      await admin
        .from('tasks')
        .update({ state: 'completed', completed_at: new Date().toISOString() })
        .eq('id', taskId)

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const state = await getTaskState(taskId)
      expect(state).toBe('completed')
    })

    it('continues processing after stale row', async () => {
      // Create one stale task and one fresh one
      const staleTaskId = await createTask(testAssignerId, testAssigneeId, 8, 'completed')
      const freshTaskId = await createTask(testAssignerId, testAssigneeId, 8, 'assigned')

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      // Stale task should remain completed
      const staleState = await getTaskState(staleTaskId)
      expect(staleState).toBe('completed')

      // Fresh task should transition to missed
      const freshState = await getTaskState(freshTaskId)
      expect(freshState).toBe('missed')
    })
  })

  describe('telemetry', () => {
    it('logs alert_fired event for new alert', async () => {
      const taskId = await createTask(testAssignerId, testAssigneeId, 30, 'assigned')

      const countBefore = await getUsageEventCount('alert_fired', taskId)
      expect(countBefore).toBe(0)

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const countAfter = await getUsageEventCount('alert_fired', taskId)
      expect(countAfter).toBeGreaterThan(0)
    })

    it('logs task_missed event only for actual transition', async () => {
      // Task already completed
      const alreadyCompletedTaskId = await createTask(
        testAssignerId,
        testAssigneeId,
        8,
        'completed'
      )
      // Fresh task to expire
      const freshTaskId = await createTask(testAssignerId, testAssigneeId, 8, 'assigned')

      const countBefore = await getUsageEventCount('task_missed')

      const res = await callCronEndpoint(`Bearer ${CRON_SECRET}`)
      expect(res.status).toBe(200)

      const countAfter = await getUsageEventCount('task_missed')
      // Should have logged one for freshTaskId, not for alreadyCompletedTaskId
      expect(countAfter).toBeGreaterThan(countBefore)

      // Verify the event is for the correct task
      const events = await admin
        .from('usage_events')
        .select('*')
        .eq('event_type', 'task_missed')
        .order('created_at', { ascending: false })
        .limit(1)

      expect(events.data?.[0]?.metadata?.task_id).toBe(freshTaskId)
    })
  })
})
