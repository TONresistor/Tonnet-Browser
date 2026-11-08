/**
 * resources/preload/tonsite.js is a plain (non-bundled) preload script injected
 * into tonsites, so it cannot import IPC_CHANNELS and must hardcode the channel
 * name. This guards against IPC_CHANNELS.WALLET_PAY_FOR_XHR drifting out of sync
 * with that literal (the constant carries a "keep in sync" comment for the same
 * reason).
 */
import { describe, it, expect, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { IPC_CHANNELS } from '../ipc-channels'

const source = readFileSync(resolve(process.cwd(), 'resources/preload/tonsite.js'), 'utf-8')
const catalogueUrl = 'https://config.ton.org/wallets-v2.json'

function install(originalFetch = vi.fn<typeof fetch>(), enabled = true, features?: unknown[]) {
  const window = { fetch: originalFetch as typeof fetch, location: { href: 'http://app.ton/' } }
  const page = { window, Response, Request, URL }
  const ipcRenderer = {
    invoke: vi.fn(async (channel: string) =>
      channel === IPC_CHANNELS.TONCONNECT_AVAILABILITY ? { enabled, features } : { success: true }
    ),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  const contextBridge = {
    exposeInMainWorld: (key: string, value: unknown) => Object.assign(window, { [key]: value }),
    executeInMainWorld: vi.fn(({ func }: { func: () => unknown }) =>
      func.name === 'installPrivacy' ? { applied: [], failed: [] } : runInNewContext(`(${func.toString()})()`, page)
    ),
  }
  runInNewContext(source, {
    require: () => ({ contextBridge, ipcRenderer }),
    process: { contextIsolated: true },
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  return { window, ipcRenderer, contextBridge }
}

describe('tonsite.js fetch compatibility', () => {
  it('uses native account capabilities in the local catalogue, including conditional signMessage', async () => {
    for (const v5 of [false, true]) {
      const features = [
        { name: 'SendTransaction', maxMessages: 4, itemTypes: ['ton', 'jetton', 'nft'] },
        ...(v5 ? [{ name: 'SignMessage', maxMessages: 4, itemTypes: ['ton', 'jetton', 'nft'] }] : []),
      ]
      const { window } = install(vi.fn<typeof fetch>(), true, features)
      expect((await (await window.fetch(catalogueUrl)).json())[0].features).toEqual(features)
    }
  })
  it('uses the current IPC channels', () => {
    for (const channel of [
      IPC_CHANNELS.WALLET_PAY_FOR_XHR,
      IPC_CHANNELS.TONCONNECT_REQUEST,
      IPC_CHANNELS.TONCONNECT_EVENT,
      IPC_CHANNELS.TONCONNECT_AVAILABILITY,
    ])
      expect(source).toContain(`'${channel}'`)
  })

  it('installs in the page world before any DOM is available', () => {
    const originalFetch = vi.fn<typeof fetch>()
    const { window, contextBridge } = install(originalFetch)
    expect(window.fetch).not.toBe(originalFetch)
    expect(contextBridge.executeInMainWorld).toHaveBeenCalledWith({ func: expect.any(Function) })
  })

  it('serves only Tonnet locally without requesting the remote catalogue', async () => {
    const other = { app_name: 'other-wallet', name: 'Other wallet' }
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([other, { app_name: 'tonnet', name: 'Stale' }]), {
        headers: { 'content-length': '123', 'content-encoding': 'gzip', etag: 'stale' },
      })
    )
    const { window, ipcRenderer } = install(originalFetch)
    const response = await window.fetch(catalogueUrl)
    const wallets = await response.json()
    expect(wallets).toHaveLength(1)
    expect(wallets[0]).toMatchObject({ app_name: 'tonnet', name: 'Tonnet', bridge: [{ type: 'js', key: 'tonnet' }] })
    expect(originalFetch).not.toHaveBeenCalled()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TONCONNECT_AVAILABILITY)
    for (const header of ['content-length', 'content-encoding', 'etag']) expect(response.headers.get(header)).toBeNull()
  })

  it.each(['offline', 'http-error', 'pending'])('does not depend on a remote catalogue that is %s', async (failure) => {
    const originalFetch = vi.fn<typeof fetch>()
    if (failure === 'offline') originalFetch.mockRejectedValue(new TypeError('CONNECT tunnel failed: 405'))
    else if (failure === 'http-error') originalFetch.mockResolvedValue(new Response('', { status: 405 }))
    else originalFetch.mockImplementation(() => new Promise(() => {}))
    const { window } = install(originalFetch)
    const response = await window.fetch(catalogueUrl)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      expect.objectContaining({ app_name: 'tonnet', bridge: [{ type: 'js', key: 'tonnet' }] }),
    ])
    expect(originalFetch).not.toHaveBeenCalled()
  })

  it.each([
    catalogueUrl + '?v=2',
    'https://raw.githubusercontent.com/ton-connect/wallets-list/main/wallets-v2.json',
    'https://raw.githubusercontent.com/ton-connect/wallets-list/refs/heads/main/wallets-v2.json',
    'https://raw.githubusercontent.com/ton-blockchain/wallets-list/main/wallets-v2.json',
    'https://raw.githubusercontent.com/ton-blockchain/wallets-list/refs/heads/main/wallets-v2.json',
    new URL(catalogueUrl),
    new Request(catalogueUrl),
  ])('recognizes official catalogue input %s', async (input) => {
    const originalFetch = vi.fn<typeof fetch>()
    const { window } = install(originalFetch)
    expect(await (await window.fetch(input)).json()).toMatchObject([{ app_name: 'tonnet' }])
    expect(originalFetch).not.toHaveBeenCalled()
  })

  it.each([
    'https://config.ton.org.evil.test/wallets-v2.json',
    'https://config.ton.org/wallets-v2.json/extra',
    'https://config.ton.org/other?file=wallets-v2.json',
    'http://app.ton/wallets-v2.json',
    'https://raw.githubusercontent.com/other/repo/main/wallets-v2.json',
  ])('does not intercept unrelated URL %s', async (url) => {
    const expected = new Response('original')
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValue(expected)
    const { window, ipcRenderer } = install(originalFetch)
    expect(await window.fetch(url)).toBe(expected)
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it.each(['POST', 'HEAD'])('does not intercept a %s catalogue request', async (method) => {
    const expected = new Response('original')
    const { window, ipcRenderer } = install(vi.fn<typeof fetch>().mockResolvedValue(expected))
    expect(await window.fetch(catalogueUrl, { method })).toBe(expected)
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it.each(['request', 'init'])('preserves a catalogue POST supplied through %s', async (methodSource) => {
    const expected = new Response('original')
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValue(expected)
    const { window, ipcRenderer } = install(originalFetch)
    const post = { method: 'POST', body: 'payload' }
    const request = new Request(catalogueUrl, methodSource === 'request' ? post : undefined)

    expect(await window.fetch(request, methodSource === 'init' ? post : undefined)).toBe(expected)
    expect(originalFetch).toHaveBeenCalledTimes(1)
    const forwarded = originalFetch.mock.calls[0][0] as Request
    expect(forwarded.url).toBe(catalogueUrl)
    expect(forwarded.method).toBe('POST')
    expect(await forwarded.text()).toBe('payload')
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('preserves unrelated request options, body, cancellation and non-402 responses', async () => {
    const expected = new Response('not found', { status: 404 })
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValue(expected)
    const { window, ipcRenderer } = install(originalFetch)
    const controller = new AbortController()
    const request = new Request('http://app.ton/api', {
      method: 'POST',
      headers: { 'X-Fixture': 'initial' },
      body: 'initial',
    })

    expect(
      await window.fetch(request, {
        headers: { 'X-Fixture': 'updated' },
        body: 'payload',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'manual',
        signal: controller.signal,
      })
    ).toBe(expected)
    expect(originalFetch).toHaveBeenCalledTimes(1)
    const forwarded = originalFetch.mock.calls[0][0] as Request
    expect(forwarded.url).toBe(request.url)
    expect(forwarded.method).toBe('POST')
    expect(forwarded.headers.get('X-Fixture')).toBe('updated')
    expect(forwarded.credentials).toBe('include')
    expect(forwarded.cache).toBe('no-store')
    expect(forwarded.redirect).toBe('manual')
    expect(await forwarded.text()).toBe('payload')
    controller.abort()
    expect(forwarded.signal.aborted).toBe(true)
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('propagates unrelated network errors without retrying or requesting wallet access', async () => {
    const error = new TypeError('offline')
    const originalFetch = vi.fn<typeof fetch>().mockRejectedValue(error)
    const { window, ipcRenderer } = install(originalFetch)

    await expect(window.fetch('http://app.ton/api')).rejects.toBe(error)
    expect(originalFetch).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('preserves the upstream response and errors when TON Connect is disabled', async () => {
    const expected = new Response('[]')
    const error = new TypeError('offline')
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(expected).mockRejectedValueOnce(error)
    const { window } = install(originalFetch, false)
    expect(await window.fetch(catalogueUrl)).toBe(expected)
    await expect(window.fetch(catalogueUrl)).rejects.toBe(error)
  })

  it('preserves caller cancellation when serving the local catalogue', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = controller.signal.reason
    const originalFetch = vi.fn<typeof fetch>()
    const { window } = install(originalFetch)
    await expect(window.fetch(catalogueUrl, { signal: controller.signal })).rejects.toBe(error)
    expect(originalFetch).not.toHaveBeenCalled()
  })

  it('preserves the HTTP 402 payment retry and request body', async () => {
    const expected = new Response('paid')
    const originalFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('payment', { status: 402 }))
      .mockResolvedValueOnce(expected)
    const { window, ipcRenderer } = install(originalFetch)
    expect(await window.fetch('http://app.ton/api', { method: 'POST', body: 'payload' })).toBe(expected)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.WALLET_PAY_FOR_XHR, { url: 'http://app.ton/api' })
    const retry = originalFetch.mock.calls[1][0] as Request
    expect(retry.method).toBe('POST')
    expect(await retry.text()).toBe('payload')
  })
})
