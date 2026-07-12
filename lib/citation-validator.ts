// T2.1: Pure function validator for model-generated citations.
// No I/O: this function has no external dependencies, makes no OpenAI/database/network calls.
// Used by T2.3's server action and T3.1's gate to validate model output before use.

export type ValidationResult =
  | { ok: true; summary: string; citations: string[] }
  | { ok: false; reason: string }

/**
 * Validate a cited summary from the model.
 *
 * The model is instructed to return a single JSON object with shape:
 * { "summary": string, "citations": string[] }
 *
 * This function verifies:
 * 1. modelOutput is valid JSON with the exact expected shape.
 * 2. Every citation ID exists in retrievedIdSet (fabrication check).
 * 3. If summary is substantive (non-blank), citations must be non-empty.
 *
 * Returns { ok: false, reason } on any format or validation failure.
 * The reason is for logs/debugging only, not for control flow.
 *
 * @param modelOutput Raw string from the model, expected to be a JSON object.
 * @param retrievedIdSet Set of valid content IDs that can be cited.
 * @returns Validation result with parsed summary/citations on success, or refusal reason on failure.
 */
export function validateCitedSummary(
  modelOutput: string,
  retrievedIdSet: Set<string>
): ValidationResult {
  // Parse JSON.
  let parsed: unknown
  try {
    parsed = JSON.parse(modelOutput)
  } catch {
    return { ok: false, reason: 'modelOutput is not valid JSON' }
  }

  // Check parsed is an object.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'parsed JSON is not an object' }
  }

  // Check summary key exists and is a string.
  const obj = parsed as Record<string, unknown>
  if (!('summary' in obj)) {
    return { ok: false, reason: 'parsed JSON is missing the summary key' }
  }
  if (typeof obj.summary !== 'string') {
    return { ok: false, reason: 'summary is not a string' }
  }

  // Check citations key exists and is an array.
  if (!('citations' in obj)) {
    return { ok: false, reason: 'parsed JSON is missing the citations key' }
  }
  if (!Array.isArray(obj.citations)) {
    return { ok: false, reason: 'citations is not an array' }
  }

  // Check every citation is a string.
  for (const citation of obj.citations) {
    if (typeof citation !== 'string') {
      return { ok: false, reason: `citation element is not a string: ${typeof citation}` }
    }
  }

  // Check every citation ID is in retrievedIdSet (fabrication check).
  for (const citationId of obj.citations) {
    if (!retrievedIdSet.has(citationId)) {
      return { ok: false, reason: `citation ID not found in retrieved set: ${citationId}` }
    }
  }

  // Check: if summary is substantive (non-blank), citations must be non-empty.
  const summary = obj.summary as string
  const trimmedSummary = summary.trim()
  if (trimmedSummary.length > 0 && obj.citations.length === 0) {
    return { ok: false, reason: 'substantive summary (non-blank) with no citations' }
  }

  // Valid: return parsed summary and citations.
  return {
    ok: true,
    summary,
    citations: obj.citations as string[],
  }
}
