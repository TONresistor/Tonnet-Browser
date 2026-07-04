import { useCallback, useState } from 'react'

export interface FollowedRoom {
  room: string
  node?: string
}

const KEY = 'groupchat.rooms'
const LEGACY_ROOM = 'groupchat.room'
const LEGACY_NODE = 'groupchat.node'

function readStored(): FollowedRoom[] | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((r): r is FollowedRoom => !!r && typeof r.room === 'string' && r.room.length > 0)
    }
  } catch {
    return null
  }
  return null
}

function load(): FollowedRoom[] {
  const stored = readStored()
  if (stored) return stored
  const legacyRoom = localStorage.getItem(LEGACY_ROOM)?.trim()
  if (legacyRoom) {
    const legacyNode = localStorage.getItem(LEGACY_NODE)?.trim() || undefined
    return [{ room: legacyRoom, node: legacyNode }]
  }
  return []
}

function persist(rooms: FollowedRoom[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rooms))
  } catch {
    return
  }
}

export function useFollowedRooms(): {
  rooms: FollowedRoom[]
  add: (room: string, node?: string) => void
  remove: (room: string) => void
} {
  const [rooms, setRooms] = useState<FollowedRoom[]>(load)

  const add = useCallback((room: string, node?: string) => {
    const name = room.trim()
    if (!name) return
    setRooms((prev) => {
      const next = [{ room: name, node: node?.trim() || undefined }, ...prev.filter((r) => r.room !== name)]
      persist(next)
      return next
    })
  }, [])

  const remove = useCallback((room: string) => {
    setRooms((prev) => {
      const next = prev.filter((r) => r.room !== room)
      persist(next)
      return next
    })
  }, [])

  return { rooms, add, remove }
}
