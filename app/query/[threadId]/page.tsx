import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getCitationsForAnswerVersion, resolveCitationsForReader } from '@/lib/citation-resolution'
import { resolveCitationWithContent, type CitationWithContent } from '@/lib/citation-content'

type Escalation = {
  escalatedTo: {
    id: string
    displayName: string
  }
  escalatedBy: {
    id: string | null
    displayName: string | null
  }
  reason: string
  createdAt: string
}

type ThreadContent = {
  thread: {
    question: string
    status: string
    askerId: string
    createdAt: string
  }
  askerName: string
  escalations: Escalation[]
  answer:
    | {
        body: string
        citations: CitationWithContent[]
      }
    | null
  error?: string
}

export default async function ThreadPage({ params }: { params: { threadId: string } }) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in')
  }

  const supabase = await createServerSupabaseClient()

  const content: ThreadContent = {
    thread: {
      question: '',
      status: '',
      askerId: '',
      createdAt: '',
    },
    askerName: '',
    escalations: [],
    answer: null,
  }

  try {
    // Fetch qa_threads row
    const { data: threadData, error: threadError } = await supabase
      .from('qa_threads')
      .select('id, question, status, asker_id, created_at')
      .eq('id', params.threadId)
      .single()

    if (threadError || !threadData) {
      content.error = `Thread not found: ${threadError?.message ?? 'Unknown error'}`
      return (
        <div className="max-w-3xl mx-auto p-6">
          <div className="text-red-600">{content.error}</div>
        </div>
      )
    }

    content.thread = {
      question: threadData.question,
      status: threadData.status,
      askerId: threadData.asker_id,
      createdAt: threadData.created_at,
    }

    // Fetch asker name
    const { data: askerData } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', threadData.asker_id)
      .single()

    content.askerName = askerData?.display_name ?? 'Unknown'

    // Fetch qa_escalations chain
    const { data: escalationsData } = await supabase
      .from('qa_escalations')
      .select('escalated_to, escalated_by, reason, created_at')
      .eq('thread_id', params.threadId)
      .order('created_at', { ascending: true })

    if (escalationsData) {
      // Fetch all user names needed for escalations
      const allUserIds = new Set<string>()
      escalationsData.forEach((e) => {
        allUserIds.add(e.escalated_to)
        if (e.escalated_by) {
          allUserIds.add(e.escalated_by)
        }
      })

      const { data: userNames } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', Array.from(allUserIds))

      const userMap = new Map(userNames?.map((u) => [u.id, u.display_name]) ?? [])

      content.escalations = escalationsData.map((e) => ({
        escalatedTo: {
          id: e.escalated_to,
          displayName: userMap.get(e.escalated_to) ?? 'Unknown',
        },
        escalatedBy: {
          id: e.escalated_by,
          displayName: e.escalated_by ? userMap.get(e.escalated_by) ?? 'Unknown' : null,
        },
        reason: e.reason,
        createdAt: e.created_at,
      }))
    }

    // Fetch qa_answers and current version
    const { data: answerData } = await supabase
      .from('qa_answers')
      .select('id, current_version_id')
      .eq('thread_id', params.threadId)
      .single()

    if (answerData && answerData.current_version_id) {
      // Fetch answer version body
      const { data: versionData } = await supabase
        .from('qa_answer_versions')
        .select('body')
        .eq('id', answerData.current_version_id)
        .single()

      if (versionData) {
        // Get citations for this answer version
        const citations = await getCitationsForAnswerVersion(supabase, answerData.current_version_id)

        // Resolve citations through the laundering gate
        const resolvedCitations = await resolveCitationsForReader(supabase, citations)

        // Fetch content and apply defense-in-depth downgrade logic
        const citationData = await Promise.all(
          resolvedCitations.map((citation) => resolveCitationWithContent(supabase, citation))
        )

        content.answer = {
          body: versionData.body,
          citations: citationData,
        }
      }
    }
  } catch (err) {
    content.error = `Error loading thread: ${err instanceof Error ? err.message : 'Unknown error'}`
    console.error('Thread page error:', err)
  }

  // Render
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {content.error && <div className="text-red-600">{content.error}</div>}

      {/* Thread question */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{content.thread.question}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Asked by {content.askerName} on {new Date(content.thread.createdAt).toLocaleString()}
        </p>
        <p className="text-sm">Status: {content.thread.status}</p>
      </div>

      {/* Escalation chain */}
      {content.escalations.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <h2 className="font-semibold">Escalation Chain</h2>
          <div className="space-y-2 text-sm">
            {content.escalations.map((esc, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex-1">
                  <p>
                    {esc.reason === 'ai_refusal' ? 'AI escalated' : `${esc.escalatedBy.displayName} passed`} to{' '}
                    <strong>{esc.escalatedTo.displayName}</strong>
                  </p>
                  <p className="text-xs text-gray-500">
                    {esc.reason === 'ai_refusal' ? 'AI refusal' : 'Human passed up'} •{' '}
                    {new Date(esc.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Answer and citations */}
      {content.answer ? (
        <div className="border rounded-lg p-4 space-y-4">
          <div>
            <h2 className="font-semibold mb-2">Answer</h2>
            <p className="whitespace-pre-wrap text-sm">{content.answer.body}</p>
          </div>

          {/* Citations */}
          {content.answer.citations.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <h3 className="text-sm font-medium">Sources</h3>
              <div className="space-y-2">
                {content.answer.citations.map((citation, idx) => {
                  if (!citation.visible) {
                    // Non-visible citations: plain text only, no expand affordance
                    return (
                      <div key={idx} className="text-xs text-gray-500">
                        Source {idx + 1}
                      </div>
                    )
                  }

                  // Visible citations: expandable element
                  return (
                    <details key={idx} className="border rounded px-3 py-2 text-sm">
                      <summary className="cursor-pointer font-medium">Source {idx + 1}</summary>
                      <div className="mt-2 pt-2 border-t whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                        {citation.content}
                      </div>
                    </details>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-gray-600 dark:text-gray-400">No answer yet</div>
      )}
    </div>
  )
}
