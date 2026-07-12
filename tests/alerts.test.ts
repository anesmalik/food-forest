/**
 * T4.2 Alert Dashboard Tests
 *
 * Tests for alert server actions (getMyAlerts, dismissAlert, getTasksForAlerts).
 * Verifies RLS scoping, dismissal behavior, and UI data retrieval.
 *
 * Configure via env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY
 *   SUPABASE_JWT_SECRET
 *
 * Run: npx vitest run tests/alerts.test.ts
 */

import { describe, beforeAll, afterAll, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'
import ws from 'ws'

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

function authClient(jwt: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { params: { eventsPerSecond: 0 }, transport: ws },
    accessToken: async () => jwt,
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  realtime: { params: { eventsPerSecond: 0 }, transport: ws },
  auth: { persistSession: false, autoRefreshToken: false },
})

const ts = Date.now()
const supervisor1ClerkId = `clerk-supervisor1-${ts}`
const supervisor2ClerkId = `clerk-supervisor2-${ts}`
const reportClerkId = `clerk-report-${ts}`

const SUPERVISOR1_JWT = signTestJwt(supervisor1ClerkId)
const SUPERVISOR2_JWT = signTestJwt(supervisor2ClerkId)
const REPORT_JWT = signTestJwt(reportClerkId)

let supervisor1Id: string
let supervisor2Id: string
let reportId: string
let taskId: string
let alertId: string

async function insertUser(clerkId: string, email: string, displayName: string) {
  const { data, error } = await admin
    .from('users')
    .insert({ clerk_id: clerkId, email, display_name: displayName })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to insert user: ${error.message}`)
  return data.id
}

async function setSupervisor(userId: string, supervisorId: string) {
  const { error } = await admin
    .from('users')
    .update({ supervisor_id: supervisorId })
    .eq('id', userId)
  if (error) throw new Error(`Failed to set supervisor: ${error.message}`)
}

async function createTask(assignerId: string, assigneeId: string) {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() - 5) // 5 days overdue
  const dueDateStr = dueDate.toISOString().split('T')[0]

  const { data, error } = await admin
    .from('tasks')
    .insert({
      title: 'Test Overdue Task',
      description: 'Test task',
      assigner_id: assignerId,
      assignee_id: assigneeId,
      state: 'assigned',
      due_date: dueDateStr,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create task: ${error.message}`)
  return data.id
}

async function createAlert(taskId: string) {
  const { data, error } = await admin
    .from('task_alerts')
    .insert({
      task_id: taskId,
      alert_type: 'overdue_quiet',
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create alert: ${error.message}`)
  return data.id
}

async function deleteUser(id: string) {
  try {
    await admin.from('task_alerts').delete().eq('id', 'not-null').catch(() => {})
    await admin.from('tasks').delete().in('assigner_id', [id]).catch(() => {})
    await admin.from('tasks').delete().in('assignee_id', [id]).catch(() => {})
    await admin.from('users').delete().eq('id', id).catch(() => {})
  } catch (e) {
    // Ignore errors during cleanup
  }
}

beforeAll(async () => {
  // Clean up any existing test users
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .in('clerk_id', [supervisor1ClerkId, supervisor2ClerkId, reportClerkId])
  if (existing && existing.length > 0) {
    for (const user of existing) {
      await deleteUser(user.id)
    }
  }

  supervisor1Id = await insertUser(supervisor1ClerkId, `supervisor1-${ts}@test.local`, 'Supervisor 1')
  supervisor2Id = await insertUser(supervisor2ClerkId, `supervisor2-${ts}@test.local`, 'Supervisor 2')
  reportId = await insertUser(reportClerkId, `report-${ts}@test.local`, 'Test Report')

  // Set up hierarchy: supervisor1 supervises report
  // supervisor2 is unrelated
  await setSupervisor(reportId, supervisor1Id)

  // Create task and alert for supervisor1's report
  taskId = await createTask(supervisor1Id, reportId)
  alertId = await createAlert(taskId)
}, 30000)

afterAll(async () => {
  for (const id of [supervisor1Id, supervisor2Id, reportId]) {
    if (id) await deleteUser(id)
  }
})

describe('Alert Dashboard (T4.2)', () => {
  describe('getMyAlerts RLS', () => {
    it('supervisor sees alerts for their subtree', async () => {
      const client = authClient(SUPERVISOR1_JWT)

      const { data, error } = await client
        .from('task_alerts')
        .select('*')
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(data!.length).toBeGreaterThan(0)
      expect(data!.some((a) => a.id === alertId)).toBe(true)
    })

    it('unrelated supervisor sees no alerts', async () => {
      const client = authClient(SUPERVISOR2_JWT)

      const { data, error } = await client
        .from('task_alerts')
        .select('*')
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // supervisor2 should not see alerts from supervisor1's subtree
      expect(data!.some((a) => a.id === alertId)).toBe(false)
    })
  })

  describe('dismissAlert behavior', () => {
    it('authorized user can dismiss alert', async () => {
      const client = authClient(SUPERVISOR1_JWT)

      const { data, error } = await client
        .from('task_alerts')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', alertId)
        .select()
        .single()

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(data!.dismissed_at).not.toBeNull()
    })

    it('dismissed alert does not appear in getMyAlerts', async () => {
      const client = authClient(SUPERVISOR1_JWT)

      const { data, error } = await client
        .from('task_alerts')
        .select('*')
        .is('dismissed_at', null)
        .eq('id', alertId)

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      // Alert should not appear in active alerts list
      expect(data!.length).toBe(0)
    })

    it('unauthorized user cannot dismiss alert', async () => {
      // Create a new alert for this test
      const newTaskId = await createTask(supervisor1Id, reportId)
      const newAlertId = await createAlert(newTaskId)

      const client = authClient(SUPERVISOR2_JWT)

      const { data, error } = await client
        .from('task_alerts')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', newAlertId)
        .select()
        .single()

      // RLS should reject this
      expect(error).not.toBeNull()
      expect(data).toBeNull()

      // Verify alert is still active
      const { data: activeAlert } = await admin
        .from('task_alerts')
        .select('*')
        .eq('id', newAlertId)
        .single()

      expect(activeAlert!.dismissed_at).toBeNull()
    })

    it('cannot re-dismiss an alert', async () => {
      // Already dismissed alertId in earlier test
      const client = authClient(SUPERVISOR1_JWT)

      const { error } = await client
        .from('task_alerts')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', alertId)

      // The DB trigger enforce_task_alerts_dismiss_only should reject this
      expect(error).not.toBeNull()
    })
  })

  describe('getTasksForAlerts data retrieval', () => {
    it('fetches task data for alerts', async () => {
      const { data, error } = await admin
        .from('tasks')
        .select('id, title, due_date, assignee_id, state')
        .in('id', [taskId])

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(data!.length).toBe(1)
      expect(data![0].id).toBe(taskId)
      expect(data![0].title).toBe('Test Overdue Task')
      expect(data![0].assignee_id).toBe(reportId)
      expect(data![0].state).toBe('assigned')
    })

    it('handles empty task list', async () => {
      const { data, error } = await admin
        .from('tasks')
        .select('id, title, due_date, assignee_id, state')
        .in('id', [])

      expect(error).toBeNull()
      expect(data).not.toBeNull()
      expect(data!.length).toBe(0)
    })
  })
})
