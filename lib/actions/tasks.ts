'use server'

import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { Task } from '@/lib/database.types'

async function getCurrentUserId(): Promise<string> {
  const { userId } = await auth()
  if (!userId) throw new Error('Not authenticated')

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', userId)
    .single()

  if (error || !data) throw new Error('User not found')
  return data.id
}

// Public wrapper for client components that need the DB user id
// (e.g. for isAssignee/isAssigner UI comparisons)
export async function getCurrentUserDbId(): Promise<string> {
  return getCurrentUserId()
}

export async function createTask(
  assigneeId: string,
  title: string,
  description: string,
  dueDate?: string
) {
  const assignerId = await getCurrentUserId()
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title,
      description,
      assigner_id: assignerId,
      assignee_id: assigneeId,
      state: 'assigned',
      due_date: dueDate || null,
    })
    .select()
    .single()

  if (error) throw error
  return data as Task
}

export async function transitionTask(taskId: string, newState: string) {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('tasks')
    .update({ state: newState })
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error
  return data as Task
}

export async function updateTaskFields(
  taskId: string,
  updates: { title?: string; description?: string; due_date?: string; assignee_id?: string }
) {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .select()
    .single()

  if (error) {
    // Log the full error object server-side so you can see code, message, hint, details
    console.error('[updateTaskFields] Supabase error:', {
      code: error.code,
      message: error.message,
      hint: error.hint,
      details: error.details,
      taskId,
      updates,
    })

    // Surface code + message + hint + details to the client
    throw new Error(
      JSON.stringify({
        code: error.code,
        message: error.message,
        hint: error.hint,
        details: error.details,
      })
    )
  }
  return data as Task
}

export async function getUserTasks(state?: string) {
  const userId = await getCurrentUserId()
  const supabase = await createServerSupabaseClient()

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('assignee_id', userId)

  if (state) {
    query = query.eq('state', state)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error
  return data as Task[]
}

export async function getAssignedTasks() {
  const userId = await getCurrentUserId()
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('assigner_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as Task[]
}

export type AssignableUser = {
  id: string
  display_name: string
  role: string
}

export async function getAssignableUsers(): Promise<AssignableUser[]> {
  // getCurrentUserId() authenticates the caller; the RPC is a SECURITY DEFINER
  // function that returns only id, display_name, role for placed users
  // (excluding the caller), bypassing the users_select RLS policy without
  // exposing the full user record.
  await getCurrentUserId()
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc('get_assignable_users')

  if (error) throw error
  return (data || []) as AssignableUser[]
}

export async function getTaskById(taskId: string) {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single()

  if (error) throw error
  return data as Task
}

export async function getSubordinateTasks(assigneeId: string, state?: string) {
  const supabase = await createServerSupabaseClient()

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('assignee_id', assigneeId)

  if (state) {
    query = query.eq('state', state)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error
  return data as Task[]
}

export type SubtreeMember = {
  id: string
  display_name: string
  role: string
  supervisor_id: string | null
}

export async function getSubtreeMembers(): Promise<SubtreeMember[]> {
  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.rpc('get_subtree_members')

  if (error) throw error
  return (data || []) as SubtreeMember[]
}
