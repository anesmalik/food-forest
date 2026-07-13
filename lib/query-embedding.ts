import OpenAI from 'openai'

/**
 * T2.1: Embed a single ad-hoc query string for cross-team query retrieval.
 *
 * Same model and dimensions as the T2.4 embedding cron (OPENAI_EMBEDDING_MODEL,
 * dimensions: 1024), but for one query string rather than a batch of content
 * chunks. No `input_type` parameter — the Cohere search_query/search_document
 * asymmetry does not apply to OpenAI embeddings (stage three spec §0).
 *
 * Throws on failure. Callers on the query path are responsible for catching
 * and converting to a refusal (T2.5) — this function does not retry or
 * degrade, unlike the cron's batch/queue-aware error handling, which doesn't
 * apply to a single ad-hoc query with no queue row behind it.
 *
 * @param query Raw query text from the asker.
 * @returns 1024-dimension embedding vector.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OpenAI API key not configured')
  }

  const openai = new OpenAI({ apiKey })

  const response = await openai.embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    input: query,
    dimensions: 1024,
  })

  const embedding = response.data?.[0]?.embedding
  if (!embedding || embedding.length === 0) {
    throw new Error('OpenAI returned no embedding for query')
  }

  return embedding
}
