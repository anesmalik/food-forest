'use client'

import { useState, useEffect, useTransition } from 'react'
import { assignUserPlacement, getUsersForPlacement } from '@/lib/actions/placement'

type UserRow = {
  id: string
  email: string
  display_name: string
  role: string | null
  supervisor_id: string | null
}

const ROLES = ['admin', 'consultant', 'site_manager', 'foreman'] as const

export default function AdminPlacementPage() {
  const [awaiting, setAwaiting] = useState<UserRow[]>([])
  const [placed, setPlaced] = useState<UserRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function load() {
    startTransition(async () => {
      const { awaiting, placed } = await getUsersForPlacement()
      setAwaiting(awaiting as UserRow[])
      setPlaced(placed as UserRow[])
    })
  }

  useEffect(() => {
    load()
  }, [])

  function supervisorOptions(excludeId: string) {
    return placed.filter((u) => u.id !== excludeId)
  }

  async function handleSubmit(
    targetId: string,
    role: string,
    supervisorId: string | null
  ) {
    setError(null)
    setSuccess(null)

    const result = await assignUserPlacement(
      targetId,
      role as (typeof ROLES)[number],
      supervisorId || null
    )

    if (result.success) {
      setSuccess('Placement updated successfully.')
      load()
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">User Placement</h1>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 border border-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md bg-green-50 p-4 text-sm text-green-700 border border-green-200">
          {success}
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Awaiting Placement</h2>
        {awaiting.length === 0 ? (
          <p className="text-gray-500 text-sm">No users awaiting placement.</p>
        ) : (
          <div className="space-y-4">
            {awaiting.map((user) => (
              <PlacementForm
                key={user.id}
                user={user}
                supervisors={supervisorOptions(user.id)}
                onSubmit={(role, sup) => handleSubmit(user.id, role, sup)}
                disabled={isPending}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Placed Users</h2>
        {placed.length === 0 ? (
          <p className="text-gray-500 text-sm">No placed users yet.</p>
        ) : (
          <div className="space-y-4">
            {placed.map((user) => (
              <PlacementForm
                key={user.id}
                user={user}
                supervisors={supervisorOptions(user.id)}
                onSubmit={(role, sup) => handleSubmit(user.id, role, sup)}
                disabled={isPending}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function PlacementForm({
  user,
  supervisors,
  onSubmit,
  disabled,
}: {
  user: UserRow
  supervisors: UserRow[]
  onSubmit: (role: string, supervisorId: string | null) => void
  disabled: boolean
}) {
  const [role, setRole] = useState(user.role || 'foreman')
  const [supervisorId, setSupervisorId] = useState(user.supervisor_id || '')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(role, supervisorId || null)
      }}
      className="border rounded-lg p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{user.display_name}</p>
          <p className="text-sm text-gray-500">{user.email}</p>
          {user.role && (
            <p className="text-xs text-gray-400 mt-1">
              Current: {user.role}
              {user.supervisor_id
                ? ` → supervisor: ${supervisors.find((s) => s.id === user.supervisor_id)?.display_name || user.supervisor_id}`
                : ''}
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-3 items-end">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="border rounded px-2 py-1"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">Supervisor</span>
          <select
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            className="border rounded px-2 py-1"
          >
            <option value="">None</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name} ({s.role})
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={disabled}
          className="bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
        >
          {user.role ? 'Reparent' : 'Place'}
        </button>
      </div>
    </form>
  )
}