'use client'

import { useEffect, useState } from 'react'
import { getUserTasks, getCurrentUserDbId } from '@/lib/actions/tasks'
import { TaskCard } from '../task-card'
import { Task } from '@/lib/database.types'
import { useUser } from '@clerk/nextjs'

export default function MyTasksPage() {
  const { isLoaded, isSignedIn } = useUser()
  const [dbUserId, setDbUserId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | undefined>()

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    loadTasks()
  }, [isLoaded, isSignedIn, filter])

  const loadTasks = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [id, data] = await Promise.all([
        getCurrentUserDbId(),
        getUserTasks(filter),
      ])
      setDbUserId(id)
      setTasks(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setIsLoading(false)
    }
  }

  const handleTaskUpdated = (updatedTask: Task) => {
    setTasks(tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)))
  }

  if (isLoading) {
    return <div className="text-center py-8">Loading tasks...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">My Tasks</h1>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setFilter(undefined)}
          className={`px-4 py-2 rounded-md ${!filter ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
        >
          All
        </button>
        <button
          onClick={() => setFilter('assigned')}
          className={`px-4 py-2 rounded-md ${filter === 'assigned' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
        >
          Assigned
        </button>
        <button
          onClick={() => setFilter('in_progress')}
          className={`px-4 py-2 rounded-md ${filter === 'in_progress' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
        >
          In Progress
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`px-4 py-2 rounded-md ${filter === 'completed' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
        >
          Completed
        </button>
      </div>

      {error && <div className="text-red-600 mb-4 p-4 bg-red-50 rounded-md">{error}</div>}

      {tasks.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {filter ? `No ${filter.replace('_', ' ')} tasks` : 'No tasks yet'}
        </div>
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
