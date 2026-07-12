'use server'

import { auth } from '@clerk/nextjs/server'
import OpenAI from 'openai'
import { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase'
import { retrieveSummaryEntries, type SummaryEntry } from '@/lib/summary-retrieval'
import { validateCitedSummary } from '@/lib/citation-validator'

export type SummaryResult =
  | { ok: true; summary: string; citations: string[] }
  | {
      ok: false
      kind: 'rate_limited' | 'no_activity' | 'validation_failed' | 'openai_error'
      reason: string
    }

/**
 * Get the current user's UUID from Clerk ID.
 */
async function getCurrentUserId(): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.from('users').select('id').eq('clerk_id', userId).single()

  return data?.id ?? null
}

/**
 * T2.2: Server action to retrieve journal entries for summary grounding.
 *
 * Wrapper around the core retrieveSummaryEntries function.
 * Uses createServerSupabaseClient() which enforces RLS via Clerk token.
 * The RLS policy (journal_entries_select) handles access control:
 * - Caller must be the author OR in the target user's organizational subtree.
 * - If caller is outside the subtree, RLS returns empty (correct refusal).
 *
 * @param targetUserId UUID of the user whose entries will be summarized.
 * @returns Array of entries ordered oldest-to-newest. Empty array if none found or access denied.
 */
export async function getSummaryRetrievalEntries(
  targetUserId: string
): Promise<SummaryEntry[]> {
  const supabase = await createServerSupabaseClient()
  return retrieveSummaryEntries(supabase, targetUserId)
}

/**
 * OpenAI completion generator — injectable for testing.
 */
export type CompletionGenerator = (
  systemPrompt: string,
  userPrompt: string
) => Promise<{ output: string; tokensIn: number | null; tokensOut: number | null; latencyMs: number }>

/**
 * Default OpenAI completion generator.
 */
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
      temperature: 0.3,
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

/**
 * T2.3: Core summary generation logic (testable, injectable dependencies).
 *
 * Flow:
 * 1. Rate-limit check: call check_recent_summary_call RPC
 *    If rate-limited: return immediately, no generator call, no duplicate log row
 * 2. Retrieve entries via retrieveSummaryEntries (RLS-enforced)
 * 3. If no entries: return "no activity" result, write log row with citations_valid=null
 * 4. Assemble grounding prompt with entries and citation instruction
 * 5. Call generator (OpenAI or mock)
 * 6. Validate response with validateCitedSummary
 * 7. Write ai_call_log row (every path from step 5+ except rate-limit)
 * 8. Return validated result or refusal
 *
 * @param supabase Authenticated Supabase client (enforces RLS)
 * @param callerId UUID of the caller
 * @param targetUserId UUID of the user whose entries will be summarized
 * @param modelName OpenAI model name
 * @param generator Completion generator (real OpenAI or mock)
 * @returns Summary result: either validated summary with citations or refusal with kind+reason.
 */
export async function getSummaryCore(
  supabase: SupabaseClient,
  callerId: string,
  targetUserId: string,
  modelName: string,
  generator: CompletionGenerator
): Promise<SummaryResult> {
  // 1. Rate-limit check
  const { data: isRateLimited, error: rateCheckError } = await supabase.rpc(
    'check_recent_summary_call',
    { target_user_id: targetUserId }
  )

  if (rateCheckError) {
    console.error('check_recent_summary_call error:', rateCheckError)
    return {
      ok: false,
      kind: 'openai_error',
      reason: 'Rate limit check failed',
    }
  }

  if (isRateLimited) {
    return {
      ok: false,
      kind: 'rate_limited',
      reason: 'Summary was just generated, try again shortly',
    }
  }

  // 2. Retrieve entries
  const entries = await retrieveSummaryEntries(supabase, targetUserId)

  // 3. Handle no-recent-activity case
  if (entries.length === 0) {
    // Write log row for this refusal (useful for debugging why feature is unavailable)
    try {
      await supabase.from('ai_call_log').insert({
        user_id: callerId,
        function: 'supervisor_summary',
        query: targetUserId,
        model_name: modelName,
        prompt: '',
        response: 'No recent activity to summarize',
        citations_valid: null,
        retrieved_ids: [],
      })
    } catch (err) {
      console.error(
        'ai_call_log insert failed (no-activity case):',
        {
          function: 'supervisor_summary',
          user_id: callerId,
          target_user_id: targetUserId,
          citations_valid: null,
        },
        err
      )
    }

    return {
      ok: false,
      kind: 'no_activity',
      reason: 'No recent activity to summarize',
    }
  }

  // 4. Assemble grounding prompt
  const entriesText = entries
    .map(
      (e, i) =>
        `Entry ${i + 1} (${new Date(e.created_at).toLocaleDateString()}): ${e.body}`
    )
    .join('\n\n')

  const systemPrompt = `You are a supervisor reviewing your direct report's work journal.
Summarize the key activities, progress, and outcomes from the entries below.
Return a JSON object with shape: { "summary": string, "citations": string[] }
where citations are the entry IDs (UUIDs) from the entries below that support the summary.
Only cite entries that actually support the summary — do not fabricate citations.
If the summary is substantive (non-blank), citations must be non-empty.`

  const userPrompt = `Here are the journal entries to summarize:\n\n${entriesText}\n\nEntry IDs in order: ${entries
    .map((e) => `"${e.id}"`)
    .join(', ')}`

  // 5. Call generator
  let rawModelOutput: string
  let tokensIn: number | null = null
  let tokensOut: number | null = null
  let latencyMs: number | null = null

  const generatorCallStartedAt = Date.now()
  try {
    const genResult = await generator(systemPrompt, userPrompt)
    rawModelOutput = genResult.output
    tokensIn = genResult.tokensIn
    tokensOut = genResult.tokensOut
    latencyMs = genResult.latencyMs
  } catch (err) {
    // Best-effort elapsed time on error — must be a duration (ms elapsed), not an absolute
    // epoch timestamp. Date.now() alone (~1.79e12) overflows the latency_ms `int` column
    // (max ~2.1e9) and silently fails the insert below, which is exactly why this refusal
    // path went unlogged until caught here.
    latencyMs = Date.now() - generatorCallStartedAt
    console.error('Completion generator failed:', err)

    // Log the error for audit
    try {
      await supabase.from('ai_call_log').insert({
        user_id: callerId,
        function: 'supervisor_summary',
        query: targetUserId,
        model_name: modelName,
        prompt: userPrompt.slice(0, 1000),
        response: `Generator error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        citations_valid: false,
        latency_ms: latencyMs,
        retrieved_ids: entries.map((e) => e.id),
      })
    } catch (logErr) {
      console.error(
        'ai_call_log insert failed (generator error case):',
        {
          function: 'supervisor_summary',
          user_id: callerId,
          target_user_id: targetUserId,
          model_name: modelName,
          latency_ms: latencyMs,
          citations_valid: false,
        },
        logErr
      )
    }

    return {
      ok: false,
      kind: 'openai_error',
      reason: 'Failed to generate summary',
    }
  }

  // 6. Validate response
  const validationResult = validateCitedSummary(rawModelOutput, new Set(entries.map((e) => e.id)))

  // 7. Write log row
  try {
    await supabase.from('ai_call_log').insert({
      user_id: callerId,
      function: 'supervisor_summary',
      query: targetUserId,
      model_name: modelName,
      prompt: userPrompt.slice(0, 5000),
      response: rawModelOutput.slice(0, 10000),
      citations_valid: validationResult.ok,
      latency_ms: latencyMs,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      retrieved_ids: entries.map((e) => e.id),
    })
  } catch (err) {
    console.error(
      'ai_call_log insert failed:',
      {
        function: 'supervisor_summary',
        user_id: callerId,
        model_name: modelName,
        latency_ms: latencyMs,
        citations_valid: validationResult.ok,
      },
      err
    )
    // Continue — logging failure does not fail the summary request
  }

  // 8. Return result
  if (validationResult.ok) {
    return {
      ok: true,
      summary: validationResult.summary,
      citations: validationResult.citations,
    }
  } else {
    return {
      ok: false,
      kind: 'validation_failed',
      reason: validationResult.reason,
    }
  }
}

/**
 * T2.3: Server action wrapper for getSummary.
 *
 * Thin wrapper that:
 * 1. Authenticates via Clerk
 * 2. Gets caller ID from database
 * 3. Creates authenticated Supabase client
 * 4. Instantiates OpenAI generator
 * 5. Calls getSummaryCore with all dependencies
 *
 * @param targetUserId UUID of the user whose entries will be summarized.
 * @returns Summary result via getSummaryCore
 */
export async function getSummary(targetUserId: string): Promise<SummaryResult> {
  // Get caller identity
  const callerId = await getCurrentUserId()
  if (!callerId) {
    return {
      ok: false,
      kind: 'openai_error',
      reason: 'Not authenticated',
    }
  }

  const supabase = await createServerSupabaseClient()
  const apiKey = process.env.OPENAI_API_KEY
  const modelName = process.env.OPENAI_MODEL || 'gpt-4-turbo'

  if (!apiKey) {
    return {
      ok: false,
      kind: 'openai_error',
      reason: 'OpenAI API key not configured',
    }
  }

  const generator = createOpenAIGenerator(modelName, apiKey)
  return getSummaryCore(supabase, callerId, targetUserId, modelName, generator)
}
