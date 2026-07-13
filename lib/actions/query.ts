'use server'

import { auth } from '@clerk/nextjs/server'
import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase'
import { embedQuery } from '@/lib/query-embedding'
import { rerank, type SearchCorpusRow } from '@/lib/rerank'
import { validateCitedSummary } from '@/lib/citation-validator'

export type QueryResult =
  | { ok: true; summary: string; citations: string[] }
  | {
      ok: false
      kind: 'no_results' | 'validation_failed' | 'openai_error'
      reason: string
      escalatedThreadId?: string | null
    }

const MATCH_LIMIT = 20
const TOP_N_FOR_PROMPT = 8

export type CompletionGenerator = (
  systemPrompt: string,
  userPrompt: string
) => Promise<{ output: string; tokensIn: number | null; tokensOut: number | null; latencyMs: number }>

function createOpenAIGenerator(modelName: string, apiKey: string): CompletionGenerator {
  return async (systemPrompt, userPrompt) => {
    const client = new OpenAI({ apiKey })
    const latencyStartMs = Date.now()

    const response = await client.chat.completions.create({
      model: modelName,
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
}

async function getCurrentUserId(supabase: SupabaseClient): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null

  const { data } = await supabase.from('users').select('id').eq('clerk_id', userId).single()
  return data?.id ?? null
}

/**
 * T4.1: Core cross-team query logic (testable, injectable dependencies).
 *
 * Pipeline (spec §1.6):
 * 1. Embed the query (T2.1, embedQuery)
 * 2. search_corpus (T1.6) — scope + tombstone exclusions applied in SQL,
 *    ef_search set inside the function (T2.2)
 * 3. Re-rank (T2.3, pure)
 * 4. Assemble grounding prompt from top-N re-ranked results, each labelled
 *    with its content_id
 * 5. Call OpenAI (T2.4)
 * 6. Validate citations (T4.2 — reuses citation-validator.ts, not duplicated)
 * 7. (Per-reader citation resolution is T4.3, applied at render time, not here)
 * 8. Return answer or refuse (T2.5)
 * 9. Log to ai_call_log, every attempt including refusals (T4.4)
 */
export async function getCrossTeamQueryCore(
  supabase: SupabaseClient,
  callerId: string,
  query: string,
  modelName: string,
  embedder: (q: string) => Promise<number[]>,
  generator: CompletionGenerator
): Promise<QueryResult> {
  let queryEmbedding: number[]
  try {
    queryEmbedding = await embedder(query)
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Failed to embed query'
    await logAttempt(supabase, callerId, query, modelName, '', reason, false, [], null, null, null)
    return { ok: false, kind: 'openai_error', reason: 'Failed to embed query' }
  }

  const { data: rows, error: retrievalError } = await supabase.rpc('search_corpus', {
    query_embedding: `[${queryEmbedding.join(',')}]`,
    match_limit: MATCH_LIMIT,
  })

  if (retrievalError) {
    const reason = `search_corpus failed: ${retrievalError.message}`
    await logAttempt(supabase, callerId, query, modelName, '', reason, false, [], null, null, null)
    return { ok: false, kind: 'openai_error', reason: 'Retrieval failed' }
  }

  const retrievedRows = (rows ?? []) as SearchCorpusRow[]

  if (retrievedRows.length === 0) {
    await logAttempt(supabase, callerId, query, modelName, '', 'No results retrieved', false, [], null, null, null)
    const { data: escalatedThreadId, error: escalationError } = await supabase.rpc('escalate_refused_question', {
      p_question: query,
    })
    return { ok: false, kind: 'no_results', reason: 'No results retrieved', escalatedThreadId: escalationError ? null : escalatedThreadId }
  }

  const ranked = rerank(retrievedRows).slice(0, TOP_N_FOR_PROMPT)

  const contextText = ranked
    .map((r, i) => `Source ${i + 1} (id: ${r.content_id}, type: ${r.content_type}): ${r.chunk_text}`)
    .join('\n\n')

  const systemPrompt = `You are answering a question by searching across the organization's journal entries, wiki, and past Q&A.
Answer strictly from the sources below. Do not use outside knowledge.
Return a JSON object with shape: { "summary": string, "citations": string[] }
where citations are the source ids (UUIDs) from the sources below that support the answer.
Only cite sources that actually support the answer — do not fabricate citations.
If the sources do not contain enough to answer confidently, return an empty summary and empty citations.
If the summary is substantive (non-blank), citations must be non-empty.`

  const userPrompt = `Question: ${query}\n\nSources:\n\n${contextText}`

  let rawModelOutput: string
  let tokensIn: number | null = null
  let tokensOut: number | null = null
  let latencyMs: number | null = null

  const generatorStartedAt = Date.now()
  try {
    const genResult = await generator(systemPrompt, userPrompt)
    rawModelOutput = genResult.output
    tokensIn = genResult.tokensIn
    tokensOut = genResult.tokensOut
    latencyMs = genResult.latencyMs
  } catch (err) {
    latencyMs = Date.now() - generatorStartedAt
    const reason = `Generator error: ${err instanceof Error ? err.message : 'Unknown error'}`
    await logAttempt(
      supabase, callerId, query, modelName, userPrompt.slice(0, 5000), reason, false,
      ranked.map((r) => r.content_id), latencyMs, tokensIn, tokensOut
    )
    return { ok: false, kind: 'openai_error', reason: 'Failed to generate answer' }
  }

  const retrievedIdSet = new Set(ranked.map((r) => r.content_id))
  const validationResult = validateCitedSummary(rawModelOutput, retrievedIdSet)

  await logAttempt(
    supabase, callerId, query, modelName, userPrompt.slice(0, 5000), rawModelOutput.slice(0, 10000),
    validationResult.ok, ranked.map((r) => r.content_id), latencyMs, tokensIn, tokensOut
  )

  if (validationResult.ok) {
    return { ok: true, summary: validationResult.summary, citations: validationResult.citations }
  }
  const { data: escalatedThreadId, error: escalationError } = await supabase.rpc('escalate_refused_question', {
    p_question: query,
  })
  return { ok: false, kind: 'validation_failed', reason: validationResult.reason, escalatedThreadId: escalationError ? null : escalatedThreadId }
}

async function logAttempt(
  supabase: SupabaseClient, callerId: string, query: string, modelName: string, prompt: string,
  response: string, citationsValid: boolean, retrievedIds: string[],
  latencyMs: number | null, tokensIn: number | null, tokensOut: number | null
): Promise<void> {
  try {
    await supabase.from('ai_call_log').insert({
      user_id: callerId, function: 'cross_team_query', query, model_name: modelName,
      prompt, response, citations_valid: citationsValid, latency_ms: latencyMs,
      tokens_in: tokensIn, tokens_out: tokensOut, retrieved_ids: retrievedIds,
    })
  } catch (err) {
    console.error('ai_call_log insert failed:', { function: 'cross_team_query', user_id: callerId }, err)
  }
}

export async function crossTeamQuery(query: string): Promise<QueryResult> {
  const supabase = await createServerSupabaseClient()

  const callerId = await getCurrentUserId(supabase)
  if (!callerId) {
    return { ok: false, kind: 'openai_error', reason: 'Not authenticated' }
  }

  const apiKey = process.env.OPENAI_API_KEY
  const modelName = process.env.OPENAI_MODEL || 'gpt-4-turbo'

  if (!apiKey) {
    return { ok: false, kind: 'openai_error', reason: 'OpenAI API key not configured' }
  }

  const generator = createOpenAIGenerator(modelName, apiKey)
  return getCrossTeamQueryCore(supabase, callerId, query, modelName, embedQuery, generator)
}
