'use client'

import { useState, useEffect, useTransition } from 'react'
import { getSubtreeMembers, getSubordinateTasks, getCurrentUserDbId } from '@/lib/actions/tasks'
import { getJournalPage } from '@/lib/actions/journal'
import { Task } from '@/lib/database.types'
import { type JournalEntry } from '@/lib/journal-types'
import { TaskCard } from '@/app/tasks/task-card'
import type { SubtreeMember } from '@/lib/actions/tasks'

export default function SupervisorReadDownPage() {
  const [members, setMembers] = useState<SubtreeMember[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [selectedMemberName, setSelectedMemberName] = useState<string | null>(null)
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [dbUserId, setDbUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      try {
        const [subtreeMembers, userId] = await Promise.all([
          getSubtreeMembers(),
          getCurrentUserDbId(),
        ])
        setMembers(subtreeMembers)
        setDbUserId(userId)
        setError(null)

        // If no members, set isLoading to false
        if (subtreeMembers.length === 0) {
          setIsLoading(false)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load subordinates')
        setIsLoading(false)
      }
    })
  }, [])

  function handleSelectMember(memberId: string, memberName: string) {
    setSelectedMemberId(memberId)
    setSelectedMemberName(memberName)
    setIsLoading(true)

    startTransition(async () => {
      try {
        const [subordinateJournal, subordinateTasks] = await Promise.all([
          getJournalPage(null, memberId),
          getSubordinateTasks(memberId),
        ])
        setJournalEntries(subordinateJournal.entries)
        setTasks(subordinateTasks)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load subordinate data')
      } finally {
        setIsLoading(false)
      }
    })
  }

  const handleTaskUpdated = (updatedTask: Task) => {
    setTasks(tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)))
  }

  if (members.length === 0 && !error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Supervisor Read-Down</h1>
        <p className="text-gray-500">
          You don't have any direct or indirect reports yet.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Supervisor Read-Down</h1>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Subordinates list */}
        <div className="md:col-span-1">
          <h2 className="text-lg font-semibold mb-3">Your Team</h2>
          <div className="space-y-2 border rounded-lg p-3">
            {members.map((member) => (
              <button
                key={member.id}
                onClick={() => handleSelectMember(member.id, member.display_name)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition ${
                  selectedMemberId === member.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{member.display_name}</div>
                <div className="text-xs opacity-75">{member.role}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Content area */}
        <div className="md:col-span-3 space-y-6">
          {selectedMemberId ? (
            <>
              <div>
                <h2 className="text-lg font-semibold mb-3">
                  {selectedMemberName}'s Journal Entries
                </h2>
                {isLoading ? (
                  <p className="text-gray-500 text-sm">Loading...</p>
                ) : journalEntries.length === 0 ? (
                  <p className="text-gray-500 text-sm">No journal entries yet.</p>
                ) : (
                  <div className="space-y-4">
                    {journalEntries.map((entry) => (
                      <JournalEntryCard key={entry.id} entry={entry} />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-3">
                  {selectedMemberName}'s Tasks
                </h2>
                {isLoading ? (
                  <p className="text-gray-500 text-sm">Loading...</p>
                ) : tasks.length === 0 ? (
                  <p className="text-gray-500 text-sm">No tasks yet.</p>
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
            </>
          ) : (
            <p className="text-gray-500">Select a team member to view their entries and tasks.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function JournalEntryCard({ entry }: { entry: JournalEntry }) {
  const isTombstone = entry.soft_deleted_at !== null

  return (
    <div
      className={`border rounded-lg p-4 space-y-2 ${
        isTombstone ? 'bg-gray-50 opacity-70' : ''
      }`}
    >
      {/* Header: author + date */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{entry.author_name ?? 'Unknown'}</span>
        <span>{new Date(entry.created_at).toLocaleString()}</span>
      </div>

      {/* Tombstone: metadata only — no body text */}
      {isTombstone ? (
        <div className="text-sm text-gray-400 italic">
          Entry deleted on{' '}
          {new Date(entry.soft_deleted_at!).toLocaleString()}
          {entry.task_id && (
            <span className="ml-2">
              (linked to task: {entry.task_title ?? entry.task_id})
            </span>
          )}
          {entry.corrects_entry_created_at && (
            <span className="ml-2">
              (corrected entry from{' '}
              {new Date(entry.corrects_entry_created_at).toLocaleString()})
            </span>
          )}
        </div>
      ) : (
        <>
          {/* Body */}
          <p className="whitespace-pre-wrap text-sm">{entry.body}</p>

          {/* Entity tags */}
          {entry.entities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entry.entities.map((e) => (
                <span
                  key={e.id}
                  className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded"
                >
                  {e.name} ({e.type})
                </span>
              ))}
            </div>
          )}

          {/* Linked task */}
          {entry.task_id && (
            <p className="text-xs text-gray-500">
              Linked to task:{' '}
              <span className="font-medium">{entry.task_title ?? entry.task_id}</span>
            </p>
          )}

          {/* Correction reference */}
          {entry.corrects_entry_id && (
            <p className="text-xs text-gray-400 italic">
              Corrects entry from{' '}
              {new Date(entry.corrects_entry_created_at!).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  )
}
