import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tonnet-bookmarks-'))
  state.userData = directory
  vi.resetModules()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('bookmark repository compatibility', () => {
  it('loads the legacy Zustand envelope and writes the current versioned shape', async () => {
    const file = join(directory, 'bookmarks.json')
    await writeFile(
      file,
      JSON.stringify({
        state: {
          bookmarks: [{ id: 'legacy', title: 'Legacy', url: 'http://legacy.ton' }],
          folders: [],
        },
        version: 0,
      })
    )
    const { loadBookmarks, saveBookmarks } = await import('../index')

    const loaded = await loadBookmarks()
    expect(loaded.bookmarks).toEqual([
      expect.objectContaining({ id: 'legacy', folderId: null, createdAt: 0, order: 0 }),
    ])
    await saveBookmarks(loaded)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      bookmarks: [{ id: 'legacy', folderId: null }],
    })
  })

  it('quarantines corrupt JSON before restoring defaults', async () => {
    const file = join(directory, 'bookmarks.json')
    await writeFile(file, '{broken')
    const { loadBookmarks } = await import('../index')

    const loaded = await loadBookmarks()
    const files = await readdir(directory)

    expect(loaded.bookmarks.length).toBeGreaterThan(0)
    expect(files.some((name) => name.startsWith('bookmarks.json.corrupt-'))).toBe(true)
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(1)
  })
})
