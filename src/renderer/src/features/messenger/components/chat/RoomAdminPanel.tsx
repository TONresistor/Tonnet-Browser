import { useEffect, useRef, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { ChatRoomState } from '@shared/ipc-contract/chat'
import { AppIcon } from '@/components/ui/AppIcon'

export type RoomMutation =
  | { action: 'metadata'; name: string; description: string }
  | { action: 'pin' | 'unpin'; messageId: string }
  | { action: 'moderator-grant' | 'moderator-revoke'; subjectKey: string }
  | { action: 'write-policy'; anyoneCanWrite: boolean }

interface RoomAdminPanelProps {
  id: string
  open: boolean
  roomState: ChatRoomState
  disabled: boolean
  onClose: () => void
  onMutate: (mutation: RoomMutation) => Promise<boolean>
}

export function RoomAdminPanel({ id, open, roomState, disabled, onClose, onMutate }: RoomAdminPanelProps) {
  const [name, setName] = useState(roomState.name)
  const [description, setDescription] = useState(roomState.description)
  const [policy, setPolicy] = useState(roomState.writePolicy)
  const [addingModerator, setAddingModerator] = useState(false)
  const [moderatorKey, setModeratorKey] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const [addedModerators, setAddedModerators] = useState<string[]>([])
  const [removedModerators, setRemovedModerators] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setName(roomState.name)
    setDescription(roomState.description)
  }, [roomState.name, roomState.description])

  useEffect(() => setPolicy(roomState.writePolicy), [roomState.writePolicy])

  useEffect(() => {
    setAddedModerators((current) => current.filter((key) => !roomState.moderators.includes(key)))
    setRemovedModerators((current) => current.filter((key) => roomState.moderators.includes(key)))
  }, [roomState.moderators])

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const metadataDirty = name !== roomState.name || description !== roomState.description
  const moderators = [...new Set([...roomState.moderators, ...addedModerators])].filter(
    (key) => !removedModerators.includes(key)
  )
  const grants = addedModerators.filter((key) => !roomState.moderators.includes(key))
  const revocations = removedModerators.filter((key) => roomState.moderators.includes(key))
  const dirty = metadataDirty || policy !== roomState.writePolicy || grants.length > 0 || revocations.length > 0
  const busy = disabled || saving
  const canAddModerator = /^[A-Za-z0-9_-]{43}$/.test(moderatorKey) && !moderators.includes(moderatorKey)

  const save = async (): Promise<void> => {
    if (busy || savingRef.current || !dirty) return
    const mutations: RoomMutation[] = []
    if (metadataDirty) mutations.push({ action: 'metadata', name, description })
    if (policy !== roomState.writePolicy)
      mutations.push({ action: 'write-policy', anyoneCanWrite: policy === 'everyone' })
    for (const subjectKey of revocations) mutations.push({ action: 'moderator-revoke', subjectKey })
    for (const subjectKey of grants) mutations.push({ action: 'moderator-grant', subjectKey })
    savingRef.current = true
    setSaving(true)
    try {
      for (const mutation of mutations) {
        if (!mountedRef.current || !(await onMutate(mutation))) break
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }
  const fieldClass =
    'mt-1.5 w-full min-w-0 rounded-card bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-primary disabled:opacity-40'
  const buttonClass =
    'rounded-full border border-border-subtle px-3 py-1.5 text-xs font-medium focus-visible:outline-primary disabled:opacity-40'

  return (
    <aside
      id={id}
      aria-label="Room settings"
      hidden={!open}
      className="messenger-admin-panel m-3 ml-0 flex w-80 shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel"
    >
      <header className="border-b border-border-subtle px-4 py-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close room settings"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-center text-sm font-semibold text-heading">Room settings</h2>
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => void save()}
            className={`${buttonClass} justify-self-end bg-primary text-primary-foreground`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <section className="space-y-3 py-4">
          <h3 className="text-sm font-semibold">General</h3>
          <label className="block text-xs text-muted-foreground">
            Room name
            <input
              value={name}
              maxLength={64}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Description
            <textarea
              value={description}
              maxLength={512}
              rows={3}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
              className={`${fieldClass} resize-y`}
            />
          </label>
        </section>
        <section className="space-y-3 border-t border-border-subtle py-4">
          <fieldset disabled={busy}>
            <legend className="mb-3 text-sm font-semibold">Who can post?</legend>
            <div className="overflow-hidden rounded-card bg-surface">
              {(['everyone', 'admins'] as const).map((value, index) => (
                <label key={value} className="relative block cursor-pointer">
                  <input
                    type="radio"
                    name={`${id}-policy`}
                    value={value}
                    checked={policy === value}
                    onChange={() => setPolicy(value)}
                    className="peer sr-only"
                  />
                  <span className="flex min-h-12 items-center justify-between gap-3 px-3.5 py-3 text-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-primary peer-disabled:cursor-default peer-disabled:opacity-40">
                    {value === 'everyone' ? 'Everyone' : 'Admins only'}
                    <span
                      aria-hidden="true"
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] ${policy === value ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/45'}`}
                    >
                      {policy === value && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    </span>
                  </span>
                  {index > 0 && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-3.5 top-0 border-t border-border-subtle"
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
        <section className="space-y-3 border-t border-border-subtle py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Moderators</h3>
            {!addingModerator && (
              <button
                type="button"
                aria-label="Add moderator"
                disabled={busy}
                onClick={() => setAddingModerator(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            )}
          </div>
          {moderators.length === 0 && <p className="text-xs text-muted-foreground">No moderators yet</p>}
          <ul className="space-y-2">
            {moderators.map((key) => (
              <li key={key} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={key}>
                  {key.slice(0, 8)}…{key.slice(-6)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove moderator ${key}`}
                  onClick={() => {
                    setAddedModerators((current) => current.filter((value) => value !== key))
                    setRemovedModerators((current) => [...new Set([...current, key])])
                  }}
                  className={`${buttonClass} text-muted-foreground`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {addingModerator && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (!busy && canAddModerator) {
                  setAddedModerators((current) => [...new Set([...current, moderatorKey])])
                  setRemovedModerators((current) => current.filter((key) => key !== moderatorKey))
                  setModeratorKey('')
                  setAddingModerator(false)
                }
              }}
            >
              <label className="block text-xs text-muted-foreground">
                Identity key
                <input
                  autoFocus
                  value={moderatorKey}
                  maxLength={43}
                  disabled={busy}
                  onChange={(event) => setModeratorKey(event.target.value.trim())}
                  placeholder="Paste identity key"
                  className={`${fieldClass} font-mono`}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAddingModerator(false)} className={buttonClass}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !canAddModerator}
                  className={`${buttonClass} bg-primary text-primary-foreground`}
                >
                  Add
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
      <footer className="flex items-center justify-center gap-2 border-t border-border-subtle px-4 py-3 text-center text-xs text-success">
        <AppIcon name="messengerAdmin" className="h-5 w-5" />
        You are a room administrator
      </footer>
    </aside>
  )
}
