'use client'

import { useState, useTransition } from 'react'
import { submitQuery, type QueryUIResult } from '@/lib/actions/query-ui'

export default function QueryPage() {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<QueryUIResult | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim()) return

    startTransition(async () => {
      const queryResult = await submitQuery(question)
      setResult(queryResult)
    })
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cross-Team Query</h1>

      {/* Query form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about the organization..."
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm"
          disabled={isPending}
        />
        <button
          type="submit"
          disabled={isPending || !question.trim()}
          className="bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Result display */}
      {result && (
        <div className="border rounded-lg p-4 space-y-4">
          {result.ok ? (
            <>
              {/* Answer state */}
              <div className="space-y-3">
                <h2 className="font-medium">Answer</h2>
                <p className="whitespace-pre-wrap text-sm">{result.summary}</p>
              </div>

              {/* Citations */}
              {result.citations.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <h3 className="text-sm font-medium">Sources</h3>
                  <div className="flex flex-wrap gap-2">
                    {result.citations.map((citationId) => (
                      <span
                        key={citationId}
                        className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded"
                        title={citationId}
                      >
                        {citationId.slice(0, 8)}...
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Refusal state */}
              {result.kind === 'openai_error' ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    We encountered a system error while processing your question.
                    Please try again in a moment.
                  </p>
                  <p className="text-xs text-gray-500">{result.reason}</p>
                </div>
              ) : result.escalatedThreadId ? (
                <div className="space-y-2">
                  <p className="text-sm">
                    {result.escalationName ? (
                      <>
                        This has been sent to <strong>{result.escalationName}</strong>{' '}
                        for a personal answer.
                      </>
                    ) : (
                      'This has been sent to a team member for a personal answer.'
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{result.reason}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">{result.reason}</p>
                  <p className="text-xs text-gray-500">
                    Our knowledge base doesn't have enough information to answer this
                    yet.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
