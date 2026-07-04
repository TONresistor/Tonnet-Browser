import { memo, useState } from 'react'
import { Search, Settings, SquarePen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/stores/tabs'
import type { OwnChatIdentity } from '@shared/types'
import type { FollowedRoom } from './useFollowedRooms'
import { IdentityBadge } from './IdentityBadge'
import { avatarColor, initial, roomLabel, type ChatStatus } from './util'

interface ChatSidebarProps {
  rooms: FollowedRoom[]
  activeRoom: string
  status: ChatStatus
  identity: OwnChatIdentity | null
  onLink: () => void
  onClaimDomain: (domain: string) => Promise<{ ok: boolean; reason?: string }>
  onClearDomain: () => void
  onSelect: (room: FollowedRoom) => void
  onRemove: (room: string) => void
  onAdd: () => void
}

function StatusDot({ status }: { status: ChatStatus }): React.JSX.Element {
  const color =
    status === 'connected' ? 'bg-success' : status === 'error' ? 'bg-destructive' : 'bg-[#FF9500] animate-pulse'
  return <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', color)} aria-hidden />
}

function rowSubtitle(room: FollowedRoom, active: boolean, status: ChatStatus): string {
  if (active) {
    if (status === 'connected') return 'connected'
    if (status === 'connecting') return 'connecting…'
    if (status === 'error') return 'connection error'
  }
  return room.room
}

function RoomRow({
  room,
  active,
  status,
  onSelect,
  onRemove,
}: {
  room: FollowedRoom
  active: boolean
  status: ChatStatus
  onSelect: (room: FollowedRoom) => void
  onRemove: (room: string) => void
}): React.JSX.Element {
  const label = roomLabel(room.room)
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onSelect(room)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(room)
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
        active ? 'bg-primary' : 'hover:bg-surface-hover'
      )}
    >
      <span
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[17px] font-semibold text-white"
        style={{ backgroundColor: avatarColor(room.room) }}
      >
        {initial(room.room)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[15px] font-semibold',
              active ? 'text-primary-foreground' : 'text-foreground'
            )}
          >
            {label}
          </span>
          {active && <StatusDot status={status} />}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(room.room)
            }}
            aria-label={`Unfollow ${label}`}
            className={cn(
              'shrink-0 rounded-full p-1 opacity-0 transition-colors pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100',
              active
                ? 'text-primary-foreground/80 hover:bg-white/20 hover:text-white'
                : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className={cn('truncate text-[13px]', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
          {rowSubtitle(room, active, status)}
        </div>
      </div>
    </div>
  )
}

function DomainEditor({
  current,
  onClaim,
  onClear,
  onDone,
}: {
  current?: string
  onClaim: (domain: string) => Promise<{ ok: boolean; reason?: string }>
  onClear: () => void
  onDone: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(current ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (): Promise<void> => {
    const domain = value.trim().toLowerCase()
    if (!domain) {
      onClear()
      onDone()
      return
    }
    setPending(true)
    setError(null)
    const res = await onClaim(domain)
    setPending(false)
    if (res.ok) onDone()
    else setError(res.reason ?? 'Could not verify domain')
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 126))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onDone()
        }}
        onBlur={() => void submit()}
        disabled={pending}
        autoFocus
        aria-label="Your .ton domain"
        placeholder="yourname.ton"
        className="w-full min-w-0 bg-transparent font-mono text-[14px] font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
      />
      <div className={cn('truncate text-[11px] leading-tight', error ? 'text-destructive' : 'text-muted-foreground')}>
        {pending ? 'Checking…' : error ? error : 'Enter a .ton you own, or leave empty to remove'}
      </div>
    </div>
  )
}

function ProfileRow({
  identity,
  onLink,
  onClaimDomain,
  onClearDomain,
}: {
  identity: OwnChatIdentity | null
  onLink: () => void
  onClaimDomain: (domain: string) => Promise<{ ok: boolean; reason?: string }>
  onClearDomain: () => void
}): React.JSX.Element {
  const [editingDomain, setEditingDomain] = useState(false)
  const linked = Boolean(identity?.linked && identity.addressShort)
  const domain = identity?.domain
  const seed = domain || identity?.address || identity?.addressShort || identity?.deviceKey || '?'

  return (
    <div className="flex items-center gap-3 rounded-xl bg-elevation-2 px-2.5 py-2">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white"
        style={{ backgroundColor: avatarColor(seed) }}
      >
        {initial(domain || identity?.addressShort || '?')}
      </span>
      <div className="min-w-0 flex-1">
        {editingDomain && linked ? (
          <DomainEditor
            current={domain}
            onClaim={onClaimDomain}
            onClear={onClearDomain}
            onDone={() => setEditingDomain(false)}
          />
        ) : linked ? (
          <button
            type="button"
            onClick={() => setEditingDomain(true)}
            className="block w-full min-w-0 text-left"
            title="Set your .ton username"
          >
            <div className="flex items-center gap-1">
              <span
                className={cn('truncate text-[14px] font-medium text-foreground', domain ? 'lowercase' : 'font-mono')}
              >
                {domain || identity!.addressShort}
              </span>
              <IdentityBadge identity={{ tier: domain ? 'domain' : 'wallet' }} />
            </div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {domain ? identity!.addressShort : 'Verified - add a .ton username'}
            </div>
          </button>
        ) : identity?.walletReady ? (
          <>
            <div className="truncate text-[15px] font-medium text-foreground">Not linked</div>
            <button
              type="button"
              onClick={onLink}
              className="truncate text-[11px] font-medium leading-tight text-primary transition-opacity hover:opacity-80"
            >
              Link your wallet to chat
            </button>
          </>
        ) : (
          <>
            <div className="truncate text-[15px] font-medium text-foreground">No wallet</div>
            <button
              type="button"
              onClick={() => useTabsStore.getState().navigateActiveTab('ton://wallet')}
              className="truncate text-[11px] font-medium leading-tight text-primary transition-opacity hover:opacity-80"
            >
              Create a wallet to chat
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => useTabsStore.getState().navigateActiveTab('ton://settings')}
        aria-label="Settings"
        title="Settings"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Settings className="h-[18px] w-[18px]" />
      </button>
    </div>
  )
}

function ChatSidebar({
  rooms,
  activeRoom,
  status,
  identity,
  onLink,
  onClaimDomain,
  onClearDomain,
  onSelect,
  onRemove,
  onAdd,
}: ChatSidebarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q ? rooms.filter((r) => (roomLabel(r.room) + ' ' + r.room).toLowerCase().includes(q)) : rooms

  return (
    <div className="m-3 flex w-[280px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel">
      <div className="relative flex items-center justify-center px-4 pb-2 pt-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Messenger</h2>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add chat"
          title="Add chat"
          className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <SquarePen className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-2 rounded-full bg-elevation-2 px-3.5 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5">
        {rooms.length === 0 ? (
          <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            No chats yet. Tap the <span className="font-medium text-foreground">compose</span> icon to add one.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">No matches.</div>
        ) : (
          <div role="listbox" aria-label="Chats" className="space-y-0.5 py-1">
            {filtered.map((r) => (
              <RoomRow
                key={r.room}
                room={r}
                active={r.room === activeRoom}
                status={status}
                onSelect={onSelect}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-2.5 pb-3 pt-2">
        <ProfileRow identity={identity} onLink={onLink} onClaimDomain={onClaimDomain} onClearDomain={onClearDomain} />
      </div>
    </div>
  )
}

export default memo(ChatSidebar)
