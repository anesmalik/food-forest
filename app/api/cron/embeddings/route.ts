import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase'
import OpenAI from 'openai'
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MAX_ATTEMPTS,
  EMBEDDING_CIRCUIT_BREAKER_THRESHOLD,
  TOKEN_PER_WORD_RATIO,
  CHUNK_TARGET_MIN_TOKENS,
  CHUNK_TARGET_MAX_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  SINGLE_CHUNK_THRESHOLD_TOKENS,
} from '@/lib/embedding-constants'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  try {
    // Step 1: Claim a batch of pending rows atomically.
    const { data: claimedBatch, error: claimError } = await supabase.rpc(
      'claim_embedding_batch',
      { batch_size: EMBEDDING_BATCH_SIZE }
    )

    if (claimError) {
      console.error('failed to claim embedding batch:', claimError)
      return NextResponse.json(
        { error: 'claim batch failed' },
        { status: 500 }
      )
    }

    if (!claimedBatch || claimedBatch.length === 0) {
      return NextResponse.json({ success: true, processed: 0 })
    }

    console.log(`claimed ${claimedBatch.length} embedding queue rows`)

    // Step 2: Load entries and prepare chunks for embedding.
    // Collect all chunks with their metadata for a single OpenAI call.
    type QueueEntry = {
      id: string
      content_type: string
      content_id: string
      status: string
      attempts: number
      last_error: string | null
      created_at: string
    }

    type ChunkWithMeta = {
      text: string
      queue_entry_id: string
      content_type: string
      content_id: string
      chunk_index: number
    }

    const chunks: ChunkWithMeta[] = []
    const entryChunkMap = new Map<string, ChunkWithMeta[]>()
    const attemptedRows = new Set<string>() // Track which rows we've attempted
    let consecutiveFailures = 0
    let processedCount = 0

    for (const queueRow of claimedBatch as QueueEntry[]) {
      attemptedRows.add(queueRow.id)
      try {
        // Load the journal entry (service-role bypasses RLS).
        const { data: entry, error: loadError } = await supabase
          .from('journal_entries')
          .select('id, body, soft_deleted_at')
          .eq('id', queueRow.content_id)
          .single()

        if (loadError || !entry) {
          throw new Error(`failed to load entry: ${loadError?.message || 'not found'}`)
        }

        // If the entry was soft-deleted after being queued, skip it.
        if (entry.soft_deleted_at) {
          console.log(`entry ${queueRow.content_id} was soft-deleted, marking queue row as cancelled`)
          // Leave it as is (already cancelled by the trigger), don't update.
          continue
        }

        // Step 2b: Chunk the entry body.
        const rawChunks = chunkText(entry.body || '')
        const entryChunks: ChunkWithMeta[] = rawChunks.map((raw) => ({
          ...raw,
          queue_entry_id: queueRow.id,
          content_type: queueRow.content_type,
          content_id: queueRow.content_id,
        }))
        entryChunkMap.set(queueRow.id, entryChunks)

        for (const chunk of entryChunks) {
          chunks.push(chunk)
        }

        consecutiveFailures = 0 // Reset on successful load
      } catch (err) {
        consecutiveFailures++
        console.error(
          `error loading entry ${queueRow.content_id}:`,
          err instanceof Error ? err.message : String(err)
        )

        const errorMsg = err instanceof Error ? err.message : String(err)

        // Log the failure to usage_events.
        await supabase.from('usage_events').insert({
          user_id: null,
          event_type: 'embedding_failed',
          metadata: {
            content_id: queueRow.content_id,
            attempts: queueRow.attempts + 1,
            error: errorMsg,
          },
        })

        // Increment attempts and update status.
        const newAttempts = queueRow.attempts + 1
        const newStatus = newAttempts >= EMBEDDING_MAX_ATTEMPTS ? 'failed' : 'pending'

        await supabase
          .from('embedding_queue')
          .update({
            attempts: newAttempts,
            last_error: errorMsg,
            status: newStatus,
          })
          .eq('id', queueRow.id)

        if (consecutiveFailures >= EMBEDDING_CIRCUIT_BREAKER_THRESHOLD) {
          console.error(
            `circuit breaker tripped after ${consecutiveFailures} consecutive failures`
          )

          // Log the circuit breaker trip.
          await supabase.from('usage_events').insert({
            user_id: null,
            event_type: 'embedding_circuit_breaker_tripped',
            metadata: {
              consecutive_failures: consecutiveFailures,
            },
          })

          // Reset remaining claimed-but-unprocessed rows back to 'pending'.
          // Only rows that were never attempted (not in attemptedRows) are still in 'processing';
          // those that were attempted but failed are already in pending/failed state.
          for (const queueRow of claimedBatch as QueueEntry[]) {
            if (!attemptedRows.has(queueRow.id)) {
              await supabase
                .from('embedding_queue')
                .update({ status: 'pending' })
                .eq('id', queueRow.id)
            }
          }

          // Return early.
          return NextResponse.json({
            success: true,
            processed: processedCount,
            circuit_breaker_tripped: true,
          })
        }
      }
    }

    if (chunks.length === 0) {
      return NextResponse.json({ success: true, processed: 0 })
    }

    // Step 3: Call OpenAI in a single batched call for all chunks.
    console.log(`embedding ${chunks.length} chunks via OpenAI`)
    let latencyMs = 0
    let embeddings: (number[] | undefined)[] = []

    try {
      const startTime = Date.now()
      const openaiResponse = await openai.embeddings.create({
        model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
        input: chunks.map((c) => c.text),
        dimensions: 1024,
      })
      latencyMs = Date.now() - startTime

      if (!openaiResponse.data) {
        throw new Error('OpenAI returned no embeddings')
      }

      embeddings = openaiResponse.data.map((d) => d.embedding)
    } catch (openaiErr) {
      const errorMsg = openaiErr instanceof Error ? openaiErr.message : String(openaiErr)
      console.error('OpenAI embedding call failed:', errorMsg)

      // On OpenAI error: increment attempts for all rows that contributed chunks.
      // This marks the entire batch as needing retry.
      const affectedRows = new Set<string>()
      for (const chunk of chunks) {
        affectedRows.add(chunk.queue_entry_id)
      }

      for (const queueRow of claimedBatch as QueueEntry[]) {
        if (affectedRows.has(queueRow.id)) {
          const newAttempts = queueRow.attempts + 1
          const newStatus =
            newAttempts >= EMBEDDING_MAX_ATTEMPTS ? 'failed' : 'pending'

          await supabase
            .from('embedding_queue')
            .update({
              attempts: newAttempts,
              last_error: errorMsg,
              status: newStatus,
            })
            .eq('id', queueRow.id)

          // Log the failure.
          await supabase.from('usage_events').insert({
            user_id: null,
            event_type: 'embedding_failed',
            metadata: {
              content_id: queueRow.content_id,
              attempts: newAttempts,
              error: errorMsg,
            },
          })
        }
        // Rows that didn't contribute chunks (failed to load) are already
        // in pending/failed state from the load error handler, no need to update.
      }

      // Return early on OpenAI error.
      return NextResponse.json({
        success: true,
        processed: processedCount,
        openai_error: errorMsg,
      })
    }

    // Step 4: Insert embeddings with pre-insert re-checks.
    // For each chunk, verify the source entry hasn't been soft-deleted
    // and the queue row is still in 'processing' state before inserting.

    type EmbeddingRow = {
      content_type: string
      content_id: string
      chunk_index: number
      chunk_text: string
      embedding: number[]
      model_name: string
    }

    const embeddingsToInsert: EmbeddingRow[] = []
    const insertedContentIds = new Set<string>()

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const embedding = embeddings[i] as number[] | undefined

      if (!embedding || embedding.length === 0) {
        console.warn(`OpenAI returned empty embedding for chunk ${i}`)
        continue
      }

      try {
        // Pre-insert re-check: verify entry still exists and isn't soft-deleted,
        // and that the queue row is still 'processing'.
        const { data: entryCheck } = await supabase
          .from('journal_entries')
          .select('soft_deleted_at')
          .eq('id', chunk.content_id)
          .single()

        if (!entryCheck || entryCheck.soft_deleted_at) {
          console.log(
            `skipping embedding for soft-deleted entry ${chunk.content_id}`
          )
          continue
        }

        const { data: queueCheck } = await supabase
          .from('embedding_queue')
          .select('status')
          .eq('id', chunk.queue_entry_id)
          .single()

        if (!queueCheck || queueCheck.status !== 'processing') {
          console.log(
            `skipping embedding for cancelled queue row ${chunk.queue_entry_id}`
          )
          continue
        }

        // Both checks passed: prepare the embedding row for insertion.
        embeddingsToInsert.push({
          content_type: chunk.content_type,
          content_id: chunk.content_id,
          chunk_index: chunk.chunk_index,
          chunk_text: chunk.text,
          embedding: embedding,
          model_name: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
        })

        insertedContentIds.add(chunk.content_id)
      } catch (err) {
        console.error(`pre-insert re-check failed for chunk ${i}:`, err)
      }
    }

    // Insert all embeddings that passed the re-check.
    if (embeddingsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('embeddings')
        .insert(embeddingsToInsert)

      if (insertError) {
        console.error('failed to insert embeddings:', insertError)
        throw insertError
      }
    }

    // Step 5: Update queue rows to 'done' for entries that had embeddings inserted.
    // Only update rows whose content_id was successfully embedded.
    for (const queueRow of claimedBatch as QueueEntry[]) {
      if (insertedContentIds.has(queueRow.content_id)) {
        await supabase
          .from('embedding_queue')
          .update({
            status: 'done',
            attempts: queueRow.attempts,
          })
          .eq('id', queueRow.id)

        // Log success.
        const entryChunks = entryChunkMap.get(queueRow.id) || []
        await supabase.from('usage_events').insert({
          user_id: null,
          event_type: 'embedding_generated',
          metadata: {
            content_id: queueRow.content_id,
            chunk_count: entryChunks.length,
            latency_ms: latencyMs,
          },
        })

        processedCount++
      }
    }

    return NextResponse.json({
      success: true,
      processed: processedCount,
      embeddings_inserted: embeddingsToInsert.length,
    })
  } catch (err) {
    console.error('embeddings cron failed:', err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * Chunk text into approximately 200–500 token pieces with 50-token overlap,
 * or return a single chunk if the text is under ~500 tokens.
 *
 * Uses word count × 1.3 as a token approximation (not exact, but avoids
 * adding a heavy tokenizer dependency).
 */
function chunkText(text: string): Array<{
  text: string
  chunk_index: number
}> {
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  const estimatedTokens = Math.ceil(words.length * TOKEN_PER_WORD_RATIO)

  // Single chunk if under threshold.
  if (estimatedTokens <= SINGLE_CHUNK_THRESHOLD_TOKENS) {
    return [{ text: text.trim(), chunk_index: 0 }]
  }

  // Multi-chunk: split roughly by paragraph boundaries, respecting token limits.
  const chunks: Array<{ text: string; chunk_index: number }> = []
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0)

  let currentChunk = ''
  let chunkWordCount = 0

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter((w) => w.length > 0)
    const paraTokens = Math.ceil(paraWords.length * TOKEN_PER_WORD_RATIO)

    // If adding this paragraph would exceed the target max, start a new chunk.
    if (
      chunkWordCount > 0 &&
      Math.ceil((chunkWordCount + paraWords.length) * TOKEN_PER_WORD_RATIO) >
        CHUNK_TARGET_MAX_TOKENS
    ) {
      // Flush current chunk.
      if (currentChunk.trim().length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          chunk_index: chunks.length,
        })
      }

      // Start overlap: rewind by last 50 tokens worth of paragraphs, roughly.
      const overlapWords = Math.floor(
        (CHUNK_OVERLAP_TOKENS / TOKEN_PER_WORD_RATIO) * 1.5
      ) // 1.5x as buffer
      const overlapText = currentChunk
        .split(/\s+/)
        .slice(-overlapWords)
        .join(' ')

      currentChunk = overlapText.length > 0 ? overlapText + ' ' : ''
      chunkWordCount = Math.ceil(
        (currentChunk.split(/\s+/).length * TOKEN_PER_WORD_RATIO) / TOKEN_PER_WORD_RATIO
      )
    }

    currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + para
    chunkWordCount += paraWords.length
  }

  // Flush the final chunk.
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      chunk_index: chunks.length,
    })
  }

  return chunks.length > 0
    ? chunks
    : [{ text: text.trim(), chunk_index: 0 }]
}
