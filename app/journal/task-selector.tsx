'use client'

import { useEffect, useState } from 'react'
import { getUserTasks } from '@/lib/actions/tasks'
import { Task } from '@/lib/database.types'
import { useUser } from '@clerk/nextjs'

interface TaskSelectorProps {
  selectedTaskId?: string | null
  onTaskSelected: (taskId: string | null) => void
}

export function TaskSelector({ selectedTaskId, onTaskSelected }: TaskSelectorProps) {
  const { isLoaded, isSignedIn } = useUser()
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showOptions, setShowOptions] = useState(false)

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !showOptions) return

    loadTasks()
  }, [isLoaded, isSignedIn, showOptions])

  const loadTasks = async () => {
    setIsLoading(true)

    try {
      // Get only tasks assigned to the current user that are not yet completed
      const data = await getUserTasks()
      setTasks(data.filter((t) => t.state !== 'completed' && t.state !== 'cancelled'))
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const selectedTask = tasks.find((t) => t.id === selectedTaskId)

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-2">Link to Task (optional)</label>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowOptions(!showOptions)}
          className="w-full px-3 py-2 border rounded-md text-left bg-white hover:bg-gray-50 flex justify-between items-center"
        >
          <span className="truncate">
            {selectedTask ? selectedTask.title : 'Select a task...'}
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${showOptions ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>

        {showOptions && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 border rounded-md bg-white shadow-lg">
            <div className="max-h-60 overflow-y-auto">
              {isLoading ? (
                <div className="p-3 text-center text-gray-500 text-sm">Loading tasks...</div>
              ) : tasks.length === 0 ? (
                <div className="p-3 text-center text-gray-500 text-sm">
                  No active tasks
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onTaskSelected(null)
                      setShowOptions(false)
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
                  >
                    None
                  </button>

                  {tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => {
                        onTaskSelected(task.id)
                        setShowOptions(false)
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-gray-100 text-sm ${
                        selectedTaskId === task.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{task.title}</span>
                        <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">
                          {task.state.replace('_', ' ')}
                        </span>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
