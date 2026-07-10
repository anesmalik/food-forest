'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'

export type EntityType = { key: string; label: string }

export type EntityRow = {
  id: string
  name: string
  type: string
  metadata: Json
  created_at: string
  deactivated_at: string | null
}

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

/**
 * Fetch all entity types for the dropdown.
 * Org-wide read — any authenticated user can read these.
 */
export async function getEntityTypes(): Promise<EntityType[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('entity_types')
    .select('key, label')
    .order('label', { ascending: true })
  return data ?? []
}

/**
 * Fetch all entities, ordered by type then name.
 * Org-wide read — any authenticated user can read these.
 */
export async function getEntities(): Promise<EntityRow[]> {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('entities')
    .select('id, name, type, metadata, created_at, deactivated_at')
    .order('type', { ascending: true })
    .order('name', { ascending: true })
  return data ?? []
}

/**
 * Create a new entity. Admin-only at the RLS policy level.
 */
export async function createEntity(
  name: string,
  type: string,
  metadata: Record<string, unknown> | null
): Promise<{ success: true } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  // Resolve current user's UUID for created_by
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', userId)
    .single()

  if (!user) {
    return { success: false, error: 'User not found' }
  }

  const { error } = await supabase.from('entities').insert({
    name: name.trim(),
    type,
    metadata: metadata ?? {},
    created_by: user.id,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Update an entity's name and/or type. Admin-only at the RLS policy level.
 */
export async function updateEntity(
  id: string,
  updates: { name?: string; type?: string }
): Promise<{ success: true } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  const patch: Record<string, string> = {}
  if (updates.name !== undefined) patch.name = updates.name.trim()
  if (updates.type !== undefined) patch.type = updates.type

  const { error } = await supabase.from('entities').update(patch).eq('id', id)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Deactivate an entity (soft-delete). Sets deactivated_at to now().
 * Admin-only at the RLS policy level.
 */
export async function deactivateEntity(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('entities')
    .update({ deactivated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}

/**
 * Reactivate an entity (clear deactivated_at). Admin-only at the RLS policy level.
 */
export async function reactivateEntity(
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Not authenticated' }
  }

  const supabase = await createServerSupabaseClient()

  const { error } = await supabase
    .from('entities')
    .update({ deactivated_at: null })
    .eq('id', id)

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true }
}
