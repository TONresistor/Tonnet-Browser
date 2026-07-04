import { memo, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Settings, SquarePen, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/stores/tabs'
import type { OwnChatIdentity } from '@shared/types'
import type { FollowedRoom } from './useFollowedRooms'
import { IdentityBadge } from './IdentityBadge'
import type { RoomPreview } from './useRoomPreviews'
import type { DmConversation } from './useDmConversations'
import { avatarColor, formatChatTime, initial, roomLabel } from './util'

interface ChatSidebarProps {
  rooms: FollowedRoom[]
  previews: Record<string, RoomPreview>
  dms: DmConversation[]
  activeRoom: string
  activeDm: string
  identity: OwnChatIdentity | null
  onLink: () => void
  onClaimDomain: (domain: string) => Promise<{ ok: boolean; reason?: string }>
  onClearDomain: () => void
  onDetectDomains: () => Promise<{ domains: string[] }>
  onSelect: (room: FollowedRoom) => void
  onRemove: (room: string) => void
  onSelectDm: (address: string) => void
  onRemoveDm: (address: string) => void
  onAdd: () => void
}

function RoomRow({
  room,
  active,
  preview,
  onSelect,
  onRemove,
}: {
  room: FollowedRoom
  active: boolean
  preview?: RoomPreview
  onSelect: (room: FollowedRoom) => void
  onRemove: (room: string) => void
}): React.JSX.Element {
  const label = roomLabel(room.room)
  const time = preview ? formatChatTime(preview.ts) : ''
  const subtitle = preview?.text ?? room.room
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
          {time && (
            <span
              className={cn(
                'shrink-0 text-[11px] tabular-nums group-hover:hidden',
                active ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}
            >
              {time}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(room.room)
            }}
            aria-label={`Unfollow ${label}`}
            className={cn(
              'hidden shrink-0 rounded-full p-1 transition-colors group-hover:block',
              active
                ? 'text-primary-foreground/80 hover:bg-white/20 hover:text-white'
                : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className={cn('truncate text-[13px]', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
          {subtitle}
        </div>
      </div>
    </div>
  )
}

function DmRow({
  dm,
  active,
  onSelect,
  onRemove,
}: {
  dm: DmConversation
  active: boolean
  onSelect: (address: string) => void
  onRemove: (address: string) => void
}): React.JSX.Element {
  const last = dm.messages[dm.messages.length - 1]
  const time = last ? formatChatTime(last.ts) : ''
  const subtitle = last ? (last.self ? `You: ${last.text}` : last.text) : 'No message yet'
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onSelect(dm.address)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(dm.address)
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
        active ? 'bg-primary' : 'hover:bg-surface-hover'
      )}
    >
      <span
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[17px] font-semibold text-white"
        style={{ backgroundColor: avatarColor(dm.address) }}
      >
        {initial(dm.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 truncate text-[15px] font-semibold',
              active ? 'text-primary-foreground' : 'text-foreground',
              dm.domain ? 'lowercase' : 'font-mono'
            )}
          >
            <span className="min-w-0 truncate">{dm.name}</span>
            <IdentityBadge identity={{ tier: dm.domain ? 'domain' : 'wallet' }} />
          </span>
          {time && (
            <span
              className={cn(
                'shrink-0 text-[11px] tabular-nums group-hover:hidden',
                active ? 'text-primary-foreground/70' : 'text-muted-foreground'
              )}
            >
              {time}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(dm.address)
            }}
            aria-label={`Delete conversation with ${dm.name}`}
            className={cn(
              'hidden shrink-0 rounded-full p-1 transition-colors group-hover:block',
              active
                ? 'text-primary-foreground/80 hover:bg-white/20 hover:text-white'
                : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        <div className={cn('truncate text-[13px]', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
          {subtitle}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function DomainMenu({
  addressShort,
  domains,
  current,
  error,
  onPick,
}: {
  addressShort: string
  domains: string[]
  current: string | null
  error: string | null
  onPick: (name: string | null) => void
}): React.JSX.Element {
  const rowCls = (selected: boolean): string =>
    cn(
      'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors',
      selected ? 'bg-primary/10' : 'hover:bg-surface-hover'
    )
  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-border-subtle bg-elevation-1 p-1 shadow-panel">
      <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Chat username
      </div>
      <button type="button" onClick={() => onPick(null)} className={rowCls(current === null)}>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">{addressShort}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">Wallet</span>
        {current === null && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </button>
      {domains.map((d) => (
        <button key={d} type="button" onClick={() => onPick(d)} className={rowCls(current === d)}>
          <span className="min-w-0 flex-1 truncate text-[13px] lowercase text-foreground">{d}</span>
          {current === d && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
        </button>
      ))}
      {error && <div className="px-2.5 py-1 text-[11px] leading-tight text-destructive">{error}</div>}
    </div>
  )
}

function ProfileRow({
  identity,
  onLink,
  onClaimDomain,
  onClearDomain,
  onDetectDomains,
}: {
  identity: OwnChatIdentity | null
  onLink: () => void
  onClaimDomain: (domain: string) => Promise<{ ok: boolean; reason?: string }>
  onClearDomain: () => void
  onDetectDomains: () => Promise<{ domains: string[] }>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detected, setDetected] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const linked = Boolean(identity?.linked && identity.addressShort)
  const domain = identity?.domain
  const seed = domain || identity?.address || identity?.addressShort || identity?.deviceKey || '?'

  useEffect(() => {
    if (!linked) {
      setDetected([])
      return
    }
    let alive = true
    onDetectDomains()
      .then((res) => {
        if (alive) setDetected(res.domains)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [linked, onDetectDomains])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const options = domain && !detected.includes(domain) ? [...detected, domain] : detected
  const hasChoices = options.length > 0

  const applyPick = (name: string | null): void => {
    setError(null)
    if (!name) {
      onClearDomain()
      setOpen(false)
      return
    }
    onClaimDomain(name)
      .then((res) => {
        if (res.ok) setOpen(false)
        else setError(res.reason ?? 'Could not verify domain')
      })
      .catch(() => setError('Could not verify domain'))
  }

  return (
    <div ref={rootRef} className="relative flex items-center gap-3 rounded-xl bg-elevation-2 px-2.5 py-2">
      {open && hasChoices && (
        <DomainMenu
          addressShort={identity!.addressShort ?? ''}
          domains={options}
          current={domain ?? null}
          error={error}
          onPick={applyPick}
        />
      )}
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white"
        style={{ backgroundColor: avatarColor(seed) }}
      >
        {initial(domain || identity?.addressShort || '?')}
      </span>
      <div className="min-w-0 flex-1">
        {linked ? (
          <button
            type="button"
            disabled={!hasChoices}
            onClick={() => {
              setError(null)
              setOpen((o) => !o)
            }}
            className="block w-full min-w-0 text-left disabled:cursor-default"
            title={hasChoices ? 'Choose your username' : undefined}
          >
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  'min-w-0 truncate text-[14px] font-medium text-foreground',
                  domain ? 'lowercase' : 'font-mono'
                )}
              >
                {domain || identity!.addressShort}
              </span>
              <IdentityBadge identity={{ tier: domain ? 'domain' : 'wallet' }} />
              {hasChoices && (
                <ChevronDown
                  className={cn(
                    'ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    open && 'rotate-180'
                  )}
                />
              )}
            </div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {domain ? identity!.addressShort : hasChoices ? 'Tap to choose your .ton' : 'Wallet'}
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
  previews,
  dms,
  activeRoom,
  activeDm,
  identity,
  onLink,
  onClaimDomain,
  onClearDomain,
  onDetectDomains,
  onSelect,
  onRemove,
  onSelectDm,
  onRemoveDm,
  onAdd,
}: ChatSidebarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q ? rooms.filter((r) => (roomLabel(r.room) + ' ' + r.room).toLowerCase().includes(q)) : rooms
  const filteredDms = q
    ? dms.filter((d) => (d.name + ' ' + d.address + ' ' + (d.domain ?? '')).toLowerCase().includes(q))
    : dms
  const empty = rooms.length === 0 && dms.length === 0
  const noMatches = filtered.length === 0 && filteredDms.length === 0

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
        {empty ? (
          <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            No chats yet. Tap the <span className="font-medium text-foreground">compose</span> icon to add one.
          </div>
        ) : noMatches ? (
          <div className="px-3 py-8 text-center text-[13px] text-muted-foreground">No matches.</div>
        ) : (
          <div role="listbox" aria-label="Chats" className="space-y-0.5 py-1">
            {filtered.length > 0 && filteredDms.length > 0 && <SectionLabel>Groups</SectionLabel>}
            {filtered.map((r) => (
              <RoomRow
                key={r.room}
                room={r}
                active={!activeDm && r.room === activeRoom}
                preview={previews[r.room]}
                onSelect={onSelect}
                onRemove={onRemove}
              />
            ))}
            {filteredDms.length > 0 && filtered.length > 0 && <SectionLabel>Direct messages</SectionLabel>}
            {filteredDms.map((d) => (
              <DmRow
                key={d.address}
                dm={d}
                active={d.address === activeDm}
                onSelect={onSelectDm}
                onRemove={onRemoveDm}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-2.5 pb-3 pt-2">
        <ProfileRow
          identity={identity}
          onLink={onLink}
          onClaimDomain={onClaimDomain}
          onClearDomain={onClearDomain}
          onDetectDomains={onDetectDomains}
        />
      </div>
    </div>
  )
}

export default memo(ChatSidebar)
