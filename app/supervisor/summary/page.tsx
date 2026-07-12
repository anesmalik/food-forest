'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import { getSummary, getSummaryRetrievalEntries, type SummaryResult } from '@/lib/actions/summary'
import { getSubtreeMembers } from '@/lib/actions/tasks'
import { type SummaryEntry } from '@/lib/summary-retrieval'
import type { SubtreeMember } from '@/lib/actions/tasks'

function truncateText(text: string, maxLength: number = 80): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
}

export default function SupervisorSummaryPage() {
  const [members, setMembers] = useState<SubtreeMember[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [selectedMemberName, setSelectedMemberName] = useState<string | null>(null)
  const [retrievalEntries, setRetrievalEntries] = useState<SummaryEntry[]>([])
  const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoadingEntries, setIsLoadingEntries] = useState(false)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [isPending, startTransition] = useTransition()
  const sourceListRef = useRef<HTMLDivElement>(null)
  const [highlightedCitationId, setHighlightedCitationId] = useState<string | null>(null)

  useEffect(() => {
    startTransition(async () => {
      try {
        const subtreeMembers = await getSubtreeMembers()
        setMembers(subtreeMembers)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load team members')
      }
    })
  }, [])

  function handleSelectMember(memberId: string, memberName: string) {
    setSelectedMemberId(memberId)
    setSelectedMemberName(memberName)
    setSummaryResult(null)
    setHighlightedCitationId(null)
    setIsLoadingEntries(true)

    startTransition(async () => {
      try {
        const entries = await getSummaryRetrievalEntries(memberId)
        setRetrievalEntries(entries)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entries')
      } finally {
        setIsLoadingEntries(false)
      }
    })
  }

  function handleGenerateSummary() {
    if (!selectedMemberId) return

    setIsGeneratingSummary(true)
    startTransition(async () => {
      try {
        const result = await getSummary(selectedMemberId)
        setSummaryResult(result)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate summary')
        setSummaryResult(null)
      } finally {
        setIsGeneratingSummary(false)
      }
    })
  }

  function handleCitationClick(citationId: string) {
    setHighlightedCitationId(citationId)
    // Find and scroll to the entry
    const entryElement = document.getElementById(`entry-${citationId}`)
    if (entryElement && sourceListRef.current) {
      entryElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Remove highlight after 2s
      setTimeout(() => setHighlightedCitationId(null), 2000)
    }
  }

  // Build citations map for quick lookup
  const citationsMap = new Map(retrievalEntries.map((e) => [e.id, e]))

  if (members.length === 0 && !error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Summary Reports</h1>
        <p className="text-gray-500">
          You don't have any direct or indirect reports yet.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Summary Reports</h1>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Team member list */}
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
              {/* Generate Summary Button */}
              <div className="flex gap-2">
                <button
                  onClick={handleGenerateSummary}
                  disabled={isGeneratingSummary || isLoadingEntries || isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-sm font-medium"
                >
                  {isGeneratingSummary ? 'Generating...' : 'Generate Summary'}
                </button>
              </div>

              {/* Summary Result */}
              {summaryResult && (
                <div className="space-y-4">
                  {summaryResult.ok ? (
                    <>
                      {/* Summary text */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <h3 className="font-semibold text-blue-900 mb-2">Summary</h3>
                        <p className="text-sm text-blue-800 whitespace-pre-wrap">
                          {summaryResult.summary}
                        </p>
                      </div>

                      {/* Citations - Sources list */}
                      {summaryResult.citations.length > 0 && (
                        <div>
                          <h3 className="font-semibold text-sm mb-2">Sources</h3>
                          <div className="flex flex-wrap gap-2">
                            {summaryResult.citations.map((citationId) => {
                              const entry = citationsMap.get(citationId)
                              if (!entry) return null

                              return (
                                <button
                                  key={citationId}
                                  onClick={() => handleCitationClick(citationId)}
                                  className="inline-flex flex-col gap-0.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-xs transition"
                                >
                                  <span className="text-gray-600 font-medium">
                                    {new Date(entry.created_at).toLocaleDateString()}
                                  </span>
                                  <span className="text-gray-700 truncate max-w-xs">
                                    {truncateText(entry.body || '', 80)}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  ) : summaryResult.kind === 'no_activity' ? (
                    <p className="text-gray-600 text-sm">No recent activity to summarize.</p>
                  ) : summaryResult.kind === 'rate_limited' ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <p className="text-sm text-amber-800">
                        A summary was already generated recently for this report — try again in a
                        few minutes.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-sm text-red-800">
                        Couldn't produce a grounded summary right now.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Full source entries list */}
              <div ref={sourceListRef}>
                <h3 className="font-semibold text-sm mb-3">
                  {selectedMemberName}'s Recent Entries
                </h3>
                {isLoadingEntries ? (
                  <p className="text-gray-500 text-sm">Loading entries...</p>
                ) : retrievalEntries.length === 0 ? (
                  <p className="text-gray-500 text-sm">No entries in the last 30 days.</p>
                ) : (
                  <div className="space-y-4">
                    {retrievalEntries.map((entry) => (
                      <JournalEntryCardFromSummary
                        key={entry.id}
                        entry={entry}
                        isHighlighted={highlightedCitationId === entry.id}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-gray-500">Select a team member to generate a summary report.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function JournalEntryCardFromSummary({
  entry,
  isHighlighted,
}: {
  entry: SummaryEntry
  isHighlighted: boolean
}) {
  return (
    <div
      id={`entry-${entry.id}`}
      className={`border rounded-lg p-4 space-y-2 transition ${
        isHighlighted ? 'bg-yellow-50 border-yellow-400 shadow-md' : 'bg-white'
      }`}
    >
      {/* Header: date */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{new Date(entry.created_at).toLocaleString()}</span>
      </div>

      {/* Body */}
      <p className="whitespace-pre-wrap text-sm">{entry.body}</p>
    </div>
  )
}
