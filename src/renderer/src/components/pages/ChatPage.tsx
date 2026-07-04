/**
 * Group chat page (ton://chat).
 * Join ANY room by name: the main process derives the overlay id from the name,
 * discovers the room's nodes on the DHT, connects through the local bridge, and
 * streams messages back. Type a room and press Join to switch rooms.
 * See /groupchat for the anchor + protocol.
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { GROUPCHAT_ROOM } from '@shared/groupchat'

interface Msg {
  nick: string
  text: string
  ts: number
  self?: boolean
}

type Status = 'connecting' | 'connected' | 'error'

function randomNick(): string {
  return 'anon-' + Math.random().toString(36).slice(2, 6)
}

function ChatPage(): React.JSX.Element {
  const [nick, setNick] = useState<string>(() => localStorage.getItem('groupchat.nick') || randomNick())
  const [room, setRoom] = useState<string>(() => localStorage.getItem('groupchat.room') || GROUPCHAT_ROOM)
  const [roomInput, setRoomInput] = useState<string>(room)
  // Optional bootstrap node id (base64 ADNL): connect straight to a known node,
  // bypassing DHT discovery (which can be slow for a freshly-created room).
  const [node, setNode] = useState<string>(() => localStorage.getItem('groupchat.node') || '')
  const [nodeInput, setNodeInput] = useState<string>(node)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>('connecting')
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Current room seen by the (mount-once) message listener, so late events from
  // a room we just left are dropped instead of leaking into the new room.
  const roomRef = useRef(room)
  roomRef.current = room

  useEffect(() => {
    localStorage.setItem('groupchat.nick', nick)
  }, [nick])

  // Join the room whenever the room or bootstrap node changes (mount + switches).
  useEffect(() => {
    let cancelled = false
    localStorage.setItem('groupchat.room', room)
    localStorage.setItem('groupchat.node', node)
    setStatus('connecting')
    setError(null)
    setMessages([])
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
    if (!nextRoom || (nextRoom === room && nextNode === node)) return
    setRoom(nextRoom) // triggers the join effect
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
          <span className="max-w-[16rem] truncate text-lg font-semibold" title={room}>
            {room}
          </span>
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
            placeholder="room name (e.g. tonnet:mesh:v1)"
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
        {messages.length === 0 && (
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
          placeholder={status === 'connected' ? 'Message…' : 'Connecting…'}
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
