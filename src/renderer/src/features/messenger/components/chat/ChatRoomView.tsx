import { memo, useEffect, useRef, useState } from 'react'
import { LoaderCircle, LogOut, Search, Users, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/ios/EmptyState'
import { ChatsIcon } from './ChatsIcon'
import { SendIcon } from './SendIcon'
import { IdentityBadge, displayName } from './IdentityBadge'
import { avatarColor, identitySeed, initial, roomLabel, type ChatMsg, type ChatStatus } from './util'

interface ChatRoomViewProps {
  room: string
  status: ChatStatus
  error: string | null
  networkEnabled: boolean
  networkEnabling: boolean
  participants: number
  messages: ChatMsg[]
  input: string
  onInput: (v: string) => void
  onSend: () => void
  onLeave: () => void
  onOpenDm: (msg: ChatMsg) => void
  onEnableNetworking: () => void
}

function subtitle(status: ChatStatus, participants: number): string {
  if (status === 'connected') return `${participants} participant${participants === 1 ? '' : 's'}`
  if (status === 'connecting') return 'connecting…'
  if (status === 'error') return 'connection error'
  return ''
}

function ChatRoomView({
  room,
  status,
  error,
  networkEnabled,
  networkEnabling,
  participants,
  messages,
  input,
  onInput,
  onSend,
  onLeave,
  onOpenDm,
  onEnableNetworking,
}: ChatRoomViewProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [room])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  if (!room) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <EmptyState icon={<ChatsIcon className="h-8 w-8" />} title="No room open" />
      </div>
    )
  }

  const connected = status === 'connected'
  const q = searchQuery.trim().toLowerCase()
  const visible = q
    ? messages.filter((m) => m.text.toLowerCase().includes(q) || m.nick.toLowerCase().includes(q))
    : messages

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="m-3 mb-0 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full border border-border-subtle bg-elevation-1 px-3 py-1.5 shadow-panel">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-identity-foreground"
            style={{ backgroundColor: avatarColor(room) }}
          >
            {initial(room)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-tight text-heading" title={room}>
              {roomLabel(room)}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] leading-tight text-muted-foreground">
              {connected && <Users className="h-3.5 w-3.5" />}
              <span className="truncate">{subtitle(status, participants)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border-subtle bg-elevation-1 p-1 shadow-panel">
          <button
            type="button"
            onClick={() => setSearchOpen((o) => !o)}
            aria-label="Search messages"
            title="Search in this chat"
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              searchOpen
                ? 'bg-surface-active text-foreground'
                : 'text-muted-foreground hover:bg-surface hover:text-foreground'
            )}
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onLeave}
            aria-label="Leave room"
            title="Leave room"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-full border border-border-subtle bg-elevation-1 px-3 py-1.5 shadow-panel">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false)
              setSearchQuery('')
            }}
            aria-label="Close search"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!networkEnabled && (
        <div className="mx-3 mt-2 flex items-center gap-3 rounded-card border border-primary/25 bg-primary/10 px-4 py-2.5 text-sm text-foreground">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Messenger is experimental and off</div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Enable Messenger to turn on ADNL, Overlay and DHT automatically.
            </div>
          </div>
          <button
            type="button"
            onClick={onEnableNetworking}
            disabled={networkEnabling}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-semibold text-identity-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {networkEnabling && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Enable
          </button>
        </div>
      )}

      {networkEnabled && error && (
        <div className="mx-3 mt-2 rounded-card border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error} (check the proxy connection and bridge namespaces)
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {visible.length === 0 && (
          <div className="mt-10 text-center text-sm text-muted-foreground">
            {q ? 'No matching messages.' : connected ? 'No message yet.' : 'Connecting to the room…'}
          </div>
        )}
        {visible.map((m) => (
          <div
            key={m.id ?? `${m.ts}:${m.deviceKey ?? 'me'}`}
            className={cn('flex flex-col', m.self ? 'items-end' : 'items-start')}
          >
            <div
              className={cn(
                'max-w-[75%] rounded-2xl px-3 py-2 text-sm',
                m.self
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border-subtle bg-elevation-2 text-foreground'
              )}
            >
              {!m.self && (
                <div className="mb-0.5 flex items-center gap-1 text-xs font-medium" title={m.identity?.address}>
                  <button
                    type="button"
                    onClick={() => onOpenDm(m)}
                    disabled={!m.deviceKey || !m.identity}
                    title={m.deviceKey && m.identity ? 'Send a direct message' : undefined}
                    className="min-w-0 truncate text-left enabled:cursor-pointer enabled:hover:underline"
                    style={{ color: avatarColor(identitySeed(m)) }}
                  >
                    {displayName(m.identity, m.nick)}
                  </button>
                  {m.identity && <IdentityBadge identity={m.identity} />}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{new Date(m.ts).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>

      <div className="m-3 mt-0 flex items-center gap-2 rounded-full border border-border-subtle bg-elevation-1 px-3 py-1.5 shadow-panel">
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          disabled={!connected}
          className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
          placeholder={!networkEnabled ? 'Enable Messenger' : connected ? 'Message…' : 'Connecting…'}
          aria-label="message"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!connected || !input.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-identity-foreground transition-opacity hover:bg-primary/90 disabled:opacity-40"
        >
          <SendIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  )
}

export default memo(ChatRoomView)
