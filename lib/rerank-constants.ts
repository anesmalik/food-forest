// Re-rank configuration (stage three spec §1.7). Weights live here, nowhere
// else — do not duplicate these numbers at the call site.
//
// Defaults only. Correctness of the *mechanism* (wiki > qa > journal at equal
// similarity) is unit-tested (T2.3). Whether QA_QUESTION_MATCH_BOOST_WEIGHT is
// large enough to let a strong question match outrank a higher-raw-similarity
// journal chunk is proven against the real fixture in this ticket (T4.5's
// scope, but you'll see it exercised here too) — tune here if the fixture
// proof fails, don't guess blind.

export const CONTENT_TYPE_WEIGHT: Record<
  'wiki_entry_version' | 'qa_answer_version' | 'journal_entry',
  number
> = {
  wiki_entry_version: 1.15,
  qa_answer_version: 1.08,
  journal_entry: 1.0,
}

export const QA_QUESTION_MATCH_BOOST_WEIGHT = 0.5
