import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createTonSession = vi.hoisted(() =>
  vi.fn(async () => ({ clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}) }))
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
})
