/**
 * Cocoon chat conversations. In-memory only — confidential AI chats should
 * not persist to disk by default. Shared between the page and the sidebar so
 * the active conversation follows the user across surfaces within a session.
 */

import { create } from 'zustand'
import { newId } from '@/lib/id'

export type CocoonChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

export type CocoonConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: CocoonChatMessage[]
}

export interface CocoonSettings {
  /** When false, prepend `/no_think` system prompt to suppress reasoning. */
  thinkingEnabled: boolean
}

interface CocoonChatState {
  conversations: CocoonConversation[]
  activeId: string | null
  settings: CocoonSettings
  newConversation: () => string
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  addMessage: (message: CocoonChatMessage) => void
  updateMessage: (id: string, patch: Partial<Omit<CocoonChatMessage, 'id'>>) => void
  clearActive: () => void
  setThinking: (enabled: boolean) => void
}

const TITLE_MAX = 60

function deriveTitle(message: CocoonChatMessage): string {
  const text = message.content.trim().replace(/\s+/g, ' ')
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text || 'New chat'
}

function makeConversation(): CocoonConversation {
  const now = Date.now()
  return { id: newId(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
}

export const useCocoonChatStore = create<CocoonChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  settings: { thinkingEnabled: true },

  setThinking: (enabled) => set((s) => ({ settings: { ...s.settings, thinkingEnabled: enabled } })),

  newConversation: () => {
    const conv = makeConversation()
    set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }))
    return conv.id
  },

  selectConversation: (id) => set({ activeId: id }),

  deleteConversation: (id) =>
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id)
      const activeId = s.activeId === id ? (conversations[0]?.id ?? null) : s.activeId
      return { conversations, activeId }
    }),

  addMessage: (message) =>
    set((s) => {
      // Auto-create a conversation on first message if none is active.
      let activeId = s.activeId
      let conversations = s.conversations
      if (!activeId || !conversations.some((c) => c.id === activeId)) {
        const conv = makeConversation()
        conversations = [conv, ...conversations]
        activeId = conv.id
      }
      const now = Date.now()
      conversations = conversations.map((c) => {
        if (c.id !== activeId) return c
        const messages = [...c.messages, message]
        const isFirstUserMessage = message.role === 'user' && c.messages.every((m) => m.role !== 'user')
        return {
          ...c,
          updatedAt: now,
          messages,
          title: isFirstUserMessage ? deriveTitle(message) : c.title,
        }
      })
      return { conversations, activeId }
    }),

  updateMessage: (id, patch) =>
    set((s) => {
      // Update whichever conversation owns the message, not the active one —
      // a streamed reply must land in its own conversation even if the user
      // switched chats mid-request.
      const conversations = s.conversations.map((c) => {
        if (!c.messages.some((m) => m.id === id)) return c
        return {
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }
      })
      return { conversations }
    }),

  clearActive: () => {
    const id = get().activeId
    if (!id) return
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, messages: [], updatedAt: Date.now() } : c)),
    }))
  },
}))

// Stable reference for the empty case — returning a fresh `[]` literal would
// fail Zustand's referential-equality check and trigger an infinite render loop.
const EMPTY_MESSAGES: readonly CocoonChatMessage[] = Object.freeze([])

/** Selector: messages of the active conversation (empty array if none). */
export const selectActiveMessages = (s: CocoonChatState): readonly CocoonChatMessage[] => {
  const conv = s.conversations.find((c) => c.id === s.activeId)
  return conv?.messages ?? EMPTY_MESSAGES
}
