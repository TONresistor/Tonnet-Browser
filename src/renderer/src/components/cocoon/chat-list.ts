/**
 * Pure helpers for the Cocoon conversation list rows (kept out of the component
 * so they can be unit-tested without rendering).
 */

import type { CocoonConversation } from '@/stores/cocoon-chat'

/** Short relative timestamp for a chat row (now / 5m / 2h / 3d / locale date). */
export function relativeTime(ts: number, now: number): string {
  const minutes = Math.floor((now - ts) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ts).toLocaleDateString()
}

/** One-line preview of a conversation's last message (think-blocks stripped). */
export function conversationPreview(c: Pick<CocoonConversation, 'messages'>): string {
  const last = c.messages[c.messages.length - 1]
  if (!last) return 'No messages yet'
  const text = last.content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '') // unterminated (truncated) reasoning block
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'No messages yet'
  return last.role === 'user' ? `You: ${text}` : text
}
