// T3.1: Stage-three fixture generator.
//
// Not a migration — lives outside supabase/migrations/, never run against
// remote (spec §1.14, hard constraint #1). Run once, output committed as a
// fixed artifact (T3.2), loaded only by T3.3's local-only seed script.
//
// This is a MECHANICS fixture, not a quality benchmark. It proves the SQL
// access-control and re-rank machinery is correct against known, engineered
// inputs. It cannot and does not claim to measure real retrieval quality —
// see the note printed at the top of the generated file, and spec §1.14.
//
// Determinism: no gen_random_uuid(), no Math.random(), no Date.now(). Every
// id is a literal constant from fixture-ids.ts; every embedding vector is
// constructed from a closed-form formula, not sampled.

import * as fs from 'fs'
import * as path from 'path'
import { FIXTURE } from './fixture-ids'

function escapeSql(s: string): string {
  return s.replace(/'/g, "''")
}

function uuidLit(id: string): string {
  return `'${id}'`
}

// ---------------------------------------------------------------------------
// Controlled embedding vectors.
//
// Q and P are exactly orthogonal unit vectors (alternating 1/0 patterns on
// complementary indices — dot product is 0 by construction, proven and used
// identically in T1.6/T2.3's live verification). Any vector of the form
// a*Q + b*P with a^2+b^2=1 has cosine similarity to Q of EXACTLY a, regardless
// of real-world semantic content. This lets the fixture assert precise,
// reproducible similarity relationships (equal similarity, controlled gaps)
// that real OpenAI embeddings of natural text cannot guarantee.
// ---------------------------------------------------------------------------

const DIM = 1024

function buildOrthonormalBasis(): { Q: number[]; P: number[] } {
  const Qraw: number[] = Array.from({ length: DIM }, (_, i) => (i % 2 === 0 ? 1 : 0))
  const Praw: number[] = Array.from({ length: DIM }, (_, i) => (i % 2 === 1 ? 1 : 0))
  const qNorm = Math.sqrt(Qraw.reduce((s, v) => s + v * v, 0))
  const pNorm = Math.sqrt(Praw.reduce((s, v) => s + v * v, 0))
  return {
    Q: Qraw.map((v) => v / qNorm),
    P: Praw.map((v) => v / pNorm),
  }
}

const { Q, P } = buildOrthonormalBasis()

/** Returns a unit vector with cosine similarity to Q of exactly `similarity`. */
function vectorAtSimilarity(similarity: number): number[] {
  if (similarity < -1 || similarity > 1) {
    throw new Error(`similarity out of range: ${similarity}`)
  }
  const a = similarity
  const b = Math.sqrt(1 - similarity * similarity)
  return Q.map((qv, i) => a * qv + b * P[i])
}

function vectorLiteral(v: number[]): string {
  return `'[${v.map((x) => x.toFixed(8)).join(',')}]'`
}

// The canonical test query vector, used identically by T4.5's re-rank proof.
// Documented here so test code can reference FIXTURE / this same construction
// rather than re-deriving it.
export const TEST_QUERY_VECTOR = Q

// ---------------------------------------------------------------------------
// Users — two non-overlapping branches (A, B), a third dead-chain branch (C)
// for escalation testing, an unplaced bare-row user, and an orphaned foreman
// under the unplaced user (proves "unplaced user is never an addressee" and
// the eventual admin-fallback in the same walk).
// ---------------------------------------------------------------------------

type UserRow = {
  id: string
  role: 'admin' | 'consultant' | 'site_manager' | 'foreman' | null
  supervisorId: string | null
  deactivated: boolean
  label: string
}

const users: UserRow[] = [
  { id: FIXTURE.users.admin, role: 'admin', supervisorId: null, deactivated: false, label: 'admin_fixture' },
  { id: FIXTURE.users.consultantA, role: 'consultant', supervisorId: FIXTURE.users.admin, deactivated: false, label: 'consultant_a' },
  { id: FIXTURE.users.siteManagerA1, role: 'site_manager', supervisorId: FIXTURE.users.consultantA, deactivated: true, label: 'site_manager_a1 (DEACTIVATED)' },
  { id: FIXTURE.users.foremanA1a, role: 'foreman', supervisorId: FIXTURE.users.siteManagerA1, deactivated: false, label: 'foreman_a1a' },
  { id: FIXTURE.users.foremanA1b, role: 'foreman', supervisorId: FIXTURE.users.siteManagerA1, deactivated: false, label: 'foreman_a1b' },
  { id: FIXTURE.users.siteManagerA2, role: 'site_manager', supervisorId: FIXTURE.users.consultantA, deactivated: false, label: 'site_manager_a2' },
  { id: FIXTURE.users.foremanA2a, role: 'foreman', supervisorId: FIXTURE.users.siteManagerA2, deactivated: false, label: 'foreman_a2a' },
  { id: FIXTURE.users.consultantB, role: 'consultant', supervisorId: FIXTURE.users.admin, deactivated: false, label: 'consultant_b' },
  { id: FIXTURE.users.siteManagerB1, role: 'site_manager', supervisorId: FIXTURE.users.consultantB, deactivated: false, label: 'site_manager_b1' },
  { id: FIXTURE.users.foremanB1a, role: 'foreman', supervisorId: FIXTURE.users.siteManagerB1, deactivated: false, label: 'foreman_b1a' },
  { id: FIXTURE.users.foremanB1b, role: 'foreman', supervisorId: FIXTURE.users.siteManagerB1, deactivated: false, label: 'foreman_b1b' },
  { id: FIXTURE.users.consultantC, role: 'consultant', supervisorId: FIXTURE.users.admin, deactivated: true, label: 'consultant_c (DEACTIVATED, dead-chain branch)' },
  { id: FIXTURE.users.foremanC1, role: 'foreman', supervisorId: FIXTURE.users.consultantC, deactivated: false, label: 'foreman_c1' },
  { id: FIXTURE.users.unplacedBare, role: null, supervisorId: null, deactivated: false, label: 'unplaced_bare (role IS NULL)' },
  { id: FIXTURE.users.foremanOrphanUnderUnplaced, role: 'foreman', supervisorId: FIXTURE.users.unplacedBare, deactivated: false, label: 'foreman_orphan_under_unplaced' },
]

// ---------------------------------------------------------------------------
// Journal entries. Real Arabic (genuine MSA, not transliteration/filler) on
// four entries, two of them code-switched with embedded English technical
// terms (realistic for bilingual field journals — spec §1.14 constraint #3).
// Restricted entries at three distinct tree depths (consultant, site_manager,
// foreman) to exercise the ancestor-chain predicate away from the leaf level.
// One tombstoned entry with a stray embedding left in place, simulating the
// delete-vs-embed race (spec §1.5, gate item 5).
// ---------------------------------------------------------------------------

type JournalRow = {
  id: string
  authorId: string
  body: string
  sensitivity: 'normal' | 'restricted'
  createdAt: string
  softDeletedAt?: string
}

const journalEntries: JournalRow[] = [
  {
    id: FIXTURE.journal.consultantANormal,
    authorId: FIXTURE.users.consultantA,
    body: 'Reviewed irrigation schedules across both sites this week. Site A is on track; Site B needs a revised watering window before the heat picks up next month.',
    sensitivity: 'normal',
    createdAt: '2026-01-10T09:00:00Z',
  },
  {
    id: FIXTURE.journal.consultantARestricted,
    authorId: FIXTURE.users.consultantA,
    body: 'Concerned about Site A pump capacity going into the new plot expansion. Have not raised this with the client yet — want engineering numbers first.',
    sensitivity: 'restricted',
    createdAt: '2026-01-12T09:00:00Z',
  },
  {
    id: FIXTURE.journal.siteManagerA1Normal,
    authorId: FIXTURE.users.siteManagerA1,
    body: 'Weekly walkthrough of Site A north plot completed. Soil moisture readings within expected range across all rows.',
    sensitivity: 'normal',
    createdAt: '2026-01-14T09:00:00Z',
  },
  {
    id: FIXTURE.journal.siteManagerA1Restricted,
    authorId: FIXTURE.users.siteManagerA1,
    body: 'Foreman crew on north plot seems short-staffed for the upcoming harvest. Not sure yet whether to flag this upward or try to resolve it locally first.',
    sensitivity: 'restricted',
    createdAt: '2026-01-15T09:00:00Z',
  },
  {
    id: FIXTURE.journal.siteManagerA2Normal,
    authorId: FIXTURE.users.siteManagerA2,
    body: 'South plot expansion prep underway. Marked out new rows for next season, coordinating with the seed supplier on timing.',
    sensitivity: 'normal',
    createdAt: '2026-01-16T09:00:00Z',
  },
  {
    id: FIXTURE.journal.siteManagerA2Restricted,
    authorId: FIXTURE.users.siteManagerA2,
    body: 'Budget for south plot expansion is tighter than expected. Have not decided how to handle the shortfall — may need to phase the rollout.',
    sensitivity: 'restricted',
    createdAt: '2026-01-17T09:00:00Z',
  },
  {
    id: FIXTURE.journal.foremanA1aNormalArabic,
    authorId: FIXTURE.users.foremanA1a,
    body: 'تفقدت خط الري الرئيسي في القطعة الشمالية اليوم. لاحظت انخفاضاً في الضغط عند الساعة العاشرة صباحاً، وبعد الفحص وجدت أن أحد الصمامات لم يُغلق بشكل كامل. قمت بإصلاحه مؤقتاً لكن يجب استبداله قبل نهاية الأسبوع.',
    sensitivity: 'normal',
    createdAt: '2026-01-18T07:30:00Z',
  },
  {
    id: FIXTURE.journal.foremanA1aRestrictedArabic,
    authorId: FIXTURE.users.foremanA1a,
    body: 'اجتمعت مع فريق الـ irrigation اليوم لمناقشة مشكلة الـ pressure drop المتكررة. أعتقد أن السبب الحقيقي هو أن المضخة القديمة لم تعد كافية لحجم القطعة الجديدة. لم أخبر المشرف بعد لأنني أريد التأكد أولاً قبل أن أثير الموضوع.',
    sensitivity: 'restricted',
    createdAt: '2026-01-19T07:45:00Z',
  },
  {
    id: FIXTURE.journal.foremanA1bNormal,
    authorId: FIXTURE.users.foremanA1b,
    body: 'Finished trellis repairs on rows 12 through 18. Two posts replaced, wire tension redone across the whole section.',
    sensitivity: 'normal',
    createdAt: '2026-01-20T08:00:00Z',
  },
  {
    id: FIXTURE.journal.foremanA2aNormal,
    authorId: FIXTURE.users.foremanA2a,
    body: 'Noticed a pump pressure drop again on the south line after we brought the new plot online. Same symptom as before the upgrade last quarter.',
    sensitivity: 'normal',
    createdAt: '2026-01-21T08:15:00Z',
  },
  {
    id: FIXTURE.journal.foremanA2aRestricted,
    authorId: FIXTURE.users.foremanA2a,
    body: 'Not confident the new hire on south plot is following the watering checklist. Watching for another week before saying anything.',
    sensitivity: 'restricted',
    createdAt: '2026-01-22T08:20:00Z',
  },
  {
    id: FIXTURE.journal.consultantBNormal,
    authorId: FIXTURE.users.consultantB,
    body: 'Site B quarterly review complete. Overall yield tracking slightly above projection.',
    sensitivity: 'normal',
    createdAt: '2026-02-01T09:00:00Z',
  },
  {
    id: FIXTURE.journal.consultantBRestricted,
    authorId: FIXTURE.users.consultantB,
    body: 'Site B client relationship has been tense since the delayed shipment last month. Handling carefully, not escalating yet.',
    sensitivity: 'restricted',
    createdAt: '2026-02-02T09:00:00Z',
  },
  {
    id: FIXTURE.journal.siteManagerB1Normal,
    authorId: FIXTURE.users.siteManagerB1,
    body: 'Completed intake inspection on this week\u2019s deliveries. All logged, two items flagged for the supplier.',
    sensitivity: 'normal',
    createdAt: '2026-02-05T09:00:00Z',
  },
  {
    id: FIXTURE.journal.siteManagerB1Restricted,
    authorId: FIXTURE.users.siteManagerB1,
    body: 'Considering swapping suppliers after this quarter given the recurring quality issues, but not ready to make the call yet.',
    sensitivity: 'restricted',
    createdAt: '2026-02-06T09:00:00Z',
  },
  {
    id: FIXTURE.journal.foremanB1aNormalArabic,
    authorId: FIXTURE.users.foremanB1a,
    body: 'استلمنا اليوم شحنة الـ seeds الجديدة من المورد. الكمية مطابقة للطلب لكن بعض الأكياس كانت مبللة قليلاً بسبب المطر أثناء النقل. وضعتها في مكان جاف للتأكد من عدم تلفها.',
    sensitivity: 'normal',
    createdAt: '2026-02-08T07:30:00Z',
  },
  {
    id: FIXTURE.journal.foremanB1aRestrictedArabic,
    authorId: FIXTURE.users.foremanB1a,
    body: 'لدي شك بأن بعض البذور التي استلمناها الأسبوع الماضي ليست من نفس الصنف المطلوب. لم أتحقق من هذا رسمياً بعد لأنني لا أريد اتهام المورد قبل التأكد الكامل. سأراقب الإنبات في الأيام القادمة.',
    sensitivity: 'restricted',
    createdAt: '2026-02-09T07:45:00Z',
  },
  {
    id: FIXTURE.journal.foremanB1bNormal,
    authorId: FIXTURE.users.foremanB1b,
    body: 'Weeding pass completed on rows 1 through 9. Ground cover looking healthy overall.',
    sensitivity: 'normal',
    createdAt: '2026-02-10T08:00:00Z',
  },
  {
    id: FIXTURE.journal.foremanC1Normal,
    authorId: FIXTURE.users.foremanC1,
    body: 'Routine equipment check completed, nothing to flag this week.',
    sensitivity: 'normal',
    createdAt: '2026-02-12T08:00:00Z',
  },
  {
    id: FIXTURE.journal.foremanOrphanNormal,
    authorId: FIXTURE.users.foremanOrphanUnderUnplaced,
    body: 'First week on site, getting familiar with the plot layout and existing schedules.',
    sensitivity: 'normal',
    createdAt: '2026-02-14T08:00:00Z',
  },
  {
    id: FIXTURE.journal.foremanA1aTombstoned,
    authorId: FIXTURE.users.foremanA1a,
    body: 'Draft note about a pump issue, written and then deleted the same day after re-checking — this entry simulates a soft-deleted row whose vectors were left behind by the delete-vs-embed race (spec §1.5).',
    sensitivity: 'normal',
    createdAt: '2026-02-15T08:00:00Z',
    softDeletedAt: '2026-02-15T08:05:00Z',
  },
]

// ---------------------------------------------------------------------------
// Wiki (synthetic — wiki has no UI until stage four, but the schema and
// re-rank must handle it correctly now; spec §1.7 requires it be provable
// against the fixture even while inert in production).
// ---------------------------------------------------------------------------

type WikiEntryRow = { id: string; ownerId: string; currentVersionId: string }
type WikiVersionRow = {
  id: string
  wikiEntryId: string
  title: string
  body: string
  sensitivity: 'normal' | 'restricted'
  createdBy: string
  createdAt: string
}

const wikiEntries: WikiEntryRow[] = [
  { id: FIXTURE.wiki.entryA1, ownerId: FIXTURE.users.consultantA, currentVersionId: FIXTURE.wikiVersion.entryA1v1 },
  { id: FIXTURE.wiki.entryA2, ownerId: FIXTURE.users.foremanA1a, currentVersionId: FIXTURE.wikiVersion.entryA2v1 },
  { id: FIXTURE.wiki.entryB1, ownerId: FIXTURE.users.siteManagerB1, currentVersionId: FIXTURE.wikiVersion.entryB1v1 },
]

const wikiVersions: WikiVersionRow[] = [
  {
    id: FIXTURE.wikiVersion.entryA1v1,
    wikiEntryId: FIXTURE.wiki.entryA1,
    title: 'Irrigation Line Maintenance Protocol',
    body: 'Standard checklist for main-line irrigation maintenance: inspect valves monthly, flush filters quarterly, and log any pressure anomalies within 24 hours of observation.',
    sensitivity: 'normal',
    createdBy: FIXTURE.users.consultantA,
    createdAt: '2026-01-25T10:00:00Z',
  },
  {
    id: FIXTURE.wikiVersion.entryA2v1,
    wikiEntryId: FIXTURE.wiki.entryA2,
    title: 'Site A Pump Capacity Notes',
    body: 'Internal notes on Site A pump sizing relative to plot expansion plans, pending formal engineering review.',
    sensitivity: 'restricted',
    createdBy: FIXTURE.users.foremanA1a,
    createdAt: '2026-01-26T10:00:00Z',
  },
  {
    id: FIXTURE.wikiVersion.entryB1v1,
    wikiEntryId: FIXTURE.wiki.entryB1,
    title: 'Seed Intake Inspection Checklist',
    body: 'Checklist for inspecting incoming seed shipments: verify variety against order, check for moisture damage, log any discrepancies before storage.',
    sensitivity: 'normal',
    createdBy: FIXTURE.users.siteManagerB1,
    createdAt: '2026-02-11T10:00:00Z',
  },
]

// ---------------------------------------------------------------------------
// Q&A (synthetic). pumpPressureThread is engineered to closely match
// TEST_QUERY_VECTOR so T4.5 can prove the question-similarity boost lets a
// low-raw-similarity answer outrank a higher-raw-similarity journal entry
// (foremanA2aNormal, above) — the exact mechanism already unit-tested in
// T2.3, now proven end-to-end through the real search_corpus + rerank path.
// ---------------------------------------------------------------------------

const qaThreads = [
  {
    id: FIXTURE.qaThread.pumpPressureThread,
    askerId: FIXTURE.users.foremanA2a,
    question: 'Has anyone seen a pump pressure drop like this before after adding a new plot?',
    status: 'answered' as const,
    createdAt: '2026-01-23T09:00:00Z',
  },
  {
    id: FIXTURE.qaThread.seedShipmentThread,
    askerId: FIXTURE.users.foremanB1b,
    question: "What's the standard procedure for logging a damaged seed shipment?",
    status: 'open' as const,
    createdAt: '2026-02-13T09:00:00Z',
  },
]

const qaAnswers = [
  {
    id: FIXTURE.qaAnswer.pumpPressureAnswer,
    threadId: FIXTURE.qaThread.pumpPressureThread,
    answererId: FIXTURE.users.siteManagerA2,
    currentVersionId: FIXTURE.qaAnswerVersion.pumpPressureAnswerV1,
    createdAt: '2026-01-24T09:00:00Z',
  },
]

const qaAnswerVersions = [
  {
    id: FIXTURE.qaAnswerVersion.pumpPressureAnswerV1,
    answerId: FIXTURE.qaAnswer.pumpPressureAnswer,
    body: 'Yes — Site A had a similar issue after the new plot was added last quarter. The old pump could not keep up with the added draw. We upgraded to a higher-capacity pump and the pressure stabilized within a week.',
    createdAt: '2026-01-24T09:00:00Z',
  },
]

// ---------------------------------------------------------------------------
// Embedding assignments (similarity to TEST_QUERY_VECTOR).
//
// The two load-bearing engineered pairs for T4.5:
//   - wikiVersion.entryA1v1 vs journal.consultantANormal: EQUAL similarity
//     (0.6 each) — proves "wiki outranks journal at equal cosine similarity."
//   - qaAnswerVersion.pumpPressureAnswerV1 (raw similarity 0.3, but its
//     linked question is 0.95) vs journal.foremanA2aNormal (raw similarity
//     0.7, no boost available): proves the question-similarity boost lets
//     the QA answer outrank a higher-raw-similarity journal chunk.
// Every other embedded row gets a moderate, arbitrary-but-deterministic
// similarity so it behaves like ordinary corpus content without interfering
// with either proof.
// ---------------------------------------------------------------------------

const embeddingAssignments: Array<{
  contentType: 'journal_entry' | 'wiki_entry_version' | 'qa_answer_version' | 'qa_question'
  contentId: string
  chunkText: string
  similarity: number
}> = [
  // --- the two engineered proof pairs ---
  { contentType: 'wiki_entry_version', contentId: FIXTURE.wikiVersion.entryA1v1, chunkText: wikiVersions[0].body, similarity: 0.6 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.consultantANormal, chunkText: journalEntries[0].body, similarity: 0.6 },
  { contentType: 'qa_question', contentId: FIXTURE.qaThread.pumpPressureThread, chunkText: qaThreads[0].question, similarity: 0.95 },
  { contentType: 'qa_answer_version', contentId: FIXTURE.qaAnswerVersion.pumpPressureAnswerV1, chunkText: qaAnswerVersions[0].body, similarity: 0.3 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanA2aNormal, chunkText: journalEntries[9].body, similarity: 0.7 },

  // --- everything else: moderate, deterministic, non-interfering similarity ---
  { contentType: 'journal_entry', contentId: FIXTURE.journal.consultantARestricted, chunkText: journalEntries[1].body, similarity: 0.5 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.siteManagerA1Normal, chunkText: journalEntries[2].body, similarity: 0.45 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.siteManagerA1Restricted, chunkText: journalEntries[3].body, similarity: 0.45 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.siteManagerA2Normal, chunkText: journalEntries[4].body, similarity: 0.4 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.siteManagerA2Restricted, chunkText: journalEntries[5].body, similarity: 0.4 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanA1aNormalArabic, chunkText: journalEntries[6].body, similarity: 0.55 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanA1aRestrictedArabic, chunkText: journalEntries[7].body, similarity: 0.55 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanA1bNormal, chunkText: journalEntries[8].body, similarity: 0.3 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanA2aRestricted, chunkText: journalEntries[10].body, similarity: 0.35 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.consultantBNormal, chunkText: journalEntries[11].body, similarity: 0.3 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.consultantBRestricted, chunkText: journalEntries[12].body, similarity: 0.3 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.siteManagerB1Normal, chunkText: journalEntries[13].body, similarity: 0.35 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.siteManagerB1Restricted, chunkText: journalEntries[14].body, similarity: 0.35 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanB1aNormalArabic, chunkText: journalEntries[15].body, similarity: 0.5 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanB1aRestrictedArabic, chunkText: journalEntries[16].body, similarity: 0.5 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanB1bNormal, chunkText: journalEntries[17].body, similarity: 0.25 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanC1Normal, chunkText: journalEntries[18].body, similarity: 0.2 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanOrphanNormal, chunkText: journalEntries[19].body, similarity: 0.2 },
  { contentType: 'journal_entry', contentId: FIXTURE.journal.foremanA1aTombstoned, chunkText: journalEntries[20].body, similarity: 0.6 }, // deliberately high — proves exclusion isn't hiding behind low rank
  { contentType: 'wiki_entry_version', contentId: FIXTURE.wikiVersion.entryA2v1, chunkText: wikiVersions[1].body, similarity: 0.5 },
  { contentType: 'wiki_entry_version', contentId: FIXTURE.wikiVersion.entryB1v1, chunkText: wikiVersions[2].body, similarity: 0.45 },
  { contentType: 'qa_question', contentId: FIXTURE.qaThread.seedShipmentThread, chunkText: qaThreads[1].question, similarity: 0.4 },
]

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

function generateSql(): string {
  const lines: string[] = []

  lines.push('-- Stage three fixture (T3.1/T3.2). GENERATED FILE — do not hand-edit.')
  lines.push('-- Regenerate via scripts/fixtures/generate-fixture.ts, then re-commit.')
  lines.push('--')
  lines.push('-- MECHANICS FIXTURE, NOT A QUALITY BENCHMARK (spec §1.14). Embedding vectors')
  lines.push('-- are engineered (exact cosine similarity by construction), not real OpenAI')
  lines.push('-- output. This proves the SQL access-control and re-rank machinery is')
  lines.push('-- correct against known inputs. It says nothing about real retrieval')
  lines.push('-- quality, and specifically cannot measure the Arabic-embedding-quality')
  lines.push('-- risk accepted in the Cohere-to-OpenAI provider switch. Only real content')
  lines.push('-- in production will ever measure that.')
  lines.push('--')
  lines.push('-- NEVER apply this file against the remote Supabase project. Local only,')
  lines.push('-- via T3.3\'s seed script, which is guarded against a remote target.')
  lines.push('')

  // Users
  lines.push('-- Users: two non-overlapping branches (A, B), a deactivated-supervisor')
  lines.push('-- dead-chain branch (C), an unplaced bare-row user, and an orphaned')
  lines.push('-- foreman reporting to the unplaced user.')
  for (const u of users) {
    const role = u.role ? `'${u.role}'` : 'null'
    const sup = u.supervisorId ? uuidLit(u.supervisorId) : 'null'
    const deactivated = u.deactivated ? "now()" : 'null'
    const cleanName = u.label.split(' (')[0] // strip "(DEACTIVATED)"-style annotations
    if (u.label.includes('(')) {
      lines.push(`-- ${u.label}`)
    }
    lines.push(
      `insert into users (id, clerk_id, email, display_name, role, supervisor_id, deactivated_at) values (${uuidLit(u.id)}, 'fixture_${cleanName}', '${cleanName}@fixture.local', '${escapeSql(cleanName)}', ${role}, ${sup}, ${deactivated});`
    )
  }
  lines.push('')

  // Journal entries
  lines.push('-- Journal entries: normal/restricted at three tree depths, real Arabic')
  lines.push('-- (including code-switched) content on four entries, one tombstoned entry')
  lines.push('-- with an embedding deliberately left in place.')
  for (const j of journalEntries) {
    const softDeleted = j.softDeletedAt ? `'${j.softDeletedAt}'` : 'null'
    lines.push(
      `insert into journal_entries (id, author_id, body, sensitivity, created_at, soft_deleted_at) values (${uuidLit(j.id)}, ${uuidLit(j.authorId)}, '${escapeSql(j.body)}', '${j.sensitivity}', '${j.createdAt}', ${softDeleted});`
    )
  }
  lines.push('')

  // Wiki
  lines.push('-- Wiki (synthetic — no UI until stage four, but retrieval must handle it now).')
  for (const wv of wikiVersions) {
    lines.push(
      `insert into wiki_entries (id, owner_id, created_at) values (${uuidLit(wikiEntries.find((w) => w.id === wv.wikiEntryId)!.id)}, ${uuidLit(wikiEntries.find((w) => w.id === wv.wikiEntryId)!.ownerId)}, '${wv.createdAt}');`
    )
  }
  for (const wv of wikiVersions) {
    lines.push(
      `insert into wiki_entry_versions (id, wiki_entry_id, title, body, sensitivity, created_by, created_at) values (${uuidLit(wv.id)}, ${uuidLit(wv.wikiEntryId)}, '${escapeSql(wv.title)}', '${escapeSql(wv.body)}', '${wv.sensitivity}', ${uuidLit(wv.createdBy)}, '${wv.createdAt}');`
    )
  }
  for (const w of wikiEntries) {
    lines.push(`update wiki_entries set current_version_id = ${uuidLit(w.currentVersionId)} where id = ${uuidLit(w.id)};`)
  }
  lines.push('')

  // Q&A
  lines.push('-- Q&A (synthetic). pumpPressureThread is engineered to closely match')
  lines.push('-- TEST_QUERY_VECTOR for the T4.5 question-similarity-boost proof.')
  for (const t of qaThreads) {
    lines.push(
      `insert into qa_threads (id, asker_id, question, status, visibility_scope, created_at) values (${uuidLit(t.id)}, ${uuidLit(t.askerId)}, '${escapeSql(t.question)}', '${t.status}', 'organization', '${t.createdAt}');`
    )
  }
  for (const a of qaAnswers) {
    lines.push(
      `insert into qa_answers (id, thread_id, answerer_id, created_at) values (${uuidLit(a.id)}, ${uuidLit(a.threadId)}, ${uuidLit(a.answererId)}, '${a.createdAt}');`
    )
  }
  for (const av of qaAnswerVersions) {
    lines.push(
      `insert into qa_answer_versions (id, answer_id, body, created_at) values (${uuidLit(av.id)}, ${uuidLit(av.answerId)}, '${escapeSql(av.body)}', '${av.createdAt}');`
    )
  }
  for (const a of qaAnswers) {
    lines.push(`update qa_answers set current_version_id = ${uuidLit(a.currentVersionId)} where id = ${uuidLit(a.id)};`)
  }
  lines.push('')

  // Engineered embeddings
  lines.push('-- Engineered embeddings: constructed via a*Q + b*P (Q, P exactly orthogonal')
  lines.push('-- unit vectors) so cosine similarity to TEST_QUERY_VECTOR (= Q) is exact by')
  lines.push('-- construction, not sampled from real content.')
  for (const e of embeddingAssignments) {
    const vec = vectorAtSimilarity(e.similarity)
    lines.push(
      `insert into embeddings (content_type, content_id, chunk_index, chunk_text, embedding, model_name) values ('${e.contentType}', ${uuidLit(e.contentId)}, 0, '${escapeSql(e.chunkText.slice(0, 200))}', ${vectorLiteral(vec)}, 'fixture-engineered');`
    )
  }
  lines.push('')

  // Bulk filler for HNSW-vs-seqscan planner test (spec §1.14: "does the planner
  // use the HNSW index at 5,000 rows instead of seq-scanning at 6"). No matching
  // content rows on purpose — can_see_content() correctly excludes these from
  // ever surfacing in search_corpus; they exist purely as index-scan pressure.
  lines.push('-- Bulk filler (~5000 rows) purely for HNSW-vs-seqscan planner testing.')
  lines.push('-- Deliberately orphaned content_ids (90000000- prefix) with no matching')
  lines.push('-- content row — can_see_content() excludes them from every real query.')
  lines.push(`insert into embeddings (content_type, content_id, chunk_index, chunk_text, embedding, model_name)`)
  lines.push(`select`)
  lines.push(`  'journal_entry'::content_type,`)
  lines.push(`  ('90000000-0000-0000-0000-' || lpad(to_hex(i), 12, '0'))::uuid,`)
  lines.push(`  0,`)
  lines.push(`  'bulk filler row ' || i,`)
  lines.push(`  (select ('[' || string_agg(`)
  lines.push(`     case when ((i + d) % 2) = 0 then '0.9' else '0.1' end,`)
  lines.push(`     ','`)
  lines.push(`   ) || ']')::vector(1024)`)
  lines.push(`   from generate_series(0, 1023) d),`)
  lines.push(`  'fixture-bulk-filler'`)
  lines.push(`from generate_series(1, 5000) i;`)
  lines.push('')

  return lines.join('\n')
}

if (require.main === module) {
  const outputPath = path.join(__dirname, 'output', 'stage-three-fixture.sql')
  fs.writeFileSync(outputPath, generateSql(), 'utf8')
  console.log(`Wrote fixture to ${outputPath}`)
}
