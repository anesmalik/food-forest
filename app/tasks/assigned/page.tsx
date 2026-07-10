'use client'

import { useEffect, useState } from 'react'
import { getAssignedTasks, getCurrentUserDbId, getAssignableUsers, type AssignableUser } from '@/lib/actions/tasks'
import { TaskCard } from '../task-card'
import { CreateTaskForm } from '../create-task-form'
import { Task } from '@/lib/database.types'
import { useUser } from '@clerk/nextjs'

export default function AssignedTasksPage() {
  const { isLoaded, isSignedIn } = useUser()
  const [dbUserId, setDbUserId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState<AssignableUser | null>(null)

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    loadTasks()
  }, [isLoaded, isSignedIn])

  const loadTasks = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [id, data, users] = await Promise.all([
        getCurrentUserDbId(),
        getAssignedTasks(),
        getAssignableUsers(),
      ])
      setDbUserId(id)
      setTasks(data)
      setAssignableUsers(users)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setIsLoading(false)
    }
  }

  const handleTaskUpdated = (updatedTask: Task) => {
    setTasks(tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)))
  }

  const handleTaskCreated = (newTask: Task) => {
    setTasks([newTask, ...tasks])
    setSelectedAssignee(null)
  }

  if (isLoading) {
    return <div className="text-center py-8">Loading tasks...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Tasks I&apos;ve Assigned</h1>
      </div>

      {error && <div className="text-red-600 mb-4 p-4 bg-red-50 rounded-md">{error}</div>}

      {/* User picker + Create Task form */}
      {assignableUsers.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded-md">
          <label className="block text-sm font-medium mb-2">Assign a new task to:</label>
          <div className="flex gap-2 items-center">
            <select
              value={selectedAssignee?.id || ''}
              onChange={(e) => {
                const user = assignableUsers.find((u) => u.id === e.target.value)
                setSelectedAssignee(user || null)
              }}
              className="flex-1 border rounded-md px-3 py-2 bg-white"
            >
              <option value="">Select a user...</option>
              {assignableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name} — {user.role.replace('_', ' ')}
                </option>
              ))}
            </select>
            {selectedAssignee && (
              <CreateTaskForm
                assigneeId={selectedAssignee.id}
                assigneeName={selectedAssignee.display_name}
                onTaskCreated={handleTaskCreated}
              />
            )}
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No assigned tasks yet</div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isAssignee={task.assignee_id === dbUserId}
              isAssigner={task.assigner_id === dbUserId}
              onTaskUpdated={handleTaskUpdated}
            />
          ))}
        </div>
      )}
    </div>
  )
}
