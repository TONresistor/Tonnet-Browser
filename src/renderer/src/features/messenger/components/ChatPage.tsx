import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import type { MessengerSettings, OwnChatIdentity } from '@shared/types'
import ChatSidebar from './chat/ChatSidebar'
import ChatRoomView from './chat/ChatRoomView'
import DmView from './chat/DmView'
import { AddRoomModal } from './chat/AddRoomModal'
import { useFollowedRooms, type FollowedRoom } from './chat/useFollowedRooms'
import { useRoomPreviews } from './chat/useRoomPreviews'
import { useDmConversations } from './chat/useDmConversations'
import { appendUniqueBounded, type ChatMsg, type ChatStatus } from './chat/util'
import { messengerClient } from '@/features/messenger/client'

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
  const [networkEnabled, setNetworkEnabled] = useState(false)
  const [enablingNetwork, setEnablingNetwork] = useState(false)

  const [activeDm, setActiveDm] = useState<string>('')
  const [dmInput, setDmInput] = useState('')
  const [dmError, setDmError] = useState<string | null>(null)

  const roomRef = useRef(room)
  roomRef.current = room
  const identityRef = useRef(identity)
  identityRef.current = identity
  const connectedKeyRef = useRef<string | null>(null)

  const refreshIdentity = useCallback(() => {
    messengerClient
      .getIdentity()
      .then(setIdentity)
      .catch(() => {})
  }, [])

  const refreshMessengerSettings = useCallback(() => {
    messengerClient
      .getSettings()
      .then((prefs) => setNetworkEnabled(Boolean((prefs as MessengerSettings)?.networkEnabled)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshIdentity()
    refreshMessengerSettings()
  }, [refreshIdentity, refreshMessengerSettings])

  useEffect(() => {
    const off = messengerClient.onSettingsChanged((change) => {
      if (change.reset) {
        refreshMessengerSettings()
        return
      }
      if (change.category !== 'messenger') return
      const next = (change.values as Partial<MessengerSettings> | undefined)?.networkEnabled
      if (typeof next === 'boolean') setNetworkEnabled(next)
    })
    return () => off()
  }, [refreshMessengerSettings])

  useEffect(() => {
    let cancelled = false
    const key = `${room} ${node} ${networkEnabled ? 'enabled' : 'disabled'}`
    connectedKeyRef.current = key
    setMessages([])
    setError(null)
    if (!room) {
      setStatus('idle')
      messengerClient.disconnect().catch(() => {})
      return () => {
        cancelled = true
      }
    }
    if (!networkEnabled) {
      setStatus('idle')
      setError('Messenger networking is disabled. Enable it to join rooms.')
      messengerClient.disconnect().catch(() => {})
      return () => {
        cancelled = true
      }
    }
    setStatus('connecting')
    messengerClient
      .connect(room, node || undefined)
      .then((res) => {
        if (!cancelled && connectedKeyRef.current === key && res.room === roomRef.current) setStatus('connected')
      })
      .catch((e: unknown) => {
        if (!cancelled && connectedKeyRef.current === key) {
          setStatus('error')
          setError(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
      if (connectedKeyRef.current === key) {
        connectedKeyRef.current = null
        messengerClient.disconnect().catch(() => {})
      }
    }
  }, [room, node, networkEnabled])

  useEffect(() => {
    const off = messengerClient.onMessage((m) => {
      const forRoom = m.room || roomRef.current
      if (forRoom !== roomRef.current) return
      updatePreview(forRoom, m.text, m.ts)
      setMessages((prev) =>
        appendUniqueBounded(prev, {
          id: m.id,
          nick: m.nick,
          text: m.text,
          ts: m.ts,
          self: m.self,
          deviceKey: m.deviceKey,
          identity: m.identity,
        })
      )
    })
    return () => off()
  }, [updatePreview])

  useEffect(() => {
    const off = messengerClient.onDirectMessage((m) => {
      receiveDm(m)
    })
    return () => off()
  }, [receiveDm])

  useEffect(() => {
    const off = messengerClient.onConnection((event) => {
      if (event.room !== roomRef.current) return
      if (event.status === 'reconnecting') {
        setStatus('reconnecting')
        setError(null)
      } else if (event.status === 'connected') {
        setStatus('connected')
        setError(null)
      } else {
        setStatus('error')
        setError('Unable to restore the room connection.')
      }
    })
    return () => off()
  }, [])

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
      const res = await messengerClient.sendDirectMessage(convo.peerKey, text)
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

  const enableMessengerNetworking = useCallback(async () => {
    if (networkEnabled || enablingNetwork) return
    setEnablingNetwork(true)
    setError(null)
    try {
      const res = await messengerClient.updateSettings({ networkEnabled: true })
      if (!res.success) throw new Error('Failed to enable Messenger networking')
      setNetworkEnabled(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnablingNetwork(false)
    }
  }, [networkEnabled, enablingNetwork])

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
      const res = await messengerClient.send(text)
      if (res.identity) setIdentity(res.identity)
      if (!res.sent) {
        setInput(text)
        if (res.pendingMembership) setError('Awaiting membership: the room owner must approve you before you can post.')
        else if (res.needsLink) setError('Link your wallet to send messages.')
        return
      }
      const me = identityRef.current
      const meNick = me?.domain || me?.addressShort || (me?.deviceKey ? `#${me.deviceKey.slice(0, 8)}` : '')
      setMessages((prev) => appendUniqueBounded(prev, { id: res.id, nick: meNick, text, ts: res.ts, self: true }))
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
          networkEnabled={networkEnabled}
          networkEnabling={enablingNetwork}
          messages={messages}
          input={input}
          onInput={setInput}
          onSend={send}
          onLeave={leaveRoom}
          onOpenDm={handleOpenDm}
          onEnableNetworking={enableMessengerNetworking}
        />
      )}

      <AddRoomModal isOpen={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
    </div>
  )
}

export default memo(ChatPage)
