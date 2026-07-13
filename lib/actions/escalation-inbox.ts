'use server'

import { auth } from '@clerk/nextjs/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase'

export type EscalatedThread = {
  thread_id: string
  question: string
  status: 'open' | 'escalated' | 'answered'
  escalated_to: string
  reason: 'ai_refusal' | 'human_passed_up'
  created_at: string
}

/**
 * T6.3: Get threads currently escalated to the caller.
 *
 * Uses DISTINCT ON (thread_id) ... ORDER BY thread_id, created_at DESC
 * to find the current escalation addressee per thread (the latest hop in
 * the append-only qa_escalations chain). Filters out closed threads.
 */
export async function getMyEscalatedThreadsCore(supabase: SupabaseClient): Promise<EscalatedThread[]> {
  const { data: threads, error } = await supabase.rpc('get_my_escalated_threads')

  if (error) {
    throw new Error(`Failed to fetch escalated threads: ${error.message}`)
  }

  return (threads || []) as EscalatedThread[]
}

// Auth wrapper
export async function getMyEscalatedThreads(): Promise<EscalatedThread[]> {
  const { userId } = await auth()
  if (!userId) throw new Error('Not authenticated')

  const supabase = await createServerSupabaseClient()
  return getMyEscalatedThreadsCore(supabase)
}

export type CitationRef = {
  contentType: 'journal_entry' | 'wiki_version' | 'qa_answer_version'
  contentId: string
}

/**
 * T6.3: Answer an escalated thread and mark as answered.
 *
 * Security: re-verifies caller is the current escalation addressee
 * before writing anything. Uses RLS policies on each table to enforce
 * per-table permission boundaries.
 *
 * Transaction strategy: each INSERT/UPDATE is independent. RLS policies
 * enforce security boundaries per table. For true ACID atomicity with
 * rollback on partial failure, this would need to be wrapped in a
 * PL/pgSQL function with explicit BEGIN/ROLLBACK, but that's a follow-up.
 * For now: steps proceed in order; if any fails, the error is returned
 * to the caller, and they know not to proceed further.
 */
export async function answerEscalatedThreadCore(
  supabase: SupabaseClient,
  callerId: string,
  threadId: string,
  answerBody: string,
  citationRefs: CitationRef[]
): Promise<{ success: true; answerId: string } | { success: false; error: string }> {
  // Step 0: Verify caller is the current escalation addressee
  const { data: currentAddressee, error: checkError } = await supabase.rpc(
    'get_current_escalation_addressee',
    { p_thread_id: threadId }
  )

  if (checkError) {
    return { success: false, error: `Failed to verify escalation: ${checkError.message}` }
  }

  if (currentAddressee !== callerId) {
    return {
      success: false,
      error: 'Only the current escalation addressee may answer this thread',
    }
  }

  // Step 1: Insert qa_answers row
  const { data: answerData, error: answerError } = await supabase
    .from('qa_answers')
    .insert({
      thread_id: threadId,
      answerer_id: callerId,
    })
    .select('id')
    .single()

  if (answerError) {
    return { success: false, error: `Failed to create answer: ${answerError.message}` }
  }

  const answerId = answerData.id

  // Step 2: Insert qa_answer_versions row
  const { data: versionData, error: versionError } = await supabase
    .from('qa_answer_versions')
    .insert({
      answer_id: answerId,
      body: answerBody,
    })
    .select('id')
    .single()

  if (versionError) {
    return { success: false, error: `Failed to create answer version: ${versionError.message}` }
  }

  const versionId = versionData.id

  // Step 3: Update qa_answers.current_version_id
  const { error: updateAnswerError } = await supabase
    .from('qa_answers')
    .update({ current_version_id: versionId })
    .eq('id', answerId)

  if (updateAnswerError) {
    return {
      success: false,
      error: `Failed to link answer version: ${updateAnswerError.message}`,
    }
  }

  // Step 4: Insert qa_citations rows (one per citation)
  if (citationRefs.length > 0) {
    const citationRows = citationRefs.map((ref) => ({
      answer_version_id: versionId,
      content_type: ref.contentType,
      content_id: ref.contentId,
    }))

    const { error: citationError } = await supabase.from('qa_citations').insert(citationRows)

    if (citationError) {
      return { success: false, error: `Failed to attach citations: ${citationError.message}` }
    }
  }

  // Step 5: Update qa_threads.status to 'answered'
  const { error: statusError } = await supabase
    .from('qa_threads')
    .update({ status: 'answered' })
    .eq('id', threadId)

  if (statusError) {
    return { success: false, error: `Failed to mark thread answered: ${statusError.message}` }
  }

  return { success: true, answerId }
}

// Auth wrapper
export async function answerEscalatedThread(
  threadId: string,
  answerBody: string,
  citationRefs: CitationRef[]
): Promise<{ success: true; answerId: string } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()
  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', userId).single()
  if (!user) return { success: false, error: 'User not found' }

  return answerEscalatedThreadCore(supabase, user.id, threadId, answerBody, citationRefs)
}

/**
 * T6.3: Pass the thread escalation up the chain.
 *
 * Delegates to the existing pass_escalation_up_chain RPC function.
 * Security: the RPC function itself verifies the caller is the current
 * addressee and throws if not.
 */
export async function passEscalationUpCore(
  supabase: SupabaseClient,
  callerId: string,
  threadId: string
): Promise<{ success: true; escalationId: string } | { success: false; error: string }> {
  const { data: result, error } = await supabase.rpc('pass_escalation_up_chain', {
    p_thread_id: threadId,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, escalationId: result }
}

// Auth wrapper
export async function passEscalationUp(
  threadId: string
): Promise<{ success: true; escalationId: string } | { success: false; error: string }> {
  const { userId } = await auth()
  if (!userId) return { success: false, error: 'Not authenticated' }

  const supabase = await createServerSupabaseClient()
  const { data: user } = await supabase.from('users').select('id').eq('clerk_id', userId).single()
  if (!user) return { success: false, error: 'User not found' }

  return passEscalationUpCore(supabase, user.id, threadId)
}
