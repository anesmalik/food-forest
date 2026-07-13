/**
 * T3.3 — Local seed script for the stage-three test fixture.
 *
 * NOT a migration — lives outside supabase/migrations/, only invoked directly.
 * Must never load this fixture against the remote Supabase project
 * (dguamjezvrmdfoyctbxp). Violation would push fake foremen and restricted
 * journal entries into the real corpus where they would get embedded and
 * potentially cited to a real supervisor.
 *
 * This is a MECHANICS fixture, not a quality benchmark. It proves the SQL
 * access-control and re-rank machinery is correct against known, engineered
 * inputs. It cannot and does not claim to measure real retrieval quality.
 *
 * Run: npx tsx scripts/fixtures/seed-local.ts
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import pg from 'pg'

const { Client } = pg

// ---------------------------------------------------------------------------
// Validation functions — each pure, independently testable.
// ---------------------------------------------------------------------------

/**
 * Check if the database host is local only.
 * Returns true only for 127.0.0.1, localhost, ::1, or the Supabase CLI's
 * local Docker network hostname (host.docker.internal).
 */
export function isLocalHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    let host = parsed.hostname || ''
    // Strip brackets from IPv6 addresses (PostgreSQL URLs may include [::1])
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1)
    }
    return ['127.0.0.1', 'localhost', '::1', 'host.docker.internal'].includes(host)
  } catch {
    return false
  }
}

/**
 * Check that the connection string does NOT contain the remote project ID or
 * Supabase cloud hostnames. Returns false if any of those strings are present
 * anywhere in the connection string.
 */
export function isNotRemoteProject(url: string): boolean {
  const remoteMarkers = ['dguamjezvrmdfoyctbxp', '.supabase.co', '.supabase.com']
  return !remoteMarkers.some((marker) => url.includes(marker))
}

// ---------------------------------------------------------------------------
// Connection string resolution and guard checks.
// ---------------------------------------------------------------------------

async function getLocalConnectionString(): Promise<string> {
  try {
    const output = execSync('supabase status -o json', {
      cwd: path.dirname(__dirname),
      encoding: 'utf-8',
    })
    // Find the JSON object (starts with '{'), skip warning/status lines
    const jsonStart = output.indexOf('{')
    if (jsonStart === -1) {
      throw new Error('No JSON output found in supabase status response')
    }
    const jsonString = output.substring(jsonStart)
    const status = JSON.parse(jsonString)
    return status.DB_URL
  } catch (err) {
    throw new Error(
      `Failed to resolve local Supabase connection: ${err instanceof Error ? err.message : String(err)}. ` +
        `Make sure the local Supabase stack is running (run 'supabase start').`
    )
  }
}

/**
 * Check that the connection string passes both safety guards. Prints banner
 * before any checks, so the banner is logged even if this throws.
 * Throws immediately if either guard fails.
 */
export async function guardConnectionString(connectionString: string): Promise<void> {
  // Print banner before guard checks, so it prints even on a refused run.
  console.log('⚠️  MECHANICS FIXTURE, NOT A QUALITY BENCHMARK.')
  console.log('   Engineered embedding vectors, not real OpenAI output.')
  console.log('   This proves SQL access-control and re-rank mechanics only.')
  console.log('   It does not measure real retrieval quality or Arabic embedding')
  console.log('   quality — see stage-three spec §1.14.')
  console.log()

  // Guard 1: Must be local host
  if (!isLocalHost(connectionString)) {
    throw new Error(
      `GUARD FAILED: isLocalHost check failed for connection string: ${connectionString}. ` +
        `The connection host is not a local address. Refusing to proceed.`
    )
  }

  // Guard 2: Must not be remote project
  if (!isNotRemoteProject(connectionString)) {
    throw new Error(
      `GUARD FAILED: isNotRemoteProject check failed. ` +
        `Connection string contains remote project marker (dguamjezvrmdfoyctbxp, .supabase.co, or .supabase.com). ` +
        `Refusing to proceed. The fixture must never be loaded against the remote Supabase project.`
    )
  }
}

// ---------------------------------------------------------------------------
// Table truncation (scoped to fixture UUID prefixes only — no CASCADE).
// ---------------------------------------------------------------------------

/**
 * Delete only fixture rows (identified by their deliberately namespaced UUID
 * prefixes) from the tables this script populates. Never uses CASCADE, which
 * would wipe unrelated tables that happen to have foreign keys into these.
 */
export async function truncateTables(client: pg.Client): Promise<void> {
  // Delete embeddings first (no FK constraints), then work backwards through the FK graph.
  // Fixture embeddings reference content_id with prefixes:
  // - 20000000 (journal_entries)
  // - 31000000 (wiki_entry_versions)
  // - 40000000 (qa_threads)
  // - 42000000 (qa_answer_versions)
  // - 90000000 (bulk-filler embeddings)
  // Cast UUID to text for LIKE pattern matching.
  await client.query(`
    DELETE FROM embeddings
    WHERE content_id::text LIKE '20000000-%'
       OR content_id::text LIKE '31000000-%'
       OR content_id::text LIKE '40000000-%'
       OR content_id::text LIKE '42000000-%'
       OR content_id::text LIKE '90000000-%'
  `)

  // qa_answer_versions (prefix 42000000-)
  await client.query(`DELETE FROM qa_answer_versions WHERE id::text LIKE '42000000-%'`)

  // qa_answers (prefix 41000000-)
  await client.query(`DELETE FROM qa_answers WHERE id::text LIKE '41000000-%'`)

  // qa_threads (prefix 40000000-)
  await client.query(`DELETE FROM qa_threads WHERE id::text LIKE '40000000-%'`)

  // wiki_entry_versions (prefix 31000000-)
  await client.query(`DELETE FROM wiki_entry_versions WHERE id::text LIKE '31000000-%'`)

  // wiki_entries (prefix 30000000-)
  await client.query(`DELETE FROM wiki_entries WHERE id::text LIKE '30000000-%'`)

  // journal_entries (prefix 20000000-)
  // Handle both forward refs (author_id, corrects_entry_id) and self-refs
  await client.query(`DELETE FROM journal_entries WHERE id::text LIKE '20000000-%'`)

  // users (prefix 10000000-) — last, since most FKs point here
  await client.query(`DELETE FROM users WHERE id::text LIKE '10000000-%'`)
}

// ---------------------------------------------------------------------------
// Fixture loading.
// ---------------------------------------------------------------------------

/**
 * Load the fixture SQL file into the database. On any error, throws immediately
 * without attempting recovery — partial load is worse than no load.
 */
export async function loadFixture(client: pg.Client, fixturePath: string): Promise<void> {
  let sql: string
  try {
    sql = fs.readFileSync(fixturePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read fixture file at ${fixturePath}: ${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    await client.query(sql)
  } catch (err) {
    throw new Error(
      `Failed to load fixture SQL. Partial load is worse than no load. Aborting. ` +
        `Error: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

// ---------------------------------------------------------------------------
// Row count verification (for testing and diagnostics).
// ---------------------------------------------------------------------------

/**
 * Reindex the HNSW index on embeddings table.
 * Works around a known local db-reset corruption issue where the index
 * becomes corrupted and search_corpus returns no results.
 */
export async function reindexEmbeddingsIndex(client: pg.Client): Promise<void> {
  await client.query('REINDEX INDEX embeddings_embedding_hnsw_idx')
}

/**
 * Query row counts from all fixture tables. Used after loading to verify
 * expected counts, and in tests to confirm the database state.
 */
export async function getRowCounts(client: pg.Client): Promise<Record<string, number>> {
  const tables = [
    'users',
    'journal_entries',
    'wiki_entries',
    'wiki_entry_versions',
    'qa_threads',
    'qa_answers',
    'qa_answer_versions',
    'embeddings',
  ]

  const counts: Record<string, number> = {}
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*) as count FROM ${table}`)
    counts[table] = parseInt(result.rows[0].count, 10)
  }
  return counts
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let client: pg.Client | null = null

  try {
    // Resolve connection string
    const connectionString = await getLocalConnectionString()

    // Run guard checks (prints banner before checks)
    await guardConnectionString(connectionString)

    // Connect to database
    client = new Client({ connectionString })
    await client.connect()

    // Truncate tables (after guard passes)
    console.log('Truncating fixture tables...')
    await truncateTables(client)

    // Load fixture
    const fixturePath = path.join(__dirname, 'output', 'stage-three-fixture.sql')
    console.log(`Loading fixture from ${fixturePath}...`)
    await loadFixture(client, fixturePath)

    // Reindex HNSW index (works around a known local db-reset corruption issue)
    console.log('Reindexing HNSW index (works around a known local db-reset corruption issue)...')
    await reindexEmbeddingsIndex(client)

    // Verify row counts
    const counts = await getRowCounts(client)
    console.log()
    console.log('Fixture loaded successfully. Row counts:')
    console.log(`  users: ${counts.users}`)
    console.log(`  journal_entries: ${counts.journal_entries}`)
    console.log(`  wiki_entries: ${counts.wiki_entries}`)
    console.log(`  wiki_entry_versions: ${counts.wiki_entry_versions}`)
    console.log(`  qa_threads: ${counts.qa_threads}`)
    console.log(`  qa_answers: ${counts.qa_answers}`)
    console.log(`  qa_answer_versions: ${counts.qa_answer_versions}`)
    console.log(`  embeddings: ${counts.embeddings}`)
  } catch (err) {
    console.error()
    console.error('❌ Error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  } finally {
    if (client) {
      await client.end()
    }
  }
}

// Only run main() if this script is run directly, not when imported for testing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
