import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  const tables = [
    'users', 'entities', 'entity_types', 'tasks',
    'journal_entries', 'journal_entry_entities',
    'wiki_entries', 'wiki_entry_versions',
    'qa_threads', 'qa_answers', 'qa_answer_versions',
    'raw_files', 'raw_file_entities',
    'embeddings', 'ai_call_log', 'usage_events'
  ]

  const snapshot: Record<string, any[]> = {}

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) {
      console.error(`export failed on table ${table}:`, error)
      return NextResponse.json({ error: `failed on ${table}` }, { status: 500 })
    }
    snapshot[table] = data ?? []
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `export-${timestamp}.json`
  const content = JSON.stringify(snapshot, null, 2)

  const { error: uploadError } = await supabase.storage
    .from('exports')
    .upload(filename, new Blob([content], { type: 'application/json' }), {
      contentType: 'application/json',
    })

  if (uploadError) {
    console.error('upload failed:', uploadError)
    return NextResponse.json({ error: 'upload failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, filename })
}