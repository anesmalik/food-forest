'use server'

import { createServerSupabaseClient } from '@/lib/supabase'
import type { Task } from '@/lib/database.types'

export type TaskAlert = {
  id: string
  task_id: string
  alert_type: string
  created_at: string
  dismissed_at: string | null
}

export async function getMyAlerts(): Promise<TaskAlert[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('task_alerts')
    .select('*')
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as TaskAlert[]
}

export async function dismissAlert(alertId: string): Promise<TaskAlert> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('task_alerts')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', alertId)
    .select()
    .single()

  if (error) throw error
  return data as TaskAlert
}

export async function getTasksForAlerts(taskIds: string[]): Promise<Task[]> {
  if (taskIds.length === 0) return []

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, due_date, assignee_id, state')
    .in('id', taskIds)

  if (error) throw error
  return data as Task[]
}
