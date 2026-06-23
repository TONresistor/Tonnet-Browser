/**
 * Pure filtering/counting logic for the storage bag list, kept separate from the
 * view so it can be unit-tested without rendering.
 */

import type { StorageBag } from '@shared/types'

export type FilterType = 'all' | 'downloading' | 'complete'

/** A bag is complete once it has a known size and is fully downloaded. */
export function isBagComplete(bag: StorageBag): boolean {
  return bag.size > 0 && bag.downloaded >= bag.size
}

/** Apply the active filter then the free-text search (matches name or bag id). */
export function filterBags(bags: StorageBag[], filter: FilterType, query: string): StorageBag[] {
  const q = query.toLowerCase()
  return bags.filter((bag) => {
    if (filter === 'downloading' && bag.status !== 'downloading') return false
    if (filter === 'complete' && !isBagComplete(bag)) return false
    if (q) return bag.name.toLowerCase().includes(q) || bag.id.toLowerCase().includes(q)
    return true
  })
}

/** Count bags per filter bucket (for the sidebar badges). */
export function bagCounts(bags: StorageBag[]): Record<FilterType, number> {
  return {
    all: bags.length,
    downloading: bags.filter((b) => b.status === 'downloading').length,
    complete: bags.filter(isBagComplete).length,
  }
}
