'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'

/**
 * Bootstrap guard server action.
 * Runs at sign-in time for a user whose row exists but has no role.
 * If zero admins exist and the user's email matches BOOTSTRAP_ADMIN_EMAIL,
 * promotes them to admin. Logs every attempt to usage_events.
 *
 * This is a guarded server action (not middleware, not a trigger).
 * The advisory lock and precondition check live in the try_bootstrap_admin()
 * Postgres function. This action just passes the env var and user identity.
 */
export async function tryBootstrapAdmin(): Promise<{ outcome: string } | { error: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { error: 'Not authenticated' }
  }

  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL
  if (!bootstrapEmail) {
    // No bootstrap email configured — nothing to do
    return { outcome: 'precondition_false' }
  }

  const supabase = await createServerSupabaseClient()

  // Find the user's row by clerk_id
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('id, role')
    .eq('clerk_id', userId)
    .single()

  if (userError || !userRow) {
    // No row yet — sync window, nothing to bootstrap
    return { error: 'User row not found' }
  }

  // Only bootstrap if the user has no role yet
  if (userRow.role !== null) {
    return { outcome: 'precondition_false' }
  }

  // Call the Postgres function
  const { data, error } = await supabase
    .rpc('try_bootstrap_admin', {
      target_user_id: userRow.id,
      bootstrap_email: bootstrapEmail,
    })

  if (error) {
    console.error('bootstrap error:', error)
    return { error: error.message }
  }

  return { outcome: data }
}