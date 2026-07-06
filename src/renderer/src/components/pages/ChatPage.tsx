import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import type { OwnChatIdentity } from '@shared/types'
import ChatSidebar from './chat/ChatSidebar'
import ChatRoomView from './chat/ChatRoomView'
import DmView from './chat/DmView'
import { AddRoomModal } from './chat/AddRoomModal'
import { useFollowedRooms, type FollowedRoom } from './chat/useFollowedRooms'
import { useRoomPreviews } from './chat/useRoomPreviews'
import { useDmConversations } from './chat/useDmConversations'
import type { ChatMsg, ChatStatus } from './chat/util'

function ChatPage(): React.JSX.Element {
  const { rooms, add, remove } = useFollowedRooms()
  const { previews, update: updatePreview } = useRoomPreviews()
  const { conversations, receive: receiveDm, appendSelf, open: openDm, remove: removeDm } = useDmConversations()

  const [room, setRoom] = useState<string>('')
  const [node, setNode] = useState<string>('')

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [identity, setIdentity] = useState<OwnChatIdentity | null>(null)

  const [activeDm, setActiveDm] = useState<string>('')
  const [dmInput, setDmInput] = useState('')
  const [dmError, setDmError] = useState<string | null>(null)

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
      const forRoom = m.room || roomRef.current
      if (forRoom !== roomRef.current) return
      updatePreview(forRoom, m.text, m.ts)
      const who = m.identity?.address ?? m.nick
      if (who && !seenRef.current.has(who)) {
        seenRef.current.add(who)
        setParticipants(seenRef.current.size)
      }
      setMessages((prev) => {
        if (m.self && prev.some((p) => p.self && p.ts === m.ts && p.text === m.text)) return prev
        return [
          ...prev,
          { nick: m.nick, text: m.text, ts: m.ts, self: m.self, deviceKey: m.deviceKey, identity: m.identity },
        ].sort((a, b) => a.ts - b.ts)
      })
    })
    return () => off()
  }, [updatePreview])

  useEffect(() => {
    const off = window.electron.on('chat:dm', (m) => {
      receiveDm(m)
    })
    return () => off()
  }, [receiveDm])

  const openRoom = useCallback((r: FollowedRoom) => {
    setRoom(r.room)
    setNode(r.node || '')
    setActiveDm('')
  }, [])

  const handleOpenDm = useCallback(
    (m: ChatMsg) => {
      if (!m.identity || !m.deviceKey || m.self) return
      const peerKey = openDm(m.identity, m.deviceKey)
      setDmError(null)
      setActiveDm(peerKey)
    },
    [openDm]
  )

  const handleSelectDm = useCallback((peerKey: string) => {
    setDmError(null)
    setActiveDm(peerKey)
  }, [])

  const handleRemoveDm = useCallback(
    (peerKey: string) => {
      removeDm(peerKey)
      setActiveDm((cur) => (cur === peerKey ? '' : cur))
    },
    [removeDm]
  )

  const sendDm = useCallback(async () => {
    const text = dmInput.trim()
    const convo = conversations[activeDm]
    if (!text || !convo) return
    setDmInput('')
    setDmError(null)
    try {
      const res = await window.electron.chat.dmSend(convo.peerKey, text)
      if (res.identity) setIdentity(res.identity)
      if (!res.sent) {
        setDmInput(text)
        if (res.pendingMembership)
          setDmError('Awaiting membership: the room owner must approve you before you can send.')
        else if (res.needsLink) setDmError('Link your wallet to send messages.')
        return
      }
      appendSelf(activeDm, { id: res.id ?? '', text, ts: res.ts ?? Date.now(), self: true })
    } catch (e) {
      setDmInput(text)
      setDmError(e instanceof Error ? e.message : String(e))
    }
  }, [dmInput, conversations, activeDm, appendSelf])

  const dmList = useMemo(() => {
    const last = (c: { messages: { ts: number }[] }): number => c.messages[c.messages.length - 1]?.ts ?? 0
    return Object.values(conversations).sort((a, b) => last(b) - last(a))
  }, [conversations])

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
        if (res.pendingMembership) setError('Awaiting membership: the room owner must approve you before you can post.')
        else if (res.needsLink) setError('Link your wallet to send messages.')
        return
      }
      const me = identityRef.current
      const meNick = me?.domain || me?.addressShort || (me?.deviceKey ? `#${me.deviceKey.slice(0, 8)}` : '')
      setMessages((prev) => [...prev, { nick: meNick, text, ts: Date.now(), self: true }])
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
        previews={previews}
        dms={dmList}
        activeRoom={room}
        activeDm={activeDm}
        onIdentityChange={setIdentity}
        onSelect={openRoom}
        onRemove={handleRemove}
        onSelectDm={handleSelectDm}
        onRemoveDm={handleRemoveDm}
        onAdd={() => setAddOpen(true)}
      />

      {activeDm && conversations[activeDm] ? (
        <DmView
          conversation={conversations[activeDm]}
          connected={status === 'connected'}
          error={dmError}
          input={dmInput}
          onInput={setDmInput}
          onSend={sendDm}
          onBack={() => setActiveDm('')}
        />
      ) : (
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
          onOpenDm={handleOpenDm}
        />
      )}

      <AddRoomModal isOpen={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
    </div>
  )
}

export default memo(ChatPage)
