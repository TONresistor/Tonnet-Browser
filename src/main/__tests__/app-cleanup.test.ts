import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TonConnectSessionStore } from '../tonconnect/session-store'
import { TonConnectService } from '../tonconnect/service'
import type { ServiceRegistry } from '../services'

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  getSetting: vi.fn(),
  destroy: vi.fn(async () => {}),
  flush: vi.fn(async () => {}),
  info: vi.fn(),
  error: vi.fn(),
}))
vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))
vi.mock('../settings', () => ({
  getSetting: mocks.getSetting,
  loadSettings: () => ({ bridge: { permissions: [] }, wallet: { sitePolicies: [], autoPayDomains: [] } }),
}))
vi.mock('../services', () => ({ destroyServices: mocks.destroy }))
vi.mock('../logging/native-log-router', () => ({ flushNativeLogs: mocks.flush }))
vi.mock('../bookmarks', () => ({ getBookmarksFile: () => join(mocks.getPath(), 'bookmarks.json') }))
vi.mock('../../shared/logger', () => ({
  default: { info: mocks.info, error: mocks.error },
  createLogger: () => ({ debug: vi.fn(), error: mocks.error, event: vi.fn() }),
}))

let directory: string
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'tonconnect-cleanup-'))
  mocks.getPath.mockReturnValue(directory)
  mocks.getSetting.mockReturnValue({ clearOnExit: true })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const filePath = join(directory, 'tonconnect', 'sessions.json')
  const store = new TonConnectSessionStore(filePath)
  const service = new TonConnectService({} as never, store, {} as never, {} as never, {
    track: vi.fn(),
    emitDisconnect: vi.fn(),
  })
  await service.init()
  for (const domain of ['one.ton', 'two.ton']) {
    await store.set({
      domain,
      manifestUrl: `http://${domain}/manifest.json`,
      appName: domain,
      url: `http://${domain}`,
      address: `0:${'11'.repeat(32)}`,
      network: '-239',
      grantedAt: 1,
      lastEventId: 0,
      lastRpcId: null,
    })
  }
  const sessions = {
    getAllSessions: vi.fn((): Array<{ clearCache: () => Promise<void>; clearStorageData: () => Promise<void> }> => []),
  }
  const registry = { tonConnectService: service, tabManager: { sessions } } as unknown as ServiceRegistry
  const persisted = async () => {
    const reopened = new TonConnectSessionStore(filePath)
    await reopened.init()
    return reopened
      .list()
      .map(({ domain }) => domain)
      .sort()
  }
  const { runCleanup } = await import('../app-cleanup')
  return { service, sessions, registry, persisted, runCleanup }
}

it.each([true, false])('preserves user-saved bookmarks and folders when clearOnExit=%s', async (clearOnExit) => {
  mocks.getSetting.mockReturnValue({ clearOnExit })
  const s = await fixture()
  const bookmarks = join(directory, 'bookmarks.json')
  const cookies = join(directory, 'cookies-fixture')
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
  s.sessions.getAllSessions.mockReturnValue([session])
  await s.runCleanup(s.registry)
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

describe('clear-on-exit TON Connect permissions', () => {
  it('removes all persisted permissions before teardown even when their tabs are closed', async () => {
    const s = await fixture()
    expect(await s.persisted()).toEqual(['one.ton', 'two.ton'])
    mocks.destroy.mockImplementationOnce(async () => {
      expect(await s.persisted()).toEqual([])
    })

    await s.runCleanup(s.registry)

    expect(await s.persisted()).toEqual([])
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.flush).toHaveBeenCalledWith(1000)
  })

  it('keeps persisted permissions when clear-on-exit is disabled', async () => {
    mocks.getSetting.mockReturnValue({ clearOnExit: false })
    const s = await fixture()
    const clear = vi.spyOn(s.service, 'clearSessions')

    await s.runCleanup(s.registry)

    expect(clear).not.toHaveBeenCalled()
    expect(await s.persisted()).toEqual(['one.ton', 'two.ton'])
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('awaits permission persistence and prevents duplicate cleanup', async () => {
    const s = await fixture()
    const original = s.service.clearSessions.bind(s.service)
    let finish!: () => void
    const wait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const clear = vi.spyOn(s.service, 'clearSessions').mockImplementation(async () => {
      await wait
      await original()
    })
    const cleanup = s.runCleanup(s.registry)
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())
    await s.runCleanup(s.registry)
    expect(mocks.destroy).not.toHaveBeenCalled()
    finish()
    await cleanup
    expect(await s.persisted()).toEqual([])
    expect(clear).toHaveBeenCalledOnce()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('still revokes permissions when clearing web storage fails', async () => {
    const s = await fixture()
    s.sessions.getAllSessions.mockReturnValue([
      {
        clearCache: vi.fn(async () => {}),
        clearStorageData: vi.fn(async () => {
          throw new Error('storage failure')
        }),
      },
    ])

    await s.runCleanup(s.registry)

    expect(await s.persisted()).toEqual([])
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('reports permission cleanup failures and still tears down the services', async () => {
    const s = await fixture()
    vi.spyOn(s.service, 'clearSessions').mockRejectedValueOnce(new Error('disk full'))

    await s.runCleanup(s.registry)

    expect(mocks.error).toHaveBeenCalledWith('Failed to clear TON Connect sessions: Error: disk full')
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(mocks.flush).toHaveBeenCalledWith(1000)
  })
})
