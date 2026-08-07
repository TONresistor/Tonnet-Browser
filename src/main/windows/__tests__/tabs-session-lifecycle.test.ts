import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createTonSession = vi.hoisted(() =>
  vi.fn(async () => ({
    clearStorageData: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}),
    setProxy: vi.fn(async () => {}),
    closeAllConnections: vi.fn(async () => {}),
  }))
)

vi.mock('../browser-view', () => ({ createTonSession }))
vi.mock('../../settings', () => ({
  getSetting: () => ({ firstPartyIsolation: true, cookieAutoDelete: true, cookieAutoDeleteMinutes: 30 }),
}))

import { TabSessionManager } from '../tabs-session'

describe('tab session lifecycle', () => {
  let manager: TabSessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    createTonSession.mockClear()
    manager = new TabSessionManager()
    manager.initialize({} as never)
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  it('owns the cookie cleanup timer and session cache until disposal', async () => {
    const first = await manager.getSessionForDomain('example.ton', 8080)
    const cached = await manager.getSessionForDomain('example.ton', 8080)

    expect(cached).toBe(first)
    expect(createTonSession).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)

    manager.dispose()

    expect(vi.getTimerCount()).toBe(0)
    manager.initialize({} as never)
    await manager.getSessionForDomain('example.ton', 8080)
    expect(createTonSession).toHaveBeenCalledTimes(2)
  })

  it('preserves live sessions across a window detach', async () => {
    const session = await manager.getSessionForDomain('example.ton', 8080)
    manager.setTabDomain('tab-1', 'example.ton')

    manager.detachWindow()

    expect(manager.getTabDomain('tab-1')).toBeUndefined()
    expect(manager.getAllSessions()).toEqual([session])
    expect(await manager.getSessionForDomain('example.ton', 8080)).toBe(session)
  })

  it('moves existing sessions to the effective runtime proxy port', async () => {
    const session = await manager.getSessionForDomain('example.ton', 8080)

    await manager.updateProxyPort(9090)

    expect(session.setProxy).toHaveBeenCalledWith({ proxyRules: 'http://127.0.0.1:9090' })
    expect(session.closeAllConnections).toHaveBeenCalledOnce()
  })
})
