'use server'

import { auth } from '@clerk/nextjs/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase'
import { getCrossTeamQueryCore, type QueryResult, type CompletionGenerator } from '@/lib/actions/query'
import { embedQuery } from '@/lib/query-embedding'

export type QueryUIResult = QueryResult & {
  escalationName?: string | null
}

/**
 * T6.1: Core query UI logic (testable, injectable dependencies).
 *
 * Pipeline:
 * 1. Log query_submitted event
 * 2. Call getCrossTeamQueryCore with the embedder and generator
 * 3. If escalation, look up the recipient's display_name via qa_escalations
 * 4. Log query_answered or query_refused event
 *
 * No auth() call inside — all identity comes from callerId parameter.
 */
export async function submitQueryCore(
  supabase: SupabaseClient,
  callerId: string,
  question: string,
  embedder: (q: string) => Promise<number[]>,
  generator: CompletionGenerator
): Promise<QueryUIResult> {
  // Log query submission
  await supabase.from('usage_events').insert({
    user_id: callerId,
    event_type: 'query_submitted',
    metadata: {
      question_length: question.length,
    },
  })

  // Execute the query
  const modelName = process.env.OPENAI_MODEL || 'gpt-4-turbo'
  const result = await getCrossTeamQueryCore(supabase, callerId, question, modelName, embedder, generator)

  // If refusal with escalation, look up the recipient name
  let escalationName: string | null = null
  if (!result.ok && result.escalatedThreadId) {
    const { data: escalation } = await supabase
      .from('qa_escalations')
      .select('escalated_to')
      .eq('thread_id', result.escalatedThreadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (escalation) {
      const { data: recipient } = await supabase
        .from('users')
        .select('display_name')
        .eq('id', escalation.escalated_to)
        .single()
      escalationName = recipient?.display_name ?? null
    }
  }

  // Log result state
  if (result.ok) {
    await supabase.from('usage_events').insert({
      user_id: callerId,
      event_type: 'query_answered',
      metadata: {
        citation_count: result.citations.length,
        summary_length: result.summary.length,
      },
    })
  } else {
    await supabase.from('usage_events').insert({
      user_id: callerId,
      event_type: 'query_refused',
      metadata: {
        refusal_kind: result.kind,
        has_escalation: !!result.escalatedThreadId,
      },
    })
  }

  return {
    ...result,
    escalationName,
  }
}

async function getCurrentUserId(): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_id', userId)
    .single()

  return data?.id ?? null
}

/**
 * Thin wrapper around submitQueryCore.
 * Resolves auth() and real dependencies, then delegates to core logic.
 */
export async function submitQuery(question: string): Promise<QueryUIResult> {
  const supabase = await createServerSupabaseClient()
  const callerId = await getCurrentUserId()

  if (!callerId) {
    return { ok: false, kind: 'openai_error', reason: 'Not authenticated' }
  }

  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return { ok: false, kind: 'openai_error', reason: 'OpenAI API key not configured' }
  }

  // Create real generator using OpenAI
  const OpenAI = await import('openai').then(m => m.default)
  const generator: CompletionGenerator = async (systemPrompt, userPrompt) => {
    const client = new OpenAI({ apiKey })
    const latencyStartMs = Date.now()

    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
    })

    const latencyMs = Date.now() - latencyStartMs
    return {
      output: response.choices[0]?.message?.content || '',
      tokensIn: response.usage?.prompt_tokens ?? null,
      tokensOut: response.usage?.completion_tokens ?? null,
      latencyMs,
    }
  }

  return submitQueryCore(supabase, callerId, question, embedQuery, generator)
}
