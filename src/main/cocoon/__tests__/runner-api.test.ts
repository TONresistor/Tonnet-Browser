/**
 * Unit tests for cocoon/runner-api.ts.
 *
 * Mocks:
 *  - global fetch — controls the runner HTTP responses without binding ports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchJsonStats, requestRefund } from '../runner-api'

const VALID_ADDR = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

const MOCK_STATS = {
  status: { wallet_balance: 0, enabled: true },
  localconf: { root_address: VALID_ADDR, owner_address: VALID_ADDR },
  proxy_connections: [],
  proxies: [],
}

let originalFetch: typeof globalThis.fetch
beforeEach(() => {
  originalFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function mockFetchOnce(response: Partial<Response> & { _body?: unknown }): void {
  const body = response._body
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response)
}

// ── fetchJsonStats ──────────────────────────────────────────────────────────

describe('fetchJsonStats', () => {
  it('parses a valid /jsonstats response', async () => {
    mockFetchOnce({ ok: true, _body: MOCK_STATS })
    const result = await fetchJsonStats(10000)
    expect(result.localconf.root_address).toBe(VALID_ADDR)
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:10000/jsonstats', expect.any(Object))
  })

  it('throws on non-200 status', async () => {
    mockFetchOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
    await expect(fetchJsonStats(10000)).rejects.toThrow(/503/)
  })

  it('uses the configured port', async () => {
    mockFetchOnce({ ok: true, _body: MOCK_STATS })
    await fetchJsonStats(12345)
    expect(globalThis.fetch).toHaveBeenCalledWith('http://127.0.0.1:12345/jsonstats', expect.any(Object))
  })
})

// ── control endpoints ──────────────────────────────────────────────────────

describe('runner control endpoints', () => {
  it('requestRefund: hits /request/close with the proxy param and accepts "request sent"', async () => {
    mockFetchOnce({ ok: true, _body: 'request sent\n' })
    await requestRefund(10000, VALID_ADDR)
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('/request/close')
    expect(url).toContain(`proxy=${encodeURIComponent(VALID_ADDR)}`)
  })

  it('rejects when the runner returns a short-answer error body', async () => {
    mockFetchOnce({ ok: true, _body: 'proxy not found' })
    await expect(requestRefund(10000, VALID_ADDR)).rejects.toThrow(/proxy not found/)
  })

  it('rejects when the runner returns "request is already running"', async () => {
    mockFetchOnce({ ok: true, _body: 'request is already running' })
    await expect(requestRefund(10000, VALID_ADDR)).rejects.toThrow(/already running/)
  })

  it('accepts the HTML-wrapped response upstream actually sends', async () => {
    mockFetchOnce({
      ok: true,
      _body: '<!DOCTYPE html>\n<html><body>\nRequest sent<br/>\n<a href="/stats">return to stats</a>\n</html></body>\n',
    })
    await expect(requestRefund(10000, VALID_ADDR)).resolves.toBeUndefined()
  })

  it('extracts the error text from an HTML-wrapped error body', async () => {
    mockFetchOnce({
      ok: true,
      _body:
        '<!DOCTYPE html>\n<html><body>\nproxy not found<br/>\n<a href="/stats">return to stats</a>\n</html></body>\n',
    })
    await expect(requestRefund(10000, VALID_ADDR)).rejects.toThrow(/proxy not found/)
  })

  it('rejects on non-200 status', async () => {
    mockFetchOnce({ ok: false, status: 500, statusText: 'Internal Error' })
    await expect(requestRefund(10000, VALID_ADDR)).rejects.toThrow(/500/)
  })

  it('URL-encodes the proxy address in case it contains special chars', async () => {
    mockFetchOnce({ ok: true, _body: 'request sent' })
    const oddAddress = 'kQCns/bY+Sp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'
    await requestRefund(10000, oddAddress)
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain(encodeURIComponent(oddAddress))
  })
})
