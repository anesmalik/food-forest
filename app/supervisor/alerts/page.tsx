'use client'

import { useState, useEffect, useTransition } from 'react'
import { getMyAlerts, dismissAlert, getTasksForAlerts, type TaskAlert } from '@/lib/actions/alerts'
import { getSubtreeMembers } from '@/lib/actions/tasks'
import type { Task } from '@/lib/database.types'
import type { SubtreeMember } from '@/lib/actions/tasks'

function getDaysOverdue(dueDate: string): number {
  const due = new Date(dueDate)
  const now = new Date()
  const diffMs = now.getTime() - due.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

function formatOverdueText(daysOverdue: number): string {
  if (daysOverdue === 1) return '1 day overdue'
  return `${daysOverdue} days overdue`
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<TaskAlert[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<SubtreeMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        const [fetchedAlerts, fetchedMembers] = await Promise.all([
          getMyAlerts(),
          getSubtreeMembers(),
        ])

        setAlerts(fetchedAlerts)
        setMembers(fetchedMembers)

        // Fetch task data for all alert task IDs
        if (fetchedAlerts.length > 0) {
          const taskIds = fetchedAlerts.map((a) => a.task_id)
          const fetchedTasks = await getTasksForAlerts(taskIds)
          setTasks(fetchedTasks)
        }

        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load alerts')
      } finally {
        setIsLoading(false)
      }
    })
  }, [])

  function handleDismiss(alertId: string) {
    startTransition(async () => {
      try {
        await dismissAlert(alertId)
        // Optimistically remove the alert from the list
        setAlerts(alerts.filter((a) => a.id !== alertId))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to dismiss alert')
      }
    })
  }

  // Build lookup map for members
  const memberMap = new Map(members.map((m) => [m.id, m]))

  // Build lookup map for tasks
  const taskMap = new Map(tasks.map((t) => [t.id, t]))

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Alerts</h1>
        <p className="text-gray-500">Loading alerts...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Alerts</h1>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {alerts.length === 0 ? (
        <p className="text-gray-500">No active alerts</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const task = taskMap.get(alert.task_id)
            // task_alerts RLS grants visibility on two independent conditions (assigner_id =
            // caller, OR caller is an ancestor of assignee_id) — getSubtreeMembers() only
            // covers the second. A supervisor who assigned a task to someone outside their
            // own subtree (RLS allows this; task assignment isn't hierarchy-gated) still has
            // a legitimate alert here, so a missing assignee lookup must not drop the row —
            // fall back to showing the raw assignee_id rather than silently hiding a real alert.
            const assignee = task ? memberMap.get(task.assignee_id) : null
            const assigneeLabel = assignee?.display_name ?? task?.assignee_id ?? 'Unknown'

            if (!task || !task.due_date) return null

            const daysOverdue = getDaysOverdue(task.due_date)
            const overdueText = formatOverdueText(daysOverdue)

            return (
              <div
                key={alert.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border rounded-lg bg-white hover:bg-gray-50 transition"
              >
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">
                      {task.title}
                    </h3>
                    <p className="text-sm text-gray-600 whitespace-nowrap">
                      {assigneeLabel}
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-gray-600">
                    <span className="text-amber-700 font-medium">{overdueText}</span>
                    <span className="hidden sm:inline">•</span>
                    <span>{new Date(task.due_date).toLocaleDateString()}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleDismiss(alert.id)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                  {isPending ? 'Dismissing...' : 'Dismiss'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
