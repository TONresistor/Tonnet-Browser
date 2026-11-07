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

async function connectedTonSite(
  domain = 'app.ton',
  options: { locked?: boolean; connect?: boolean; version?: string } = {}
) {
  const sessions = new Map<string, StoredTonConnectSession>()
  const account = { addressRaw: firstAddress, publicKey: 'aa', walletStateInit: 'state' }
  let locked = options.locked ?? false
  let revision = 1
  const wallet = {
    getState: () => ({ isLocked: locked, needsPasswordSetup: false, walletVersion: options.version ?? 'v5R1' }),
    unlock: vi.fn(async (_password: string) => {
      locked = false
      revision += 1
    }),
    getSessionRevision: () => revision,
    getTonConnectAccount: () => account,
    signTonProof: vi.fn(async () => ({
      timestamp: 1,
      domain: { lengthBytes: domain.length, value: domain },
      signature: 'proof',
      payload: 'nonce',
    })),
    signTonConnectTransaction: vi.fn(),
    resolveTonConnectItems: vi.fn(),
    signTonConnectMessage: vi.fn(),
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
  const approval = {
    request: vi.fn(async (_content: { type: string; [key: string]: unknown }) => true),
    requestUnlock: vi.fn(async (_domain: string, unlock: (password: string) => Promise<boolean>) =>
      unlock('fixture-password')
    ),
  }
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
  const connected = options.connect === false ? undefined : await connect()
  const sign = () =>
    service.handleRequest(domain, event, {
      method: 'send',
      message: { id: '1', method: 'signData', params: [JSON.stringify({ type: 'text', text: 'ownership' })] },
    })
  return { domain, service, store, wallet, approval, fetch, event, connected, connect, sign }
}

describe('TonConnectService tonsite sessions', () => {
  it.each(['v4R2', 'v5R1'])(
    'advertises structured items and only exposes signMessage for V5R1 (%s)',
    async (version) => {
      const s = await connectedTonSite('app.ton', { version })
      const features = s.service.getFeatures()
      expect(features).toContainEqual({
        name: 'SendTransaction',
        maxMessages: 4,
        extraCurrencySupported: false,
        itemTypes: ['ton', 'jetton', 'nft'],
      })
      expect(features.some((feature) => feature.name === 'SignMessage')).toBe(version === 'v5R1')
      expect(s.connected).toMatchObject({ payload: { device: { features } } })
    }
  )

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
      expect(s.approval.requestUnlock).not.toHaveBeenCalled()
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

describe('TonConnectService wallet unlock', () => {
  it('unlocks first, then asks for connection consent and signs with the new session revision', async () => {
    const s = await connectedTonSite('app.ton', { locked: true })
    expect(s.connected).toMatchObject({
      event: 'connect',
      payload: { items: [{ name: 'ton_addr' }, { name: 'ton_proof', proof: { domain: { value: 'app.ton' } } }] },
    })
    expect(s.wallet.unlock).toHaveBeenCalledWith('fixture-password', expect.any(AbortSignal))
    expect(s.wallet.unlock.mock.invocationCallOrder[0]).toBeLessThan(s.approval.request.mock.invocationCallOrder[0])
    expect(s.wallet.signTonProof).toHaveBeenCalledWith('app.ton', 'nonce', firstAddress, 2)
  })

  it('does not connect or sign when unlocking is cancelled', async () => {
    const s = await connectedTonSite('app.ton', { locked: true, connect: false })
    s.approval.requestUnlock.mockResolvedValueOnce(false)
    await expect(s.connect()).resolves.toMatchObject({ event: 'connect_error', payload: { code: 300 } })
    expect(s.wallet.unlock).not.toHaveBeenCalled()
    expect(s.approval.request).not.toHaveBeenCalled()
    expect(s.wallet.signTonProof).not.toHaveBeenCalled()
    expect(s.store.list()).toEqual([])
  })

  it('requires connection consent after a successful unlock', async () => {
    const s = await connectedTonSite('app.ton', { locked: true, connect: false })
    s.approval.request.mockResolvedValueOnce(false)
    await expect(s.connect()).resolves.toMatchObject({ event: 'connect_error', payload: { code: 300 } })
    expect(s.wallet.unlock).toHaveBeenCalledOnce()
    expect(s.wallet.signTonProof).not.toHaveBeenCalled()
    expect(s.store.list()).toEqual([])
  })

  it('invalidates a pending unlock on disconnect without unlocking or signing later', async () => {
    const s = await connectedTonSite('app.ton', { locked: true, connect: false })
    const shown = deferred<void>()
    const release = deferred<void>()
    s.approval.requestUnlock.mockImplementationOnce(async (_domain, unlock) => {
      shown.resolve()
      await release.promise
      return unlock('fixture-password')
    })
    const connecting = s.connect()
    await shown.promise
    await s.service.disconnectSession(s.domain)
    release.resolve()
    await expect(connecting).resolves.toMatchObject({ event: 'connect_error' })
    expect(s.wallet.unlock).not.toHaveBeenCalled()
    expect(s.wallet.signTonProof).not.toHaveBeenCalled()
    expect(s.store.list()).toEqual([])
  })

  it('does not unlock a wallet replaced while the password prompt is open', async () => {
    const s = await connectedTonSite('app.ton', { locked: true, connect: false })
    s.approval.requestUnlock.mockImplementationOnce(async (_domain, unlock) => {
      vi.spyOn(s.wallet, 'getTonConnectAccount').mockReturnValue({
        addressRaw: secondAddress,
        publicKey: 'bb',
        walletStateInit: 'other',
      })
      return unlock('fixture-password')
    })
    await expect(s.connect()).resolves.toMatchObject({ event: 'connect_error' })
    expect(s.wallet.unlock).not.toHaveBeenCalled()
    expect(s.wallet.signTonProof).not.toHaveBeenCalled()
    expect(s.store.list()).toEqual([])
  })
})

describe('TonConnectService wallet identity', () => {
  it('rejects a connection when the wallet changes during approval', async () => {
    let approve: (value: boolean) => void = () => {}
    const approval = new Promise<boolean>((resolve) => {
      approve = resolve
    })
    let currentAccount = { addressRaw: firstAddress, publicKey: 'first', walletStateInit: 'first-state' }
    const approvalPort = { request: vi.fn(() => approval), requestUnlock: vi.fn() }
    const wallet = {
      getState: () => ({ isLocked: false, needsPasswordSetup: false }),
      unlock: vi.fn(),
      getTonConnectAccount: vi.fn(() => currentAccount),
      signTonProof: vi.fn(),
      signTonConnectTransaction: vi.fn(),
      resolveTonConnectItems: vi.fn(),
      signTonConnectMessage: vi.fn(),
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
      approvalPort,
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

    await vi.waitFor(() => expect(approvalPort.request).toHaveBeenCalledOnce())
    currentAccount = { addressRaw: secondAddress, publicKey: 'second', walletStateInit: 'second-state' }
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
    const approvalPort = { request: vi.fn(() => approval), requestUnlock: vi.fn() }
    const account = { addressRaw: firstAddress, publicKey: 'first', walletStateInit: 'first-state' }
    const wallet = {
      getState: () => ({ isLocked: false, needsPasswordSetup: false }),
      unlock: vi.fn(),
      getTonConnectAccount: vi.fn(() => account),
      signTonProof: vi.fn(),
      signTonConnectTransaction: vi.fn(),
      resolveTonConnectItems: vi.fn(),
      signTonConnectMessage: vi.fn(),
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
      approvalPort,
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

    await vi.waitFor(() => expect(approvalPort.request).toHaveBeenCalledOnce())
    await service.clearSessions()
    approve(true)

    await expect(request).resolves.toMatchObject({ event: 'connect_error' })
    expect(sessionStore.set).not.toHaveBeenCalled()
  })
})
