'use client'

import { Task } from '@/lib/database.types'
import { transitionTask, updateTaskFields } from '@/lib/actions/tasks'
import { useState } from 'react'
import { format } from 'date-fns'

interface TaskCardProps {
  task: Task
  isAssignee: boolean
  isAssigner: boolean
  onTaskUpdated?: (updatedTask: Task) => void
}

export function TaskCard({
  task,
  isAssignee,
  isAssigner,
  onTaskUpdated,
}: TaskCardProps) {
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDescription, setEditDescription] = useState(task.description || '')
  const [editDueDate, setEditDueDate] = useState(task.due_date || '')

  const handleTransition = async (newState: string) => {
    setIsTransitioning(true)
    setError(null)

    try {
      const updated = await transitionTask(task.id, newState)
      onTaskUpdated?.(updated)
    } catch (err) {
      let displayError = 'Failed to update task'
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message)
          displayError = [
            `Code: ${parsed.code}`,
            `Message: ${parsed.message}`,
            parsed.hint ? `Hint: ${parsed.hint}` : null,
            parsed.details ? `Details: ${parsed.details}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        } catch {
          displayError = err.message
        }
      }
      setError(displayError)
    } finally {
      setIsTransitioning(false)
    }
  }

  const handleEdit = () => {
    setEditTitle(task.title)
    setEditDescription(task.description || '')
    setEditDueDate(task.due_date || '')
    setIsEditing(true)
    setError(null)
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setError(null)
  }

  const handleSave = async () => {
    if (!editTitle.trim()) {
      setError('Title is required')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const updated = await updateTaskFields(task.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
        due_date: editDueDate || undefined,
      })
      onTaskUpdated?.(updated)
      setIsEditing(false)
    } catch (err) {
      let displayError = 'Failed to update task'
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message)
          displayError = [
            `Code: ${parsed.code}`,
            `Message: ${parsed.message}`,
            parsed.hint ? `Hint: ${parsed.hint}` : null,
            parsed.details ? `Details: ${parsed.details}` : null,
          ]
            .filter(Boolean)
            .join('\n')
        } catch {
          displayError = err.message
        }
      }
      setError(displayError)
    } finally {
      setIsSaving(false)
    }
  }

  const getStateColor = (state: string) => {
    const colors: Record<string, string> = {
      assigned: 'bg-blue-100 text-blue-800',
      in_progress: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      missed: 'bg-gray-100 text-gray-800',
    }
    return colors[state] || 'bg-gray-100 text-gray-800'
  }

  const getAvailableTransitions = (state: string): Array<{ to: string; label: string }> => {
    const transitions: Record<string, Array<{ to: string; label: string }>> = {
      assigned: [
        ...(isAssignee ? [{ to: 'in_progress', label: 'Start Work' }] : []),
        ...(isAssignee ? [{ to: 'completed', label: 'Complete' }] : []),
        ...(isAssigner ? [{ to: 'cancelled', label: 'Cancel' }] : []),
      ],
      in_progress: [
        ...(isAssignee ? [{ to: 'completed', label: 'Complete' }] : []),
        ...(isAssigner ? [{ to: 'cancelled', label: 'Cancel' }] : []),
      ],
      completed: [],
      cancelled: [],
      missed: [],
    }
    return transitions[state] || []
  }

  const isNonTerminal = task.state === 'assigned' || task.state === 'in_progress'
  const canEdit = isAssigner && isNonTerminal

  if (isEditing) {
    return (
      <div className="border rounded-lg p-4 bg-white shadow-sm">
        <div className="flex items-start justify-between mb-2">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="flex-1 font-semibold text-lg border rounded px-2 py-1"
            placeholder="Task title"
          />
          <span className={`ml-2 px-2 py-1 rounded-full text-sm font-medium ${getStateColor(task.state)}`}>
            {task.state.replace('_', ' ')}
          </span>
        </div>

        <div className="mb-2">
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            className="w-full text-gray-600 text-sm border rounded px-2 py-1"
            rows={3}
            placeholder="Description (optional)"
          />
        </div>

        <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
          <div>
            <label className="mr-2">Due date:</label>
            <input
              type="date"
              value={editDueDate ? editDueDate.split('T')[0] : ''}
              onChange={(e) => setEditDueDate(e.target.value || '')}
              className="border rounded px-2 py-1"
            />
          </div>
        </div>

        {error && <div className="text-red-600 text-sm mb-2 whitespace-pre-line">{error}</div>}

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-3 py-1 text-sm rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={isSaving}
            className="px-3 py-1 text-sm rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-lg">{task.title}</h3>
        <span className={`px-2 py-1 rounded-full text-sm font-medium ${getStateColor(task.state)}`}>
          {task.state.replace('_', ' ')}
        </span>
      </div>

      {task.description && <p className="text-gray-600 text-sm mb-2">{task.description}</p>}

      <div className="flex items-center justify-between text-sm text-gray-500 mb-4">
        {task.due_date && <span>Due: {format(new Date(task.due_date), 'MMM d, yyyy')}</span>}
        {task.completed_at && (
          <span>Completed: {format(new Date(task.completed_at), 'MMM d, yyyy')}</span>
        )}
      </div>

      {error && <div className="text-red-600 text-sm mb-2 whitespace-pre-line">{error}</div>}

      <div className="flex gap-2">
        {getAvailableTransitions(task.state).map((transition) => (
          <button
            key={transition.to}
            onClick={() => handleTransition(transition.to)}
            disabled={isTransitioning}
            className="px-3 py-1 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isTransitioning ? 'Updating...' : transition.label}
          </button>
        ))}
        {canEdit && (
          <button
            onClick={handleEdit}
            disabled={isTransitioning}
            className="px-3 py-1 text-sm rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  )
}
