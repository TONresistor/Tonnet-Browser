import { useState, useEffect, useRef, useCallback, memo } from 'react'
import type { OwnChatIdentity } from '@shared/types'
import ChatSidebar from './chat/ChatSidebar'
import ChatRoomView from './chat/ChatRoomView'
import { AddRoomModal } from './chat/AddRoomModal'
import { useFollowedRooms, type FollowedRoom } from './chat/useFollowedRooms'
import type { ChatMsg, ChatStatus } from './chat/util'

function ChatPage(): React.JSX.Element {
  const { rooms, add, remove } = useFollowedRooms()

  const [room, setRoom] = useState<string>('')
  const [node, setNode] = useState<string>('')

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [identity, setIdentity] = useState<OwnChatIdentity | null>(null)

  const seenRef = useRef<Set<string>>(new Set())
  const [participants, setParticipants] = useState(0)

  const roomRef = useRef(room)
  roomRef.current = room
  const identityRef = useRef(identity)
  identityRef.current = identity
  const connectedKeyRef = useRef<string | null>(null)

  const refreshIdentity = useCallback(() => {
    window.electron.chat
      .identity()
      .then(setIdentity)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshIdentity()
  }, [refreshIdentity])

  useEffect(() => {
    if (status !== 'connected' || !identity?.address) return
    if (!seenRef.current.has(identity.address)) {
      seenRef.current.add(identity.address)
      setParticipants(seenRef.current.size)
    }
  }, [status, identity])

  useEffect(() => {
    const key = `${room} ${node}`
    if (connectedKeyRef.current === key) return
    connectedKeyRef.current = key
    setMessages([])
    setError(null)
    seenRef.current = new Set()
    setParticipants(0)
    if (!room) {
      setStatus('idle')
      window.electron.chat.disconnect().catch(() => {})
      return
    }
    setStatus('connecting')
    window.electron.chat
      .connect(room, node || undefined)
      .then((res) => {
        if (connectedKeyRef.current === key && res.room === roomRef.current) setStatus('connected')
      })
      .catch((e: unknown) => {
        if (connectedKeyRef.current === key) {
          setStatus('error')
          setError(e instanceof Error ? e.message : String(e))
        }
      })
  }, [room, node])

  useEffect(() => {
    const off = window.electron.on('chat:message', (m) => {
      if (m.room && m.room !== roomRef.current) return
      const who = m.identity?.address ?? m.nick
      if (who && !seenRef.current.has(who)) {
        seenRef.current.add(who)
        setParticipants(seenRef.current.size)
      }
      setMessages((prev) => {
        if (m.self && prev.some((p) => p.self && p.ts === m.ts && p.text === m.text)) return prev
        return [...prev, { nick: m.nick, text: m.text, ts: m.ts, self: m.self, identity: m.identity }].sort(
          (a, b) => a.ts - b.ts
        )
      })
    })
    return () => off()
  }, [])

  const openRoom = useCallback((r: FollowedRoom) => {
    setRoom(r.room)
    setNode(r.node || '')
  }, [])

  const leaveRoom = useCallback(() => {
    setRoom('')
    setNode('')
  }, [])

  const handleAdd = useCallback(
    (r: string, n?: string) => {
      add(r, n)
      openRoom({ room: r, node: n })
    },
    [add, openRoom]
  )

  const handleRemove = useCallback(
    (r: string) => {
      remove(r)
      if (r === roomRef.current) leaveRoom()
    },
    [remove, leaveRoom]
  )

  const handleLink = useCallback(() => {
    window.electron.chat
      .linkIdentity()
      .then(setIdentity)
      .catch(() => {})
  }, [])

  const handleClaimDomain = useCallback(async (domain: string): Promise<{ ok: boolean; reason?: string }> => {
    try {
      const res = await window.electron.chat.claimDomain(domain)
      setIdentity(res.identity)
      return { ok: res.ok, reason: res.reason }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }, [])

  const handleClearDomain = useCallback(() => {
    window.electron.chat
      .clearDomain()
      .then(setIdentity)
      .catch(() => {})
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || status !== 'connected') return
    setInput('')
    setError(null)
    try {
      const res = await window.electron.chat.send(text)
      if (res.identity) setIdentity(res.identity)
      if (!res.sent) {
        setInput(text)
        if (res.needsLink) setError('Link your wallet to send messages.')
        return
      }
      const me = identityRef.current
      setMessages((prev) => [...prev, { nick: me?.domain || me?.addressShort || '', text, ts: Date.now(), self: true }])
    } catch (e) {
      setInput(text)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [input, status])

  return (
    <div
      className="flex h-full w-full bg-background-secondary text-foreground"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      <ChatSidebar
        rooms={rooms}
        activeRoom={room}
        status={status}
        identity={identity}
        onLink={handleLink}
        onClaimDomain={handleClaimDomain}
        onClearDomain={handleClearDomain}
        onSelect={openRoom}
        onRemove={handleRemove}
        onAdd={() => setAddOpen(true)}
      />

      <ChatRoomView
        room={room}
        status={status}
        error={error}
        participants={participants}
        messages={messages}
        input={input}
        onInput={setInput}
        onSend={send}
        onLeave={leaveRoom}
      />

      <AddRoomModal isOpen={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
    </div>
  )
}

export default memo(ChatPage)
