import { describe, expect, it, vi } from 'vitest'
import { TonConnectService } from '../service'
import { TonConnectManifestLoader } from '../manifest-loader'
import type { StoredTonConnectSession } from '../session-store'

const firstAddress = `0:${'11'.repeat(32)}`
const secondAddress = `0:${'22'.repeat(32)}`

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function connectedTonSite(domain = 'app.ton') {
  const sessions = new Map<string, StoredTonConnectSession>()
  const account = { addressRaw: firstAddress, publicKey: 'aa', walletStateInit: 'state' }
  const wallet = {
    getSessionRevision: () => 1,
    getTonConnectAccount: () => account,
    signTonProof: vi.fn(async () => ({
      timestamp: 1,
      domain: { lengthBytes: domain.length, value: domain },
      signature: 'proof',
      payload: 'nonce',
    })),
    signTonConnectTransaction: vi.fn(),
    signData: vi.fn(async (_domain, payload) => ({
      signature: 'signature',
      address: firstAddress,
      timestamp: 1,
      domain,
      payload,
    })),
  }
  const store = {
    init: async () => {},
    get: (key: string) => sessions.get(key),
    set: async (session: StoredTonConnectSession) => {
      sessions.set(session.domain, session)
    },
    delete: async (key: string) => sessions.delete(key),
    clear: async () => {
      sessions.clear()
    },
    list: () => [...sessions.values()],
    acceptRpcId: async () => true,
  }
  const approval = { request: vi.fn(async (_content: { type: string; [key: string]: unknown }) => true) }
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          url: `http://${domain}`,
          name: 'TON app',
          iconUrl: `http://${domain}/icon.png`,
        })
      )
  )
  const event = { sender: { session: { fetch }, once: vi.fn(), isDestroyed: () => false, send: vi.fn() } }
  const service = new TonConnectService(wallet, store as never, approval, new TonConnectManifestLoader(), {
    track: vi.fn(),
    emitDisconnect: vi.fn(),
  })
  await service.init()
  const connect = () =>
    service.handleRequest(domain, event, {
      method: 'connect',
      protocolVersion: 2,
      request: {
        manifestUrl: `http://${domain}/tonconnect-manifest.json`,
        items: [{ name: 'ton_addr' }, { name: 'ton_proof', payload: 'nonce' }],
      },
    })
  const connected = await connect()
  const sign = () =>
    service.handleRequest(domain, event, {
      method: 'send',
      message: { id: '1', method: 'signData', params: [JSON.stringify({ type: 'text', text: 'ownership' })] },
    })
  return { domain, service, store, wallet, approval, fetch, event, connected, connect, sign }
}

describe('TonConnectService tonsite sessions', () => {
  it.each(['app.ton', 'storage.app.eth'])(
    'connects, restores and signs for http://%s through the tonsite session',
    async (domain) => {
      const s = await connectedTonSite(domain)
      expect(s.connected).toMatchObject({
        event: 'connect',
        payload: {
          items: [
            { name: 'ton_addr', address: firstAddress },
            { name: 'ton_proof', proof: { domain: { value: domain } } },
          ],
        },
      })
      expect(s.fetch).toHaveBeenCalledWith(
        `http://${domain}/tonconnect-manifest.json`,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
      expect(s.wallet.signTonProof).toHaveBeenCalledWith(domain, 'nonce', firstAddress, 1)
      await expect(s.service.handleRequest(domain, s.event, { method: 'restore' })).resolves.toMatchObject({
        event: 'connect',
      })
      await expect(s.sign()).resolves.toMatchObject({ id: '1', result: { domain } })
    }
  )

  it.each(['disconnect', 'rpc-disconnect', 'revoke', 'disable', 'reconnect'])(
    'invalidates a pending signature on %s even if approval completes later',
    async (action) => {
      const s = await connectedTonSite()
      const shown = deferred<void>()
      const decision = deferred<boolean>()
      s.approval.request.mockImplementationOnce(() => {
        shown.resolve()
        return decision.promise
      })
      const signing = s.sign()
      await shown.promise
      if (action === 'disconnect') await s.service.handleRequest(s.domain, s.event, { method: 'disconnect' })
      if (action === 'rpc-disconnect')
        await s.service.handleRequest(s.domain, s.event, {
          method: 'send',
          message: { method: 'disconnect', id: '2', params: [] },
        })
      if (action === 'revoke') await s.service.disconnectSession(s.domain)
      if (action === 'disable') await s.service.clearSessions()
      if (action === 'reconnect') await s.connect()
      decision.resolve(true)
      await expect(signing).resolves.toMatchObject({ id: '1', error: { code: 100 } })
      expect(s.wallet.signData).not.toHaveBeenCalled()
    }
  )

  it.each(['revoke', 'disable'])('rejects new signatures immediately while %s is persisting', async (action) => {
    const s = await connectedTonSite()
    const revoking = action === 'revoke' ? s.service.disconnectSession(s.domain) : s.service.clearSessions()
    const signing = s.sign()
    await revoking
    await expect(signing).resolves.toMatchObject({ id: '1', error: { code: 100 } })
    expect(s.wallet.signData).not.toHaveBeenCalled()
  })
})

describe('TonConnectService wallet identity', () => {
  it('rejects a connection when the wallet changes during approval', async () => {
    let approve: (value: boolean) => void = () => {}
    const approval = new Promise<boolean>((resolve) => {
      approve = resolve
    })
    const wallet = {
      getTonConnectAccount: vi
        .fn()
        .mockReturnValueOnce({ addressRaw: firstAddress, publicKey: 'first', walletStateInit: 'first-state' })
        .mockReturnValueOnce({ addressRaw: secondAddress, publicKey: 'second', walletStateInit: 'second-state' }),
      signTonProof: vi.fn(),
      signTonConnectTransaction: vi.fn(),
      signData: vi.fn(),
    }
    const sessionStore = {
      init: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      list: vi.fn(() => []),
    }
    const service = new TonConnectService(
      wallet,
      sessionStore as never,
      { request: vi.fn(() => approval) },
      {
        load: vi.fn(async () => null),
        loadIcon: vi.fn(async () => null),
      } as never,
      { track: vi.fn(), emitDisconnect: vi.fn() }
    )
    await service.init()
    const request = service.handleRequest(
      'app.ton',
      {
        sender: {
          session: { fetch: vi.fn() },
          once: vi.fn(),
          isDestroyed: vi.fn(() => false),
          send: vi.fn(),
        },
      },
      {
        method: 'connect',
        request: { manifestUrl: 'http://app.ton/manifest.json', items: [{ name: 'ton_addr' }] },
      }
    )

    approve(true)

    await expect(request).resolves.toMatchObject({
      event: 'connect_error',
      payload: { message: 'Wallet changed while connection approval was pending' },
    })
    expect(sessionStore.set).not.toHaveBeenCalled()
  })

  it('does not recreate a session invalidated during approval', async () => {
    let approve: (value: boolean) => void = () => {}
    const approval = new Promise<boolean>((resolve) => {
      approve = resolve
    })
    const account = { addressRaw: firstAddress, publicKey: 'first', walletStateInit: 'first-state' }
    const wallet = {
      getTonConnectAccount: vi.fn(() => account),
      signTonProof: vi.fn(),
      signTonConnectTransaction: vi.fn(),
      signData: vi.fn(),
    }
    const sessionStore = {
      init: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      list: vi.fn(() => []),
    }
    const service = new TonConnectService(
      wallet,
      sessionStore as never,
      { request: vi.fn(() => approval) },
      {
        load: vi.fn(async () => null),
        loadIcon: vi.fn(async () => null),
      } as never,
      { track: vi.fn(), emitDisconnect: vi.fn() }
    )
    await service.init()
    const request = service.handleRequest(
      'app.ton',
      {
        sender: {
          session: { fetch: vi.fn() },
          once: vi.fn(),
          isDestroyed: vi.fn(() => false),
          send: vi.fn(),
        },
      },
      {
        method: 'connect',
        request: { manifestUrl: 'http://app.ton/manifest.json', items: [{ name: 'ton_addr' }] },
      }
    )

    await service.clearSessions()
    approve(true)

    await expect(request).resolves.toMatchObject({ event: 'connect_error' })
    expect(sessionStore.set).not.toHaveBeenCalled()
  })
})
