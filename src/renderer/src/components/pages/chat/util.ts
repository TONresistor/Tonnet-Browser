import type { ChatIdentityInfo } from '@shared/types'

export type ChatStatus = 'idle' | 'connecting' | 'connected' | 'error'

export type { ChatIdentityInfo }

export interface ChatMsg {
  nick: string
  text: string
  ts: number
  self?: boolean
  deviceKey?: string
  identity?: ChatIdentityInfo
}

const AVATAR_COLORS = ['#0098EA', '#5856D6', '#34C759', '#FF9500', '#FF2D55', '#AF52DE', '#FF3B30', '#00C7BE']

export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

export function identitySeed(m: ChatMsg): string {
  return m.identity?.address ?? m.identity?.fingerprint ?? m.nick
}

export function initial(name: string): string {
  const cleaned = name.replace(/^tonnet:/i, '').trim()
  const ch = (cleaned || name).match(/[a-z0-9]/i)
  return (ch ? ch[0] : '#').toUpperCase()
}

export function roomLabel(name: string): string {
  return name.replace(/^tonnet:/i, '') || name
}

export function formatChatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  if (now.getTime() - d.getTime() < 6 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  }
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
}
