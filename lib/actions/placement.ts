'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'

/**
 * Assign user placement (role + supervisor) via the assign_user_placement()
 * Postgres function. Admin-only at the function level; this action also
 * pre-checks admin status for defense in depth.
 */
export async function assignUserPlacement(
  targetId: string,
  newRole: 'admin' | 'consultant' | 'site_manager' | 'foreman',
  newSupervisor: string | null
): Promise<{ success: true } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  // Defense-in-depth pre-check (the function's own check is the real boundary)
  const { data: caller } = await supabase
    .from('users')
    .select('role')
    .eq('clerk_id', userId)
    .single()

  if (!caller || caller.role !== 'admin') {
    return { success: false, error: 'Only admins can assign user placement' }
  }

  const { error } = await supabase.rpc('assign_user_placement', {
    target: targetId,
    new_role: newRole,
    new_supervisor: newSupervisor,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Fetch all users for the admin placement UI.
 * Returns awaiting-placement (role IS NULL) and placed users.
 */
export async function getUsersForPlacement() {
  const { userId } = await auth()
  if (!userId) return { awaiting: [], placed: [] }

  const supabase = await createServerSupabaseClient()

  // Defense-in-depth: only admins see this page's data
  const { data: caller } = await supabase
    .from('users')
    .select('role')
    .eq('clerk_id', userId)
    .single()

  if (!caller || caller.role !== 'admin') {
    return { awaiting: [], placed: [] }
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, email, display_name, role, supervisor_id')
    .order('created_at', { ascending: true })

  const awaiting = (users || []).filter((u) => u.role === null)
  const placed = (users || []).filter((u) => u.role !== null)

  return { awaiting, placed }
}