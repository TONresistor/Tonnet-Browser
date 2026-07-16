import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { ActionButton } from '@/components/ui/ios/ActionButton'

interface AddRoomModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (room: string, node?: string) => void
}

export function AddRoomModal({ isOpen, onClose, onAdd }: AddRoomModalProps): React.JSX.Element | null {
  const [room, setRoom] = useState('')
  const [node, setNode] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, isOpen)

  const reset = (): void => {
    setRoom('')
    setNode('')
  }
  const close = (): void => {
    reset()
    onClose()
  }
  const submit = (): void => {
    const name = room.trim()
    if (!name) return
    onAdd(name, node.trim() || undefined)
    reset()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60"
      onClick={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-room-title"
    >
      <div
        ref={ref}
        className="relative w-full max-w-md overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Cancel"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 id="add-room-title" className="pr-8 text-[17px] font-semibold text-heading">
          Add a room
        </h3>
        <p className="mb-4 mt-1 text-[13px] text-muted-foreground">
          Follow a group chat by name. It stays pinned in your sidebar; nothing is joined until you open it.
        </p>

        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Room name
        </label>
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value.slice(0, 128))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && room.trim()) submit()
          }}
          placeholder="e.g. tonnet:groupchat"
          className="mb-4 w-full rounded-card bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
          autoFocus
        />

        <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Node id <span className="normal-case text-muted-foreground/70">(optional)</span>
        </label>
        <input
          value={node}
          onChange={(e) => setNode(e.target.value.trim().slice(0, 64))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && room.trim()) submit()
          }}
          placeholder="base64 ADNL id of a known node"
          className="mb-1 w-full rounded-card bg-surface px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="mb-5 text-[12px] text-muted-foreground">
          Only needed for a brand-new room not yet discoverable on the network.
        </p>

        <div className="flex gap-3">
          <ActionButton variant="gray" onClick={close} className="flex-1">
            Cancel
          </ActionButton>
          <ActionButton
            variant="filled"
            onClick={submit}
            disabled={!room.trim()}
            className="flex-1"
            icon={<Plus className="h-4 w-4" />}
          >
            Add room
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
