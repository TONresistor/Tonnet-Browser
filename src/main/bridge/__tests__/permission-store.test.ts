import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsSchema, type AppSettings } from '../../../shared/schemas'

const state = vi.hoisted(() => ({
  current: null as AppSettings | null,
  gate: null as Promise<void> | null,
  failure: null as Error | null,
  tail: Promise.resolve() as Promise<void>,
}))

const transactSettings = vi.hoisted(() => vi.fn())

vi.mock('../../settings', () => ({
  getSetting: vi.fn((category: keyof AppSettings) => state.current?.[category]),
  transactSettings: transactSettings.mockImplementation(
    (
      transform: (current: AppSettings) => AppSettings,
      reconcile: (previous: AppSettings, current: AppSettings) => Promise<void>
    ) => {
      const result = state.tail
        .catch(() => undefined)
        .then(async () => {
          await state.gate
          if (state.failure) throw state.failure
          const previous = state.current as AppSettings
          const current = transform(previous)
          await reconcile(previous, current)
          state.current = current
          return current
        })
      state.tail = result.then(
        () => undefined,
        () => undefined
      )
      return result
    }
  ),
}))

vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), event: vi.fn() }),
}))

import { BridgePermissionStore } from '../permission-store'

describe('BridgePermissionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.current = AppSettingsSchema.parse({})
    state.gate = null
    state.failure = null
    state.tail = Promise.resolve()
  })

  it('publishes a persistent grant only after the canonical settings transaction succeeds', async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const store = new BridgePermissionStore()

    const writing = store.setPermission('app.ton', 'blockchain', 'granted')
    await Promise.resolve()

    expect(store.getPermission('app.ton', 'blockchain')).toBe('unknown')

    release()
    await writing

    expect(store.getPermission('app.ton', 'blockchain')).toBe('granted')
  })

  it('merges a grant into the latest canonical settings snapshot', async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const store = new BridgePermissionStore()
    const writing = store.setPermission('first.ton', 'blockchain', 'granted')
    await Promise.resolve()

    const current = state.current as AppSettings
    state.current = {
      ...current,
      bridge: {
        ...current.bridge,
        permissions: [{ domain: 'second.ton', scope: 'p2p', decision: 'denied', grantedAt: 1 }],
      },
    }
    release()
    await writing

    expect((state.current as AppSettings).bridge.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'first.ton', scope: 'blockchain', decision: 'granted' }),
        expect.objectContaining({ domain: 'second.ton', scope: 'p2p', decision: 'denied' }),
      ])
    )
  })

  it('preserves concurrent persistent grants through the shared settings queue', async () => {
    const store = new BridgePermissionStore()

    await Promise.all([
      store.setPermission('first.ton', 'blockchain', 'granted'),
      store.setPermission('second.ton', 'p2p', 'denied'),
    ])

    expect((state.current as AppSettings).bridge.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'first.ton', scope: 'blockchain', decision: 'granted' }),
        expect.objectContaining({ domain: 'second.ton', scope: 'p2p', decision: 'denied' }),
      ])
    )
  })

  it('leaves canonical visibility unchanged when persistence fails', async () => {
    const store = new BridgePermissionStore()
    state.failure = new Error('disk full')

    await expect(store.setPermission('app.ton', 'write', 'granted')).rejects.toThrow('disk full')

    expect(store.getPermission('app.ton', 'write')).toBe('unknown')
  })

  it('keeps session grants in memory without starting a settings transaction', async () => {
    const store = new BridgePermissionStore()

    await store.setPermission('app.ton', 'p2p', 'session')

    expect(transactSettings).not.toHaveBeenCalled()
    expect(store.getPermission('app.ton', 'p2p')).toBe('session')
    expect(store.getAllPermissions()).toEqual([
      expect.objectContaining({ domain: 'app.ton', scope: 'p2p', decision: 'session' }),
    ])
  })

  it('removes a session grant immediately while joining the canonical settings queue', async () => {
    const store = new BridgePermissionStore()
    await store.setPermission('app.ton', 'p2p', 'session')
    transactSettings.mockClear()

    const revoking = store.revokePermission('app.ton', 'p2p')

    expect(store.getPermission('app.ton', 'p2p')).toBe('unknown')
    await revoking
    expect(transactSettings).toHaveBeenCalledOnce()
  })

  it('revokes a canonical grant published by an earlier in-flight settings mutation', async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = state.current as AppSettings
    const adding = transactSettings(
      () => ({
        ...current,
        bridge: {
          ...current.bridge,
          permissions: [{ domain: 'app.ton', scope: 'p2p', decision: 'granted', grantedAt: 1 }],
        },
      }),
      async () => {}
    )
    const store = new BridgePermissionStore()
    const revoking = store.revokePermission('app.ton', 'p2p')

    release()
    await Promise.all([adding, revoking])

    expect(store.getPermission('app.ton', 'p2p')).toBe('unknown')
  })

  it('preserves a later session grant while an earlier persistent revoke is pending', async () => {
    const current = state.current as AppSettings
    state.current = {
      ...current,
      bridge: {
        ...current.bridge,
        permissions: [{ domain: 'app.ton', scope: 'p2p', decision: 'granted', grantedAt: 1 }],
      },
    }
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const store = new BridgePermissionStore()

    const revoking = store.revokePermission('app.ton', 'p2p')
    const granting = store.setPermission('app.ton', 'p2p', 'session')
    await Promise.resolve()
    release()
    await Promise.all([revoking, granting])

    expect(store.getPermission('app.ton', 'p2p')).toBe('session')
  })

  it('keeps a persistent grant visible when its revoke transaction fails', async () => {
    const current = state.current as AppSettings
    state.current = {
      ...current,
      bridge: {
        ...current.bridge,
        permissions: [{ domain: 'app.ton', scope: 'write', decision: 'granted', grantedAt: 1 }],
      },
    }
    const store = new BridgePermissionStore()
    state.failure = new Error('disk full')

    await expect(store.revokePermission('app.ton', 'write')).rejects.toThrow('disk full')

    expect(store.getPermission('app.ton', 'write')).toBe('granted')
  })

  it('clears only session grants', async () => {
    const current = state.current as AppSettings
    state.current = {
      ...current,
      bridge: {
        ...current.bridge,
        permissions: [{ domain: 'saved.ton', scope: 'write', decision: 'granted', grantedAt: 1 }],
      },
    }
    const store = new BridgePermissionStore()
    await store.setPermission('session.ton', 'p2p', 'session')

    store.clearSessionGrants()

    expect(store.getPermission('session.ton', 'p2p')).toBe('unknown')
    expect(store.getPermission('saved.ton', 'write')).toBe('granted')
  })

  it('invalidates a queued session grant when its sender is cleaned up', async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const store = new BridgePermissionStore()

    const persisting = store.setPermission('saved.ton', 'write', 'granted')
    const granting = store.setPermission('app.ton', 'p2p', 'session')
    store.revokeSessionPermission('app.ton', 'p2p')
    release()
    await Promise.all([persisting, granting])

    expect(store.getPermission('app.ton', 'p2p')).toBe('unknown')
  })

  it('invalidates every queued session grant when sessions are cleared', async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const store = new BridgePermissionStore()

    const persisting = store.setPermission('saved.ton', 'write', 'granted')
    const first = store.setPermission('first.ton', 'p2p', 'session')
    const second = store.setPermission('second.ton', 'blockchain', 'session')
    store.clearSessionGrants()
    release()
    await Promise.all([persisting, first, second])

    expect(store.getPermission('first.ton', 'p2p')).toBe('unknown')
    expect(store.getPermission('second.ton', 'blockchain')).toBe('unknown')
  })

  it('does not expose mutable references to canonical grants', () => {
    const current = state.current as AppSettings
    state.current = {
      ...current,
      bridge: {
        ...current.bridge,
        permissions: [{ domain: 'saved.ton', scope: 'write', decision: 'granted', grantedAt: 1 }],
      },
    }
    const store = new BridgePermissionStore()

    const permissions = store.getAllPermissions()
    permissions[0].domain = 'changed.ton'

    expect(store.getPermission('saved.ton', 'write')).toBe('granted')
    expect(store.getPermission('changed.ton', 'write')).toBe('unknown')
  })
})
