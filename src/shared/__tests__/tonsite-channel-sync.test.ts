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

describe('tonsite.js IPC channel sync', () => {
  it('hardcodes the current WALLET_PAY_FOR_XHR channel value', () => {
    const src = readFileSync(resolve(process.cwd(), 'resources/preload/tonsite.js'), 'utf-8')
    expect(src).toContain(`'${IPC_CHANNELS.WALLET_PAY_FOR_XHR}'`)
  })

  it('uses current TON Connect channels and preserves the fetched wallet catalogue', async () => {
    const src = readFileSync(resolve(process.cwd(), 'resources/preload/tonsite.js'), 'utf-8')
    expect(src).toContain(`'${IPC_CHANNELS.TONCONNECT_REQUEST}'`)
    expect(src).toContain(`'${IPC_CHANNELS.TONCONNECT_EVENT}'`)
    expect(src).toContain(`'${IPC_CHANNELS.TONCONNECT_AVAILABILITY}'`)
    const injectorStart = src.indexOf('function doInjectFetchShim(')
    const injectorEnd = src.indexOf('function injectFetchShim()', injectorStart)
    expect(injectorStart).toBeGreaterThan(-1)
    expect(injectorEnd).toBeGreaterThan(injectorStart)
    const upstream = [
      { app_name: 'other-wallet', name: 'Other wallet' },
      { app_name: 'tonnet', name: 'Stale' },
    ]
    for (const enabled of [true, false]) {
      const originalFetch = vi.fn(
        async () =>
          new Response(JSON.stringify(upstream), {
            headers: { 'content-type': 'application/json', 'content-length': '123', etag: 'stale' },
          })
      )
      const isEnabled = vi.fn(async () => enabled)
      const window = {
        fetch: originalFetch as typeof fetch,
        tonnet: {
          tonconnect: { isEnabled, walletInfo: { app_name: 'tonnet', name: 'TON Browser', platforms: ['mac'] } },
        },
      }
      let injected = ''
      const script = { textContent: '', remove: () => {} }
      runInNewContext(`${src.slice(injectorStart, injectorEnd)}; doInjectFetchShim(parent)`, {
        document: { createElement: () => script },
        parent: {
          appendChild: () => {
            injected = script.textContent
          },
        },
      })
      runInNewContext(injected, { window, Response, Request, Headers })
      const result = await window.fetch('https://wallets.example/wallets-v2.json')
      expect(originalFetch).toHaveBeenCalledOnce()
      expect(isEnabled).toHaveBeenCalledOnce()
      if (enabled) {
        expect(await result.json()).toEqual([
          { app_name: 'tonnet', name: 'TON Browser', bridge: [{ type: 'js', key: 'tonnet' }], platforms: ['mac'] },
          upstream[0],
        ])
        expect(result.headers.get('content-length')).toBeNull()
        expect(result.headers.get('etag')).toBeNull()
      } else {
        expect(await result.json()).toEqual(upstream)
        expect(result.headers.get('etag')).toBe('stale')
      }
    }
  })
})
