import { describe, it, expect } from 'vitest'
import {
  getFileCategory,
  normalizePath,
  buildEntries,
  sortEntries,
  breadcrumbs,
  entryStats,
  type RawFile,
} from '../bag-files'

const files: RawFile[] = [
  { name: 'cover.jpg', size: 100 },
  { name: 'readme.txt', size: 10 },
  { name: 'disc1/01 intro.mp3', size: 500 },
  { name: 'disc1/02 outro.mp3', size: 300 },
  { name: 'disc2/track.flac', size: 800 },
]

describe('getFileCategory', () => {
  it('maps known extensions and falls back to other', () => {
    expect(getFileCategory('song.mp3')).toBe('audio')
    expect(getFileCategory('clip.MP4')).toBe('video')
    expect(getFileCategory('a.b.png')).toBe('image')
    expect(getFileCategory('main.ts')).toBe('code')
    expect(getFileCategory('noext')).toBe('other')
    expect(getFileCategory('weird.xyz')).toBe('other')
  })
})

describe('normalizePath', () => {
  it('always returns leading + trailing slash form', () => {
    expect(normalizePath('')).toBe('/')
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('disc1')).toBe('/disc1/')
    expect(normalizePath('/disc1/')).toBe('/disc1/')
    expect(normalizePath('//a//b//')).toBe('/a//b/')
  })
})

describe('buildEntries', () => {
  it('lists root files and collapses nested files into virtual folders', () => {
    const entries = buildEntries(files, '/')
    const folders = entries.filter((e) => e.kind === 'folder')
    const plain = entries.filter((e) => e.kind === 'file')
    expect(folders.map((f) => f.name).sort()).toEqual(['disc1', 'disc2'])
    expect(plain.map((f) => f.name).sort()).toEqual(['cover.jpg', 'readme.txt'])

    const disc1 = folders.find((f) => f.name === 'disc1')!
    expect(disc1.kind).toBe('folder')
    if (disc1.kind === 'folder') {
      expect(disc1.count).toBe(2)
      expect(disc1.size).toBe(800)
    }
  })

  it('lists files inside a folder with their full path', () => {
    const entries = buildEntries(files, '/disc1/')
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.kind === 'file')).toBe(true)
    const intro = entries.find((e) => e.name === '01 intro.mp3')!
    if (intro.kind === 'file') {
      expect(intro.fullPath).toBe('disc1/01 intro.mp3')
      expect(intro.category).toBe('audio')
    }
  })

  it('returns nothing for an unknown path', () => {
    expect(buildEntries(files, '/nope/')).toEqual([])
  })
})

describe('sortEntries', () => {
  it('keeps folders first regardless of field', () => {
    const entries = sortEntries(buildEntries(files, '/'), 'size', true)
    expect(entries[0].kind).toBe('folder')
    expect(entries[1].kind).toBe('folder')
  })

  it('sorts by name ascending and descending', () => {
    const root = buildEntries(files, '/')
    const asc = sortEntries(root, 'name', true).filter((e) => e.kind === 'file')
    const desc = sortEntries(root, 'name', false).filter((e) => e.kind === 'file')
    expect(asc.map((e) => e.name)).toEqual(['cover.jpg', 'readme.txt'])
    expect(desc.map((e) => e.name)).toEqual(['readme.txt', 'cover.jpg'])
  })

  it('sorts by size', () => {
    const inDisc1 = sortEntries(buildEntries(files, '/disc1/'), 'size', true)
    expect(inDisc1.map((e) => e.size)).toEqual([300, 500])
  })
})

describe('breadcrumbs', () => {
  it('returns root only at top level', () => {
    expect(breadcrumbs('/')).toEqual([{ name: 'root', path: '/' }])
  })

  it('builds cumulative paths', () => {
    expect(breadcrumbs('/disc1/live/')).toEqual([
      { name: 'root', path: '/' },
      { name: 'disc1', path: '/disc1/' },
      { name: 'live', path: '/disc1/live/' },
    ])
  })
})

describe('entryStats', () => {
  it('counts files (folders contribute their recursive count) and total size', () => {
    const stats = entryStats(buildEntries(files, '/'))
    expect(stats.fileCount).toBe(5)
    expect(stats.totalSize).toBe(100 + 10 + 500 + 300 + 800)
  })
})
