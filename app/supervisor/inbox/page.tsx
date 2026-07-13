'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  getMyEscalatedThreads,
  answerEscalatedThread,
  passEscalationUp,
  type EscalatedThread,
  type CitationRef,
} from '@/lib/actions/escalation-inbox'
import Link from 'next/link'

export default function SupervisorInboxPage() {
  const [threads, setThreads] = useState<EscalatedThread[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null)
  const [answerForms, setAnswerForms] = useState<Record<string, { body: string; citationIds: string }>>({})

  useEffect(() => {
    startTransition(async () => {
      try {
        const fetchedThreads = await getMyEscalatedThreads()
        setThreads(fetchedThreads)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load escalated threads')
      } finally {
        setIsLoading(false)
      }
    })
  }, [])

  function handleExpandThread(threadId: string) {
    setExpandedThreadId(expandedThreadId === threadId ? null : threadId)
    if (!answerForms[threadId]) {
      setAnswerForms({
        ...answerForms,
        [threadId]: { body: '', citationIds: '' },
      })
    }
  }

  function handleAnswerBodyChange(threadId: string, body: string) {
    setAnswerForms({
      ...answerForms,
      [threadId]: { ...answerForms[threadId], body },
    })
  }

  function handleCitationIdsChange(threadId: string, citationIds: string) {
    setAnswerForms({
      ...answerForms,
      [threadId]: { ...answerForms[threadId], citationIds },
    })
  }

  function handleSubmitAnswer(threadId: string) {
    startTransition(async () => {
      try {
        const form = answerForms[threadId]
        if (!form || !form.body.trim()) {
          setError('Answer body cannot be empty')
          return
        }

        const citationRefs: CitationRef[] = form.citationIds
          .split('\n')
          .map((line) => {
            const [contentType, contentId] = line.trim().split(':')
            if (!contentType || !contentId) return null
            return {
              contentType: contentType.trim() as CitationRef['contentType'],
              contentId: contentId.trim(),
            }
          })
          .filter((ref) => ref !== null) as CitationRef[]

        const result = await answerEscalatedThread(threadId, form.body, citationRefs)
        if (result.success) {
          setThreads(threads.filter((t) => t.thread_id !== threadId))
          setExpandedThreadId(null)
          setError(null)
        } else {
          setError(result.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit answer')
      }
    })
  }

  function handlePassUp(threadId: string) {
    startTransition(async () => {
      try {
        const result = await passEscalationUp(threadId)
        if (result.success) {
          setThreads(threads.filter((t) => t.thread_id !== threadId))
          setError(null)
        } else {
          setError(result.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to pass escalation up')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Escalation Inbox</h1>
        <p className="text-gray-500">Loading escalated threads...</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Escalation Inbox</h1>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {threads.length === 0 ? (
        <p className="text-gray-500">No escalated threads currently assigned to you</p>
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <div
              key={thread.thread_id}
              className="border rounded-lg bg-white hover:bg-gray-50 transition"
            >
              {/* Header: question + escalation info + actions */}
              <div className="p-4 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-900 break-words">
                      {thread.question}
                    </h3>
                    <p className="text-xs text-gray-600 mt-2">
                      Escalated via{' '}
                      <span className="font-medium">
                        {thread.reason === 'ai_refusal' ? 'AI refusal' : 'passed up chain'}
                      </span>{' '}
                      on {new Date(thread.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleExpandThread(thread.thread_id)}
                      disabled={isPending}
                      className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
                    >
                      {expandedThreadId === thread.thread_id ? 'Collapse' : 'Answer'}
                    </button>
                    <button
                      onClick={() => handlePassUp(thread.thread_id)}
                      disabled={isPending}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
                    >
                      {isPending ? 'Working...' : 'Pass Up'}
                    </button>
                    <Link
                      href={`/query/${thread.thread_id}`}
                      className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 rounded hover:bg-gray-100 transition whitespace-nowrap"
                    >
                      View Thread
                    </Link>
                  </div>
                </div>
              </div>

              {/* Expanded answer form */}
              {expandedThreadId === thread.thread_id && (
                <div className="border-t p-4 space-y-3 bg-gray-50">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-2">
                      Answer
                    </label>
                    <textarea
                      value={answerForms[thread.thread_id]?.body || ''}
                      onChange={(e) => handleAnswerBodyChange(thread.thread_id, e.target.value)}
                      disabled={isPending}
                      placeholder="Type your answer here..."
                      className="w-full px-3 py-2 border rounded text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                      rows={4}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-2">
                      Citations (one per line, format: content_type:content_id)
                    </label>
                    <textarea
                      value={answerForms[thread.thread_id]?.citationIds || ''}
                      onChange={(e) => handleCitationIdsChange(thread.thread_id, e.target.value)}
                      disabled={isPending}
                      placeholder="journal_entry:uuid
wiki_version:uuid
qa_answer_version:uuid"
                      className="w-full px-3 py-2 border rounded text-sm font-mono text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                      rows={3}
                    />
                  </div>

                  <button
                    onClick={() => handleSubmitAnswer(thread.thread_id)}
                    disabled={isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {isPending ? 'Submitting...' : 'Submit Answer'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
