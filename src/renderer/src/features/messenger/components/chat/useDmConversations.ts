import { useCallback, useState } from 'react'
import type { ChatIdentityInfo } from '@shared/types'

export interface DmMessage {
  id: string
  text: string
  ts: number
  self: boolean
}

export interface DmConversation {
  peerKey: string
  name: string
  address?: string
  domain?: string
  messages: DmMessage[]
}

const KEY = 'groupchat.dms.v2'
const MAX_MESSAGES = 500

function load(): Record<string, DmConversation> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return migrateLegacy()
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, DmConversation>
    }
  } catch {
    return {}
  }
  return {}
}

function migrateLegacy(): Record<string, DmConversation> {
  try {
    const raw = localStorage.getItem('groupchat.dms')
    if (!raw) return {}
    const old = JSON.parse(raw) as Record<string, DmConversation>
    const out: Record<string, DmConversation> = {}
    for (const c of Object.values(old)) {
      if (c && c.peerKey) out[c.peerKey] = { ...c, peerKey: c.peerKey }
    }
    localStorage.setItem(KEY, JSON.stringify(out))
    return out
  } catch {
    return {}
  }
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
  const messages = [...c.messages, msg].slice(-MAX_MESSAGES)
  return { ...c, messages }
}

export function useDmConversations(): {
  conversations: Record<string, DmConversation>
  receive: (msg: { id: string; peerKey: string; text: string; ts: number; identity: ChatIdentityInfo }) => void
  appendSelf: (peerKey: string, msg: DmMessage) => void
  open: (identity: ChatIdentityInfo, peerKey: string) => string
  remove: (peerKey: string) => void
} {
  const [conversations, setConversations] = useState<Record<string, DmConversation>>(load)

  const receive = useCallback(
    (msg: { id: string; peerKey: string; text: string; ts: number; identity: ChatIdentityInfo }) => {
      const peerKey = msg.peerKey
      if (!peerKey) return
      setConversations((prev) => {
        const cur = prev[peerKey] ?? { peerKey, name: msg.identity.name, messages: [] }
        const next = withMessage(
          { ...cur, name: msg.identity.name, address: msg.identity.address, domain: msg.identity.domain, peerKey },
          { id: msg.id, text: msg.text, ts: msg.ts, self: false }
        )
        if (next === cur) return prev
        const out = { ...prev, [peerKey]: next }
        persist(out)
        return out
      })
    },
    []
  )

  const appendSelf = useCallback((peerKey: string, msg: DmMessage) => {
    setConversations((prev) => {
      const cur = prev[peerKey]
      if (!cur) return prev
      const next = withMessage(cur, msg)
      if (next === cur) return prev
      const out = { ...prev, [peerKey]: next }
      persist(out)
      return out
    })
  }, [])

  const open = useCallback((identity: ChatIdentityInfo, peerKey: string): string => {
    setConversations((prev) => {
      const cur = prev[peerKey]
      const next: DmConversation = cur
        ? { ...cur, name: identity.name, address: identity.address, domain: identity.domain, peerKey }
        : { peerKey, name: identity.name, address: identity.address, domain: identity.domain, messages: [] }
      const out = { ...prev, [peerKey]: next }
      persist(out)
      return out
    })
    return peerKey
  }, [])

  const remove = useCallback((peerKey: string) => {
    setConversations((prev) => {
      if (!prev[peerKey]) return prev
      const out = { ...prev }
      delete out[peerKey]
      persist(out)
      return out
    })
  }, [])

  return { conversations, receive, appendSelf, open, remove }
}
