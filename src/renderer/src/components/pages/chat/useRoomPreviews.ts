import { useCallback, useState } from 'react'

export interface RoomPreview {
  text: string
  ts: number
}

const KEY = 'groupchat.previews'

function load(): Record<string, RoomPreview> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, RoomPreview>
    }
  } catch {
    return {}
  }
  return {}
}

function persist(previews: Record<string, RoomPreview>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(previews))
  } catch {
    return
  }
}

export function useRoomPreviews(): {
  previews: Record<string, RoomPreview>
  update: (room: string, text: string, ts: number) => void
} {
  const [previews, setPreviews] = useState<Record<string, RoomPreview>>(load)

  const update = useCallback((room: string, text: string, ts: number) => {
    const line = text.trim()
    if (!room || !line || !ts) return
    setPreviews((prev) => {
      const cur = prev[room]
      if (cur && cur.ts >= ts) return prev
      const next = { ...prev, [room]: { text: line.slice(0, 200), ts } }
      persist(next)
      return next
    })
  }, [])

  return { previews, update }
}
