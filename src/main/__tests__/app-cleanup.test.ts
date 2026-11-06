import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServiceRegistry } from '../services'

const state = vi.hoisted(() => ({ profile: '', clearOnExit: true }))
vi.mock('electron', () => ({ app: { getPath: () => state.profile } }))
vi.mock('../settings', () => ({
  getSetting: () => ({ clearOnExit: state.clearOnExit }),
  loadSettings: () => ({ bridge: { permissions: [] }, wallet: { sitePolicies: [], autoPayDomains: [] } }),
}))
vi.mock('../services', () => ({ destroyServices: vi.fn(async () => {}) }))
vi.mock('../logging/native-log-router', () => ({ flushNativeLogs: vi.fn(async () => {}) }))

beforeEach(async () => {
  state.profile = await mkdtemp(join(tmpdir(), 'tonnet-cleanup-regression-'))
  vi.resetModules()
})
afterEach(async () => {
  await rm(state.profile, { recursive: true, force: true })
})

it.each([true, false])('preserves user-saved bookmarks and folders when clearOnExit=%s', async (clearOnExit) => {
  state.clearOnExit = clearOnExit
  const bookmarks = join(state.profile, 'bookmarks.json')
  const cookies = join(state.profile, 'cookies-fixture')
  const saved = JSON.stringify({
    schemaVersion: 1,
    bookmarks: [{ id: 'saved', title: 'Saved favorite', url: 'http://fixture.ton/', folderId: 'folder' }],
    folders: [{ id: 'folder', name: 'Saved folder' }],
  })
  await writeFile(bookmarks, saved)
  await writeFile(cookies, 'private session data')
  const session = {
    clearCache: vi.fn(async () => {}),
    clearStorageData: vi.fn(async () => {
      await rm(cookies)
    }),
  }
  const services = { tabManager: { sessions: { getAllSessions: () => [session] } } } as unknown as ServiceRegistry
  const { runCleanup } = await import('../app-cleanup')
  await runCleanup(services)
  expect(await readFile(bookmarks, 'utf8')).toBe(saved)
  if (clearOnExit) {
    await expect(access(cookies)).rejects.toThrow()
    expect(session.clearStorageData).toHaveBeenCalledWith(
      expect.objectContaining({ storages: expect.arrayContaining(['cookies', 'localstorage']) })
    )
  } else {
    expect(await readFile(cookies, 'utf8')).toBe('private session data')
  }
})
