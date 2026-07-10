'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  getEntities,
  getEntityTypes,
  createEntity,
  updateEntity,
  deactivateEntity,
  reactivateEntity,
  type EntityRow,
  type EntityType,
} from '@/lib/actions/entities'

export default function AdminEntitiesPage() {
  const [entities, setEntities] = useState<EntityRow[]>([])
  const [types, setTypes] = useState<EntityType[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [showCreateForm, setShowCreateForm] = useState(false)

  function load() {
    startTransition(async () => {
      const [entityData, typeData] = await Promise.all([getEntities(), getEntityTypes()])
      setEntities(entityData)
      setTypes(typeData)
    })
  }

  useEffect(() => {
    load()
  }, [])

  function flashError(msg: string) {
    setError(msg)
    setSuccess(null)
  }

  function flashSuccess(msg: string) {
    setSuccess(msg)
    setError(null)
  }

  async function handleCreate(name: string, type: string) {
    setError(null)
    setSuccess(null)
    const result = await createEntity(name, type, null)
    if (result.success) {
      flashSuccess(`Created "${name}".`)
      setShowCreateForm(false)
      load()
    } else {
      flashError(result.error)
    }
  }

  async function handleUpdate(id: string, name: string, type: string) {
    setError(null)
    setSuccess(null)
    const result = await updateEntity(id, { name, type })
    if (result.success) {
      flashSuccess(`Updated "${name}".`)
      load()
    } else {
      flashError(result.error)
    }
  }

  async function handleDeactivate(id: string, name: string) {
    setError(null)
    setSuccess(null)
    const result = await deactivateEntity(id)
    if (result.success) {
      flashSuccess(`Deactivated "${name}".`)
      load()
    } else {
      flashError(result.error)
    }
  }

  async function handleReactivate(id: string, name: string) {
    setError(null)
    setSuccess(null)
    const result = await reactivateEntity(id)
    if (result.success) {
      flashSuccess(`Reactivated "${name}".`)
      load()
    } else {
      flashError(result.error)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Entities</h1>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 rounded text-sm font-medium"
        >
          {showCreateForm ? 'Cancel' : 'New Entity'}
        </button>
      </div>

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

      {showCreateForm && (
        <CreateEntityForm types={types} onSubmit={handleCreate} disabled={isPending} />
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">All Entities</h2>
        {entities.length === 0 ? (
          <p className="text-gray-500 text-sm">No entities yet.</p>
        ) : (
          <div className="space-y-4">
            {entities.map((entity) => (
              <EntityRowItem
                key={entity.id}
                entity={entity}
                types={types}
                onUpdate={handleUpdate}
                onDeactivate={handleDeactivate}
                onReactivate={handleReactivate}
                disabled={isPending}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function CreateEntityForm({
  types,
  onSubmit,
  disabled,
}: {
  types: EntityType[]
  onSubmit: (name: string, type: string) => void
  disabled: boolean
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState(types[0]?.key ?? '')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onSubmit(name.trim(), type)
      }}
      className="border rounded-lg p-4 space-y-3"
    >
      <h3 className="font-medium">Create Entity</h3>
      <div className="flex gap-3 items-end">
        <label className="flex flex-col text-sm flex-1">
          <span className="mb-1 text-gray-600">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border rounded px-2 py-1"
            placeholder="e.g. Site B"
            required
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="border rounded px-2 py-1"
          >
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={disabled || !name.trim()}
          className="bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </form>
  )
}

function EntityRowItem({
  entity,
  types,
  onUpdate,
  onDeactivate,
  onReactivate,
  disabled,
}: {
  entity: EntityRow
  types: EntityType[]
  onUpdate: (id: string, name: string, type: string) => void
  onDeactivate: (id: string, name: string) => void
  onReactivate: (id: string, name: string) => void
  disabled: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entity.name)
  const [type, setType] = useState(entity.type)
  const isDeactivated = entity.deactivated_at !== null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onUpdate(entity.id, name.trim(), type)
    setEditing(false)
  }

  if (editing) {
    return (
      <form
        onSubmit={handleSubmit}
        className={`border rounded-lg p-4 space-y-3 ${isDeactivated ? 'opacity-60' : ''}`}
      >
        <div className="flex gap-3 items-end">
          <label className="flex flex-col text-sm flex-1">
            <span className="mb-1 text-gray-600">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 text-gray-600">Type</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="border rounded px-2 py-1"
            >
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={disabled}
            className="bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 rounded text-sm font-medium disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setName(entity.name)
              setType(entity.type)
              setEditing(false)
            }}
            className="border px-4 py-1.5 rounded text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div
      className={`border rounded-lg p-4 flex items-center justify-between ${
        isDeactivated ? 'opacity-50 bg-gray-50' : ''
      }`}
    >
      <div>
        <p className={`font-medium ${isDeactivated ? 'line-through' : ''}`}>{entity.name}</p>
        <p className="text-sm text-gray-500">
          {entity.type}
          {isDeactivated && (
            <span className="ml-2 text-xs text-red-500">
              deactivated {new Date(entity.deactivated_at!).toLocaleDateString()}
            </span>
          )}
        </p>
      </div>
      <div className="flex gap-2">
        {!isDeactivated ? (
          <>
            <button
              onClick={() => setEditing(true)}
              disabled={disabled}
              className="border px-3 py-1 rounded text-sm font-medium disabled:opacity-50"
            >
              Edit
            </button>
            <button
              onClick={() => onDeactivate(entity.id, entity.name)}
              disabled={disabled}
              className="border border-red-300 text-red-600 px-3 py-1 rounded text-sm font-medium disabled:opacity-50"
            >
              Deactivate
            </button>
          </>
        ) : (
          <button
            onClick={() => onReactivate(entity.id, entity.name)}
            disabled={disabled}
            className="border px-3 py-1 rounded text-sm font-medium disabled:opacity-50"
          >
            Reactivate
          </button>
        )}
      </div>
    </div>
  )
}
