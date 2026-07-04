import { useCallback, useState } from 'react'
import type { ChatIdentityInfo } from '@shared/types'

export interface DmMessage {
  id: string
  text: string
  ts: number
  self: boolean
}

export interface DmConversation {
  address: string
  name: string
  domain?: string
  peerKey: string
  messages: DmMessage[]
}

const KEY = 'groupchat.dms'
const MAX_MESSAGES = 500

function load(): Record<string, DmConversation> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, DmConversation>
    }
  } catch {
    return {}
  }
  return {}
}

function persist(convos: Record<string, DmConversation>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(convos))
  } catch {
    return
  }
}

function withMessage(c: DmConversation, msg: DmMessage): DmConversation {
  if (msg.id && c.messages.some((m) => m.id === msg.id)) return c
  const messages = [...c.messages, msg].sort((a, b) => a.ts - b.ts).slice(-MAX_MESSAGES)
  return { ...c, messages }
}

export function useDmConversations(): {
  conversations: Record<string, DmConversation>
  receive: (msg: { id: string; peerKey: string; text: string; ts: number; identity: ChatIdentityInfo }) => void
  appendSelf: (address: string, msg: DmMessage) => void
  open: (identity: ChatIdentityInfo, peerKey: string) => string
  remove: (address: string) => void
} {
  const [conversations, setConversations] = useState<Record<string, DmConversation>>(load)

  const receive = useCallback(
    (msg: { id: string; peerKey: string; text: string; ts: number; identity: ChatIdentityInfo }) => {
      const address = msg.identity.address
      if (!address) return
      setConversations((prev) => {
        const cur = prev[address] ?? { address, name: msg.identity.name, peerKey: msg.peerKey, messages: [] }
        const next = withMessage(
          { ...cur, name: msg.identity.name, domain: msg.identity.domain, peerKey: msg.peerKey },
          { id: msg.id, text: msg.text, ts: msg.ts, self: false }
        )
        if (next === cur) return prev
        const out = { ...prev, [address]: next }
        persist(out)
        return out
      })
    },
    []
  )

  const appendSelf = useCallback((address: string, msg: DmMessage) => {
    setConversations((prev) => {
      const cur = prev[address]
      if (!cur) return prev
      const next = withMessage(cur, msg)
      if (next === cur) return prev
      const out = { ...prev, [address]: next }
      persist(out)
      return out
    })
  }, [])

  const open = useCallback((identity: ChatIdentityInfo, peerKey: string): string => {
    const address = identity.address
    setConversations((prev) => {
      const cur = prev[address]
      const next: DmConversation = cur
        ? { ...cur, name: identity.name, domain: identity.domain, peerKey }
        : { address, name: identity.name, domain: identity.domain, peerKey, messages: [] }
      const out = { ...prev, [address]: next }
      persist(out)
      return out
    })
    return address
  }, [])

  const remove = useCallback((address: string) => {
    setConversations((prev) => {
      if (!prev[address]) return prev
      const out = { ...prev }
      delete out[address]
      persist(out)
      return out
    })
  }, [])

  return { conversations, receive, appendSelf, open, remove }
}
