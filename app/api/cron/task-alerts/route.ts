import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase'

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  try {
    // Helper to get qualifying tasks (overdue + quiet) at a given threshold.
    // Finds tasks where:
    // - state in ('assigned', 'in_progress')
    // - due_date < threshold
    // - assignee has no journal entries in the last 48h
    const getQuietTasks = async (daysThreshold: number) => {
      const now = new Date()
      const thresholdDate = new Date(now.getTime() - daysThreshold * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0]
      const quietCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()

      // Raw SQL query to efficiently find qualifying tasks
      const { data, error } = await supabase.rpc('get_quiet_overdue_tasks', {
        due_threshold_date: thresholdDate,
        quiet_cutoff_ts: quietCutoff,
      })

      if (error) {
        console.error(`failed to fetch quiet tasks (${daysThreshold}d threshold):`, error)
        return null
      }

      // Extract IDs from the returned records
      return (data || []).map((record: { id: string }) => record.id)
    }

    // Step 1: Alert (24h threshold)
    const alertTasks = await getQuietTasks(1) // 1 day = 24 hours
    if (alertTasks === null) {
      return NextResponse.json(
        { error: 'failed to fetch alert tasks' },
        { status: 500 }
      )
    }

    let alertsFired = 0
    for (const taskId of alertTasks) {
      try {
        // Use insert ... on conflict (task_id, alert_type) do nothing
        // to handle duplicate keys gracefully
        const { data: inserted, error: insertError } = await supabase
          .from('task_alerts')
          .insert({
            task_id: taskId,
            alert_type: 'overdue_quiet',
          })
          .select()

        if (insertError) {
          // Check if it's a unique constraint violation (alert already exists)
          if (insertError.code === '23505') {
            console.log(`alert already exists for task ${taskId}`)
            continue
          }
          console.error(`failed to insert alert for task ${taskId}:`, insertError)
          continue
        }

        // Only log telemetry if we actually inserted a row
        if (inserted && inserted.length > 0) {
          await supabase.from('usage_events').insert({
            user_id: null,
            event_type: 'alert_fired',
            metadata: {
              task_id: taskId,
              alert_type: 'overdue_quiet',
            },
          })

          alertsFired++
        }
      } catch (err) {
        console.error(
          `error processing alert for task ${taskId}:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    // Step 2: Missed (7 day threshold)
    const missedTasks = await getQuietTasks(7)
    if (missedTasks === null) {
      return NextResponse.json(
        { error: 'failed to fetch missed tasks' },
        { status: 500 }
      )
    }

    let tasksTransitioned = 0
    for (const taskId of missedTasks) {
      try {
        // Call expire_task() — it handles no-ops internally via exception catching
        await supabase.rpc('expire_task', { target: taskId })

        // Check if the task actually transitioned to 'missed'
        const { data: taskCheck, error: checkError } = await supabase
          .from('tasks')
          .select('state')
          .eq('id', taskId)
          .single()

        if (checkError) {
          console.error(`failed to check task state for ${taskId}:`, checkError)
          continue
        }

        if (taskCheck.state === 'missed') {
          // Only log telemetry if actual transition happened
          await supabase.from('usage_events').insert({
            user_id: null,
            event_type: 'task_missed',
            metadata: {
              task_id: taskId,
            },
          })

          tasksTransitioned++
        }
      } catch (err) {
        console.error(
          `error processing missed for task ${taskId}:`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    return NextResponse.json({
      success: true,
      alerts_fired: alertsFired,
      tasks_transitioned: tasksTransitioned,
    })
  } catch (err) {
    console.error('task-alerts cron failed:', err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'unknown error',
      },
      { status: 500 }
    )
  }
}
