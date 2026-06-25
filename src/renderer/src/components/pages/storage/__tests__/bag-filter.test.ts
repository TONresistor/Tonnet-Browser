import { describe, it, expect } from 'vitest'
import type { StorageBag } from '@shared/types'
import { isBagComplete, filterBags, bagCounts } from '../bag-filter'

function bag(over: Partial<StorageBag>): StorageBag {
  return {
    id: 'a'.repeat(64),
    name: 'file.bin',
    size: 100,
    downloaded: 0,
    uploadSpeed: 0,
    downloadSpeed: 0,
    peers: 0,
    filesCount: 1,
    status: 'downloading',
    ...over,
  }
}

const downloading = bag({ id: 'd'.repeat(64), name: 'ubuntu.iso', status: 'downloading', downloaded: 47 })
const complete = bag({ id: 'c'.repeat(64), name: 'index.html', status: 'seeding', downloaded: 100 })
const paused = bag({ id: 'p'.repeat(64), name: 'paper.pdf', status: 'paused', downloaded: 60 })
const all = [downloading, complete, paused]

describe('isBagComplete', () => {
  it('is true only when fully downloaded with a known size', () => {
    expect(isBagComplete(complete)).toBe(true)
    expect(isBagComplete(downloading)).toBe(false)
    expect(isBagComplete(bag({ size: 0, downloaded: 0 }))).toBe(false)
  })
})

describe('filterBags', () => {
  it('returns everything for the "all" filter', () => {
    expect(filterBags(all, 'all', '')).toHaveLength(3)
  })

  it('keeps only downloading bags', () => {
    expect(filterBags(all, 'downloading', '')).toEqual([downloading])
  })

  it('keeps only complete bags', () => {
    expect(filterBags(all, 'complete', '')).toEqual([complete])
  })

  it('matches the search query against name and id (case-insensitive)', () => {
    expect(filterBags(all, 'all', 'UBUNTU')).toEqual([downloading])
    expect(filterBags(all, 'all', 'cccc')).toEqual([complete])
    expect(filterBags(all, 'all', 'nope')).toEqual([])
  })

  it('combines filter and search', () => {
    expect(filterBags(all, 'complete', 'index')).toEqual([complete])
    expect(filterBags(all, 'downloading', 'index')).toEqual([])
  })
})

describe('bagCounts', () => {
  it('counts each bucket', () => {
    expect(bagCounts(all)).toEqual({ all: 3, downloading: 1, complete: 1 })
    expect(bagCounts([])).toEqual({ all: 0, downloading: 0, complete: 0 })
  })
})
