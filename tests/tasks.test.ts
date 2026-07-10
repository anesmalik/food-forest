/**
 * Stage One Step 4 — Task State Machine Tests
 *
 * Full transition matrix validation: tests every from/to pair in the spec.
 * Assertions are on rejection, not error text (illegal-edge-going-legal is the
 * regression; string assertions are brittle noise).
 */

import { describe, beforeAll, afterAll, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'
import ws from 'ws'

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'
const BOOTSTRAP_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@test.local'

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

const ts = Date.now()
const assignerClerkId = `clerk-assigner-${ts}`
const assigneeClerkId = `clerk-assignee-${ts}`
const thirdClerkId = `clerk-third-${ts}`

const ASSIGNER_JWT = signTestJwt(assignerClerkId)
const ASSIGNEE_JWT = signTestJwt(assigneeClerkId)
const THIRD_JWT = signTestJwt(thirdClerkId)

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

let assignerId: string
let assigneeId: string
let thirdId: string

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

async function deleteUser(id: string) {
  try {
    await admin.from('tasks').delete().in('assigner_id', [id]).catch(() => {})
    await admin.from('tasks').delete().in('assignee_id', [id]).catch(() => {})
    await admin.from('usage_events').delete().eq('user_id', id).catch(() => {})
    await admin.from('users').delete().eq('id', id).catch(() => {})
  } catch (e) {
    // Ignore errors during cleanup
  }
}

async function createTask(assignerId: string, assignerClient: any, assignee: string, state: string = 'assigned') {
  const { data, error } = await assignerClient
    .from('tasks')
    .insert({
      title: `Test Task`,
      description: 'Test',
      assigner_id: assignerId,
      assignee_id: assignee,
      state,
      due_date: new Date().toISOString().split('T')[0],
    })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to create task: ${error.message}`)
  return data.id
}

async function getTask(taskId: string) {
  const { data, error } = await admin
    .from('tasks')
    .select('id, state, completed_at, assignee_id')
    .eq('id', taskId)
    .single()
  if (error) throw new Error(`Failed to fetch task: ${error.message}`)
  return data
}

async function transitionTask(client: any, taskId: string, newState: string) {
  return await client
    .from('tasks')
    .update({ state: newState })
    .eq('id', taskId)
}

beforeAll(async () => {
  // Clean up any existing test users
  const { data: existing } = await admin.from('users').select('id').in('clerk_id', [assignerClerkId, assigneeClerkId, thirdClerkId])
  if (existing && existing.length > 0) {
    for (const user of existing) {
      await deleteUser(user.id)
    }
  }

  assignerId = await insertUser(assignerClerkId, 'assigner@test.local', 'Test Assigner')
  assigneeId = await insertUser(assigneeClerkId, 'assignee@test.local', 'Test Assignee')
  thirdId = await insertUser(thirdClerkId, 'third@test.local', 'Test Third')

  // Set up supervisor hierarchy: assigner supervises assignee and third
  await setSupervisor(assigneeId, assignerId)
  await setSupervisor(thirdId, assignerId)
}, 30000)

afterAll(async () => {
  for (const id of [assignerId, assigneeId, thirdId]) {
    if (id) await deleteUser(id)
  }
})

describe('Task State Machine — Full Transition Matrix', () => {
  describe('Legal transitions', () => {
    it('assigned → in_progress: assignee only', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'in_progress')
      expect(error).toBeNull()

      const task = await getTask(taskId)
      expect(task.state).toBe('in_progress')
    })

    it('assigned → completed: assignee only, sets completed_at', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'completed')
      expect(error).toBeNull()

      const task = await getTask(taskId)
      expect(task.state).toBe('completed')
      expect(task.completed_at).not.toBeNull()
    })

    it('assigned → cancelled: assigner only', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')

      const { error } = await transitionTask(assignerClient, taskId, 'cancelled')
      expect(error).toBeNull()

      const task = await getTask(taskId)
      expect(task.state).toBe('cancelled')
    })

    it('in_progress → completed: assignee only, sets completed_at', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'in_progress')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'completed')
      expect(error).toBeNull()

      const task = await getTask(taskId)
      expect(task.state).toBe('completed')
      expect(task.completed_at).not.toBeNull()
    })

    it('in_progress → cancelled: assigner only', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'in_progress')

      const { error } = await transitionTask(assignerClient, taskId, 'cancelled')
      expect(error).toBeNull()

      const task = await getTask(taskId)
      expect(task.state).toBe('cancelled')
    })
  })

  describe('Actor rejection on legal edges', () => {
    it('assigned → in_progress: assigner cannot transition', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')

      const { error } = await transitionTask(assignerClient, taskId, 'in_progress')
      expect(error).not.toBeNull()
    })

    it('assigned → in_progress: third party cannot transition', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const thirdClient = authClient(THIRD_JWT)

      const { error } = await transitionTask(thirdClient, taskId, 'in_progress')

      // Check if state actually changed in DB (security test)
      const task = await getTask(taskId)
      console.log(`DEBUG: third-party update error: ${error ? 'error' : 'no error'}, DB state after: ${task.state}`)

      // The security boundary holds if either:
      // 1. There's an explicit error, OR
      // 2. The state didn't actually change (RLS filtered the update, zero rows affected)
      if (error) {
        expect(error).not.toBeNull()
      } else {
        expect(task.state).toBe('assigned')  // State should be unchanged if RLS blocked it
      }
    })

    it('assigned → completed: assigner cannot transition', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')

      const { error } = await transitionTask(assignerClient, taskId, 'completed')
      expect(error).not.toBeNull()
    })

    it('assigned → cancelled: assignee cannot transition', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'cancelled')
      expect(error).not.toBeNull()
    })

    it('assigned → cancelled: third party cannot transition', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const thirdClient = authClient(THIRD_JWT)

      const { error } = await transitionTask(thirdClient, taskId, 'cancelled')

      // Check if state actually changed in DB (security test)
      const task = await getTask(taskId)
      console.log(`DEBUG: third-party update error: ${error ? 'error' : 'no error'}, DB state after: ${task.state}`)

      // The security boundary holds if either:
      // 1. There's an explicit error, OR
      // 2. The state didn't actually change (RLS filtered the update, zero rows affected)
      if (error) {
        expect(error).not.toBeNull()
      } else {
        expect(task.state).toBe('assigned')  // State should be unchanged if RLS blocked it
      }
    })

    it('in_progress → completed: assigner cannot transition', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'in_progress')

      const { error } = await transitionTask(assignerClient, taskId, 'completed')
      expect(error).not.toBeNull()
    })

    it('in_progress → cancelled: assignee cannot transition', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'in_progress')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'cancelled')
      expect(error).not.toBeNull()
    })
  })

  describe('Illegal transitions (self-loops)', () => {
    it('assigned → assigned: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'assigned')
      expect(error).not.toBeNull()
    })

    it('in_progress → in_progress: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'in_progress')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'in_progress')
      expect(error).not.toBeNull()
    })

    it('completed → completed: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'completed')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'completed')
      expect(error).not.toBeNull()
    })

    it('cancelled → cancelled: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'cancelled')

      const { error } = await transitionTask(assignerClient, taskId, 'cancelled')
      expect(error).not.toBeNull()
    })
  })

  describe('Terminal state rejection', () => {
    it('completed → assigned: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'completed')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'assigned')
      expect(error).not.toBeNull()
    })

    it('completed → in_progress: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'completed')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'in_progress')
      expect(error).not.toBeNull()
    })

    it('completed → cancelled: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'completed')

      const { error } = await transitionTask(assignerClient, taskId, 'cancelled')
      expect(error).not.toBeNull()
    })

    it('cancelled → assigned: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'cancelled')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'assigned')
      expect(error).not.toBeNull()
    })

    it('cancelled → in_progress: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'cancelled')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'in_progress')
      expect(error).not.toBeNull()
    })

    it('cancelled → completed: rejected', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'cancelled')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'completed')
      expect(error).not.toBeNull()
    })
  })

  describe('missed state: unreachable', () => {
    it('assigned → missed: rejected for all users', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'missed')
      expect(error).not.toBeNull()
    })

    it('missed → any: rejected from missed terminal state', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'missed')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await transitionTask(assigneeClient, taskId, 'assigned')
      expect(error).not.toBeNull()
    })

    it('assigned → missed: rejected via service-role', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')

      const { error } = await admin
        .from('tasks')
        .update({ state: 'missed' })
        .eq('id', taskId)
      expect(error).not.toBeNull()
    })
  })

  describe('completed_at column behavior', () => {
    it('completed_at is null on newly created task', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const task = await getTask(taskId)
      expect(task.completed_at).toBeNull()
    })

    it('completed_at is null when moving from assigned to in_progress', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      await transitionTask(assigneeClient, taskId, 'in_progress')
      const task = await getTask(taskId)
      expect(task.completed_at).toBeNull()
    })

    it('completed_at is set exactly once on completion', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      await transitionTask(assigneeClient, taskId, 'completed')
      const task1 = await getTask(taskId)
      const firstCompletedAt = task1.completed_at

      expect(firstCompletedAt).not.toBeNull()

      // Try to transition from completed to completed (should fail anyway)
      await transitionTask(assigneeClient, taskId, 'completed')
      const task2 = await getTask(taskId)

      // If we somehow got here, completed_at should not have changed
      expect(task2.completed_at).toBe(firstCompletedAt)
    })

    it('completed_at is null when cancelling', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'in_progress')

      await transitionTask(assignerClient, taskId, 'cancelled')
      const task = await getTask(taskId)
      expect(task.completed_at).toBeNull()
    })
  })

  describe('Service-role trigger enforcement', () => {
    it('trigger rejects illegal edge even via service-role', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'completed')

      const { error } = await admin
        .from('tasks')
        .update({ state: 'assigned' })
        .eq('id', taskId)
      expect(error).not.toBeNull()
    })

    it('trigger rejects actor checks via service-role', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')

      // Try to have service-role move to in_progress (should fail - wrong actor)
      const { error } = await admin
        .from('tasks')
        .update({ state: 'in_progress' })
        .eq('id', taskId)
      expect(error).not.toBeNull()
    })
  })

  describe('Non-state column mutability', () => {
    it('assigner can edit title while assigned', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')

      const { error } = await assignerClient
        .from('tasks')
        .update({ title: 'Updated Title' })
        .eq('id', taskId)
      expect(error).toBeNull()
    })

    it('assigner can edit title while in_progress', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'in_progress')

      const { error } = await assignerClient
        .from('tasks')
        .update({ title: 'Updated Title' })
        .eq('id', taskId)
      expect(error).toBeNull()
    })

    it('assigner cannot edit title when completed', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'completed')

      const { error } = await assignerClient
        .from('tasks')
        .update({ title: 'Updated Title' })
        .eq('id', taskId)
      expect(error).not.toBeNull()
    })

    it('assignee cannot edit title', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')
      const assigneeClient = authClient(ASSIGNEE_JWT)

      const { error } = await assigneeClient
        .from('tasks')
        .update({ title: 'Updated Title' })
        .eq('id', taskId)
      expect(error).not.toBeNull()
    })

    it('assigner can edit assignee_id while assigned', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'assigned')

      const { error } = await assignerClient
        .from('tasks')
        .update({ assignee_id: thirdId })
        .eq('id', taskId)
      expect(error).toBeNull()

      const task = await getTask(taskId)
      expect(task.assignee_id).toBe(thirdId)
    })

    it('assigner cannot edit assignee_id when completed', async () => {
      const assignerClient = authClient(ASSIGNER_JWT)
      const taskId = await createTask(assignerId, assignerClient, assigneeId, 'completed')

      const { error } = await assignerClient
        .from('tasks')
        .update({ assignee_id: thirdId })
        .eq('id', taskId)
      expect(error).not.toBeNull()
    })
  })
})
