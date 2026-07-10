'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import {
  getJournalPage,
  searchJournal,
  createJournalEntry,
  softDeleteJournalEntry,
  getCorrectableEntries,
} from '@/lib/actions/journal'
import { type JournalEntry } from '@/lib/journal-types'
import { TaskSelector } from '@/app/journal/task-selector'
import { getEntities, type EntityRow } from '@/lib/actions/entities'

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<JournalEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isPending, startTransition] = useTransition()

  const loadFirstPage = useCallback(() => {
    startTransition(async () => {
      const page = await getJournalPage(null)
      setEntries(page.entries)
      setNextCursor(page.nextCursor)
      setSearchResults(null)
    })
  }, [])

  useEffect(() => {
    loadFirstPage()
  }, [loadFirstPage])

  function loadMore() {
    if (!nextCursor) return
    startTransition(async () => {
      const page = await getJournalPage(nextCursor)
      setEntries((prev) => [...prev, ...page.entries])
      setNextCursor(page.nextCursor)
    })
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    startTransition(async () => {
      const results = await searchJournal(searchQuery)
      setSearchResults(results)
    })
  }

  function handleCreate(
    body: string,
    entityIds: string[],
    sensitivity: 'normal' | 'restricted',
    correctsEntryId: string | null,
    taskId: string | null
  ) {
    startTransition(async () => {
      setError(null)
      const result = await createJournalEntry(body, entityIds, sensitivity, correctsEntryId, taskId)
      if (result.success) {
        setShowCreateForm(false)
        loadFirstPage()
      } else {
        setError(result.error)
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      setError(null)
      const result = await softDeleteJournalEntry(id)
      if (result.success) {
        loadFirstPage()
      } else {
        setError(result.error)
      }
    })
  }

  const displayed = searchResults ?? entries

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Journal</h1>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 rounded text-sm font-medium"
        >
          {showCreateForm ? 'Cancel' : 'New Entry'}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {showCreateForm && (
        <CreateEntryForm onSubmit={handleCreate} disabled={isPending} />
      )}

      {/* Search — provisional/keyword-only, stage two embeddings are the real story */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search entries (keyword, provisional)..."
          className="flex-1 border rounded px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="border px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
        >
          Search
        </button>
        {searchResults && (
          <button
            type="button"
            onClick={() => {
              setSearchResults(null)
              setSearchQuery('')
            }}
            className="border px-4 py-1.5 rounded text-sm font-medium"
          >
            Clear
          </button>
        )}
      </form>

      {/* Entry list */}
      <div className="space-y-4">
        {displayed.length === 0 ? (
          <p className="text-gray-500 text-sm">
            {searchResults ? 'No results found.' : 'No journal entries yet.'}
          </p>
        ) : (
          displayed.map((entry) => (
            <JournalEntryCard
              key={entry.id}
              entry={entry}
              onDelete={handleDelete}
              onCorrect={(id) => {
                setShowCreateForm(true)
                // Pass the corrects ID via a custom event or state lift
                window.dispatchEvent(
                  new CustomEvent('correct-entry', { detail: id })
                )
              }}
            />
          ))
        )}
      </div>

      {/* Load more (cursor pagination — next page only, no numbered pages) */}
      {!searchResults && nextCursor && (
        <button
          onClick={loadMore}
          disabled={isPending}
          className="w-full border rounded py-2 text-sm font-medium disabled:opacity-50"
        >
          Load more
        </button>
      )}
    </div>
  )
}

function JournalEntryCard({
  entry,
  onDelete,
  onCorrect,
}: {
  entry: JournalEntry
  onDelete: (id: string) => void
  onCorrect: (id: string) => void
}) {
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
        <>
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
        {/* Correction is available on tombstoned entries too — the whole
            point of append-correction is to fix an entry that turned out wrong,
            which is often exactly why it got deleted. */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onCorrect(entry.id)}
            className="text-xs border px-2 py-0.5 rounded font-medium"
          >
            Write correction
          </button>
        </div>
        </>
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

          {/* Actions: author-only delete + correct */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onCorrect(entry.id)}
              className="text-xs border px-2 py-0.5 rounded font-medium"
            >
              Write correction
            </button>
            <button
              onClick={() => onDelete(entry.id)}
              className="text-xs border border-red-300 text-red-600 px-2 py-0.5 rounded font-medium"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function CreateEntryForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (
    body: string,
    entityIds: string[],
    sensitivity: 'normal' | 'restricted',
    correctsEntryId: string | null,
    taskId: string | null
  ) => void
  disabled: boolean
}) {
  const [body, setBody] = useState('')
  const [entityIds, setEntityIds] = useState<string[]>([])
  const [sensitivity, setSensitivity] = useState<'normal' | 'restricted'>('normal')
  const [correctsEntryId, setCorrectsEntryId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [entities, setEntities] = useState<EntityRow[]>([])
  const [correctable, setCorrectable] = useState<
    { id: string; created_at: string; body_preview: string }[]
  >([])

  useEffect(() => {
    getEntities().then((data) =>
      setEntities(data.filter((e) => e.deactivated_at === null))
    )
    getCorrectableEntries().then(setCorrectable)

    // Listen for "correct-entry" event from the JournalEntryCard's correct button
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string
      setCorrectsEntryId(detail)
    }
    window.addEventListener('correct-entry', handler)
    return () => window.removeEventListener('correct-entry', handler)
  }, [])

  function toggleEntity(id: string) {
    setEntityIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (body.trim()) {
      onSubmit(body.trim(), entityIds, sensitivity, correctsEntryId, taskId)
      // Reset
      setBody('')
      setEntityIds([])
      setSensitivity('normal')
      setCorrectsEntryId(null)
      setTaskId(null)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border rounded-lg p-4 space-y-4"
    >
      <h3 className="font-medium">New Journal Entry</h3>

      {correctsEntryId && (
        <div className="text-sm bg-blue-50 dark:bg-blue-900/20 p-2 rounded border border-blue-200 dark:border-blue-800">
          Correcting entry from{' '}
          {correctable.find((e) => e.id === correctsEntryId)?.created_at
            ? new Date(
                correctable.find((e) => e.id === correctsEntryId)!.created_at
              ).toLocaleString()
            : 'selected entry'}
          <button
            type="button"
            onClick={() => { setCorrectsEntryId(null); setTaskId(null); }}
            className="ml-2 text-xs underline"
          >
            cancel
          </button>
        </div>
      )}

      {/* Link to task — optional, shows user's active tasks */}
      <TaskSelector selectedTaskId={taskId} onTaskSelected={setTaskId} />

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your journal entry..."
        rows={5}
        className="w-full border rounded px-3 py-2 text-sm"
        required
      />

      {/* Entity tags — picked from the step-2 registry */}
      {entities.length > 0 && (
        <div>
          <p className="text-sm text-gray-600 mb-1">Tag entities (optional)</p>
          <div className="flex flex-wrap gap-1">
            {entities.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => toggleEntity(e.id)}
                className={`text-xs px-2 py-0.5 rounded border ${
                  entityIds.includes(e.id)
                    ? 'bg-black text-white dark:bg-white dark:text-black border-black dark:border-white'
                    : ''
                }`}
              >
                {e.name} ({e.type})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 items-end">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">Sensitivity</span>
          <select
            value={sensitivity}
            onChange={(e) =>
              setSensitivity(e.target.value as 'normal' | 'restricted')
            }
            className="border rounded px-2 py-1"
          >
            <option value="normal">Normal</option>
            <option value="restricted">Restricted</option>
          </select>
        </label>

        <label className="flex flex-col text-sm flex-1">
          <span className="mb-1 text-gray-600">Corrects entry (optional)</span>
          <select
            value={correctsEntryId ?? ''}
            onChange={(e) => setCorrectsEntryId(e.target.value || null)}
            className="border rounded px-2 py-1"
          >
            <option value="">None</option>
            {correctable.map((e) => (
              <option key={e.id} value={e.id}>
                {new Date(e.created_at).toLocaleString()} — {e.body_preview}...
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={disabled || !body.trim()}
          className="bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
        >
          Post
        </button>
      </div>
    </form>
  )
}
