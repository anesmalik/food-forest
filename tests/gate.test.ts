/**
 * Stage One Step 1 — Six Gate Tests
 *
 * These tests run against a real Supabase instance (local or remote).
 * They are NOT mocked RLS tests. Configure via env vars:
 *
 *   SUPABASE_URL              — project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (for setup/teardown)
 *   SUPABASE_ANON_KEY         — anon key (for authenticated client)
 *   SUPABASE_TEST_JWT_ADMIN   — JWT for the admin test user
 *   SUPABASE_TEST_JWT_USER    — JWT for the non-admin test user
 *   BOOTSTRAP_ADMIN_EMAIL     — the configured bootstrap email
 *
 * Run: npx vitest run tests/gate.test.ts
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

/**
 * Sign an HS256 JWT for local Supabase testing.
 * The `sub` claim must match a `clerk_id` in the users table so that
 * `current_app_user()` can resolve the caller.
 */
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

const adminClerkId = 'clerk-admin-test-id'
const userClerkId = 'clerk-user-test-id'
const thirdClerkId = 'clerk-third-test-id'

const ADMIN_JWT = process.env.SUPABASE_TEST_JWT_ADMIN || signTestJwt(adminClerkId)
const USER_JWT = process.env.SUPABASE_TEST_JWT_USER || signTestJwt(userClerkId)

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  realtime: { params: { eventsPerSecond: 0 }, transport: ws },
  auth: { persistSession: false, autoRefreshToken: false },
})

function authClient(jwt: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    realtime: { params: { eventsPerSecond: 0 }, transport: ws },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

let adminUserId: string
let regularUserId: string
let thirdUserId: string

async function insertUser(clerkId: string, email: string, displayName: string) {
  const { data, error } = await admin
    .from('users')
    .insert({ clerk_id: clerkId, email, display_name: displayName })
    .select('id')
    .single()
  if (error) throw new Error(`Failed to insert user: ${error.message}`)
  return data.id
}

async function deleteUser(id: string) {
  await admin.from('usage_events').delete().eq('user_id', id)
  await admin.from('users').delete().eq('id', id)
}

async function getUser(id: string) {
  const { data, error } = await admin
    .from('users')
    .select('id, email, role, supervisor_id')
    .eq('id', id)
    .single()
  if (error) throw new Error(`Failed to fetch user: ${error.message}`)
  return data
}

beforeAll(async () => {
  await admin.from('users').delete().in('clerk_id', [adminClerkId, userClerkId, thirdClerkId])
  adminUserId = await insertUser(adminClerkId, BOOTSTRAP_EMAIL, 'Test Admin')
  regularUserId = await insertUser(userClerkId, 'regular@test.local', 'Test User')
  thirdUserId = await insertUser(thirdClerkId, 'third@test.local', 'Test Third')
})

afterAll(async () => {
  for (const id of [adminUserId, regularUserId, thirdUserId]) {
    if (id) await deleteUser(id)
  }
})

describe('Gate 1: Bootstrap fires for configured email on empty table', () => {
  it('promotes the configured email user to admin when zero admins exist', async () => {
    const { data: admins } = await admin.from('users').select('id').eq('role', 'admin')
    if (admins && admins.length > 0) {
      console.warn('Existing admins found. Skipping.')
      return
    }
    const { data, error } = await admin.rpc('try_bootstrap_admin', {
      target_user_id: adminUserId,
      bootstrap_email: BOOTSTRAP_EMAIL,
    })
    expect(error).toBeNull()
    expect(data).toBe('fired')
    const user = await getUser(adminUserId)
    expect(user.role).toBe('admin')
  })
})

describe('Gate 2: Bootstrap does not fire for a different identity', () => {
  it('does not promote a non-configured email user', async () => {
    const { data: admins } = await admin.from('users').select('id').eq('role', 'admin')
    if (admins && admins.length > 0) {
      const { data, error } = await admin.rpc('try_bootstrap_admin', {
        target_user_id: regularUserId,
        bootstrap_email: BOOTSTRAP_EMAIL,
      })
      expect(error).toBeNull()
      expect(data).toBe('precondition_false')
      const user = await getUser(regularUserId)
      expect(user.role).toBeNull()
    } else {
      const { data, error } = await admin.rpc('try_bootstrap_admin', {
        target_user_id: regularUserId,
        bootstrap_email: 'wrong-email@test.local',
      })
      expect(error).toBeNull()
      expect(data).toBe('email_mismatch')
      const user = await getUser(regularUserId)
      expect(user.role).toBeNull()
    }
  })
})

describe('Gate 3: Placement succeeds for admin', () => {
  it('admin can place a user with a valid role and no supervisor', async () => {
    const adminUser = await getUser(adminUserId)
    if (adminUser.role !== 'admin') {
      await admin.rpc('try_bootstrap_admin', {
        target_user_id: adminUserId,
        bootstrap_email: BOOTSTRAP_EMAIL,
      })
    }
    const adminClient = authClient(ADMIN_JWT)
    const { error } = await adminClient.rpc('assign_user_placement', {
      target: regularUserId,
      new_role: 'foreman',
      new_supervisor: null,
    })
    expect(error).toBeNull()
    const user = await getUser(regularUserId)
    expect(user.role).toBe('foreman')
    expect(user.supervisor_id).toBeNull()
  })
})

describe('Gate 4: Cycle rejection', () => {
  it('rejects placing a user as their own descendant supervisor', async () => {
    const adminClient = authClient(ADMIN_JWT)
    await adminClient.rpc('assign_user_placement', {
      target: regularUserId,
      new_role: 'site_manager',
      new_supervisor: adminUserId,
    })
    await adminClient.rpc('assign_user_placement', {
      target: thirdUserId,
      new_role: 'foreman',
      new_supervisor: regularUserId,
    })
    const { error } = await adminClient.rpc('assign_user_placement', {
      target: adminUserId,
      new_role: 'admin',
      new_supervisor: thirdUserId,
    })
    expect(error).not.toBeNull()
    const adminUser = await getUser(adminUserId)
    expect(adminUser.supervisor_id).toBeNull()
  })
})

describe('Gate 5: Non-admin rejection', () => {
  it('non-admin user cannot call assign_user_placement', async () => {
    const userClient = authClient(USER_JWT)
    const { error } = await userClient.rpc('assign_user_placement', {
      target: thirdUserId,
      new_role: 'foreman',
      new_supervisor: null,
    })
    expect(error).not.toBeNull()
    const thirdUser = await getUser(thirdUserId)
    expect(thirdUser.role).toBe('foreman')
  })

  it('service-role also cannot bypass the admin check (function-internal)', async () => {
    const { error } = await admin.rpc('assign_user_placement', {
      target: thirdUserId,
      new_role: 'consultant',
      new_supervisor: null,
    })
    expect(error).not.toBeNull()
    const thirdUser = await getUser(thirdUserId)
    expect(thirdUser.role).toBe('foreman')
  })
})

describe('Gate 6: Webhook column scope', () => {
  it('webhook upsert writes only identity columns', async () => {
    const fs = await import('fs')
    const webhookSource = fs.readFileSync('./app/webhooks/clerk/route.ts', 'utf-8')
    const upsertMatch = webhookSource.match(/\.upsert\(\s*\{([\s\S]+?)\}/)
    expect(upsertMatch).not.toBeNull()
    const upsertBody = upsertMatch![1]
    expect(upsertBody).not.toMatch(/\brole\b/)
    expect(upsertBody).not.toMatch(/supervisor_id/)
    expect(upsertBody).toMatch(/clerk_id/)
    expect(upsertBody).toMatch(/email/)
    expect(upsertBody).toMatch(/display_name/)
  })

  it('webhook ignores extra fields in Clerk payload', async () => {
    const fs = await import('fs')
    const webhookSource = fs.readFileSync('./app/webhooks/clerk/route.ts', 'utf-8')
    const destructureMatch = webhookSource.match(/const\s*\{([^}]+)\}\s*=\s*event\.data/)
    expect(destructureMatch).not.toBeNull()
    const destructured = destructureMatch![1]
    expect(destructured).not.toMatch(/\brole\b/)
    expect(destructured).not.toMatch(/supervisor_id/)
  })
})
