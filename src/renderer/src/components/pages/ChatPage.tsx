/**
 * Group chat page (ton://chat).
 *
 * A neutral entry point: NO default room and no built-in community. The user
 * names the room to join; the main process derives the overlay id, discovers the
 * room's nodes (or uses an explicit bootstrap node id), connects through the
 * local bridge, and streams messages back. The last room *you* joined is
 * remembered for convenience — nothing is joined on your behalf on first run.
 * See /groupchat for the protocol.
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react'

interface Msg {
  nick: string
  text: string
  ts: number
  self?: boolean
}

type Status = 'idle' | 'connecting' | 'connected' | 'error'

function randomNick(): string {
  return 'anon-' + Math.random().toString(36).slice(2, 6)
}

function ChatPage(): React.JSX.Element {
  const [nick, setNick] = useState<string>(() => localStorage.getItem('groupchat.nick') || randomNick())
  // No default room and NO auto-connect: `room`/`node` are the *joined* target and
  // start empty on every open, so the page always lands on the "Join a room" state
  // and nothing is connected on the user's behalf. The inputs are pre-filled with
  // the last room/node the user joined (convenience only) — they must click Join.
  const [room, setRoom] = useState<string>('')
  const [roomInput, setRoomInput] = useState<string>(() => localStorage.getItem('groupchat.room') || '')
  const [node, setNode] = useState<string>('')
  const [nodeInput, setNodeInput] = useState<string>(() => localStorage.getItem('groupchat.node') || '')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Current room seen by the (mount-once) message listener, so late events from
  // a room we just left are dropped instead of leaking into the new room.
  const roomRef = useRef(room)
  roomRef.current = room

  useEffect(() => {
    localStorage.setItem('groupchat.nick', nick)
  }, [nick])

  // Connect only to an explicitly-joined room (set by joinRoom); never on mount.
  useEffect(() => {
    setMessages([])
    setError(null)
    if (!room) {
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('connecting')
    window.electron.chat
      .connect(room, node || undefined)
      .then((res) => {
        if (!cancelled && res.room === roomRef.current) setStatus('connected')
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setStatus('error')
          setError(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [room, node])

  // Incoming messages (listener mounted once; filters by the live room).
  useEffect(() => {
    const off = window.electron.on('chat:message', (m) => {
      if (m.room && m.room !== roomRef.current) return
      setMessages((prev) => [...prev, { nick: m.nick, text: m.text, ts: m.ts, self: false }])
    })
    return () => off()
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  const joinRoom = useCallback(() => {
    const nextRoom = roomInput.trim()
    const nextNode = nodeInput.trim()
    if (!nextRoom) return
    // Remember the choice so the inputs pre-fill next time (not auto-joined).
    localStorage.setItem('groupchat.room', nextRoom)
    localStorage.setItem('groupchat.node', nextNode)
    if (nextRoom === room && nextNode === node) return
    setRoom(nextRoom) // triggers the connect effect
    setNode(nextNode)
  }, [roomInput, nodeInput, room, node])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || status !== 'connected') return
    setInput('')
    setMessages((prev) => [...prev, { nick, text, ts: Date.now(), self: true }])
    try {
      await window.electron.chat.send(nick, text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [input, nick, status])

  return (
    <div className="flex h-full w-full flex-col bg-background-secondary text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`max-w-[16rem] truncate text-lg font-semibold ${room ? '' : 'text-foreground-secondary'}`}
            title={room}
          >
            {room || 'no room'}
          </span>
          {room && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                status === 'connected'
                  ? 'bg-green-500/15 text-green-500'
                  : status === 'error'
                    ? 'bg-red-500/15 text-red-500'
                    : 'bg-yellow-500/15 text-yellow-600'
              }`}
            >
              {status === 'connected' ? 'connected' : status === 'error' ? 'error' : 'connecting…'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value.slice(0, 128))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                joinRoom()
              }
            }}
            className="w-52 rounded-md border border-border bg-background px-2 py-1 text-sm"
            placeholder="room name (e.g. tonnet:groupchat)"
            aria-label="room name"
          />
          <input
            value={nodeInput}
            onChange={(e) => setNodeInput(e.target.value.trim().slice(0, 64))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                joinRoom()
              }
            }}
            className="w-48 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
            placeholder="node id (optional)"
            aria-label="bootstrap node id"
            title="Optional: base64 ADNL id of a known node to connect directly, bypassing discovery"
          />
          <button
            onClick={joinRoom}
            disabled={!roomInput.trim() || (roomInput.trim() === room && nodeInput.trim() === node)}
            className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            Join
          </button>
          <input
            value={nick}
            onChange={(e) => setNick(e.target.value.slice(0, 32))}
            className="w-28 rounded-md border border-border bg-background px-2 py-1 text-sm"
            placeholder="nickname"
            aria-label="nickname"
          />
        </div>
      </header>

      {error && (
        <div className="border-b border-border bg-red-500/10 px-4 py-2 text-sm text-red-500">
          {error}
          {status === 'error' && ' — is the proxy connected? (adnl/overlay/dht namespaces required)'}
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {status === 'idle' && (
          <div className="mx-auto mt-12 max-w-sm text-center text-sm text-foreground-secondary">
            <div className="mb-1 text-base font-medium text-foreground">Join a room</div>
            Type a room name above and press <span className="font-medium">Join</span>. There is no default room — you
            decide which conversation to enter.
          </div>
        )}
        {status !== 'idle' && messages.length === 0 && (
          <div className="mt-8 text-center text-sm text-foreground-secondary">
            No messages yet. Say hi 👋 (you only see messages sent after you joined.)
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.self ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                m.self ? 'bg-accent text-white' : 'bg-background border border-border'
              }`}
            >
              {!m.self && <div className="mb-0.5 text-xs font-medium text-foreground-secondary">{m.nick}</div>}
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
            </div>
            <div className="mt-0.5 text-[10px] text-foreground-secondary">{new Date(m.ts).toLocaleTimeString()}</div>
          </div>
        ))}
      </div>

      <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          disabled={status !== 'connected'}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
          placeholder={status === 'connected' ? 'Message…' : status === 'idle' ? 'Join a room to chat…' : 'Connecting…'}
          aria-label="message"
        />
        <button
          onClick={() => void send()}
          disabled={status !== 'connected' || !input.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </footer>
    </div>
  )
}

export default memo(ChatPage)
