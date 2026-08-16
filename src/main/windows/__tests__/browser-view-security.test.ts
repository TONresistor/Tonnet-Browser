import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  getSetting: vi.fn(() => ({ disableCache: false })),
}))

vi.mock('electron', () => ({
  WebContentsView: class {},
  session: { fromPartition: mocks.fromPartition },
}))
vi.mock('../../settings', () => ({ getSetting: mocks.getSetting }))

import { createTonSession } from '../browser-view'

function createSession() {
  const listeners: {
    onBeforeRequest?: (details: Record<string, unknown>, callback: (response: unknown) => void) => void
    onHeadersReceived?: (details: Record<string, unknown>, callback: (response: unknown) => void) => void
  } = {}
  const session = {
    setProxy: vi.fn(() => Promise.resolve()),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setUserAgent: vi.fn(),
    webRequest: {
      onBeforeRequest: vi.fn((listener) => {
        listeners.onBeforeRequest = listener
      }),
      onBeforeSendHeaders: vi.fn(),
      onHeadersReceived: vi.fn((_filter, listener) => {
        listeners.onHeadersReceived = listener
      }),
    },
  }
  return { session, listeners }
}

async function setupSession() {
  const { session, listeners } = createSession()
  mocks.fromPartition.mockReturnValue(session)
  await createTonSession(
    {
      paymentInterceptor: {
        consumeXhrPaymentToken: vi.fn(),
        registerOnSession: vi.fn(),
      },
    } as never,
    8080
  )
  return listeners
}

describe('tonsite session security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves the site CSP and adds browser restrictions', async () => {
    const listeners = await setupSession()

    const callback = vi.fn()
    listeners.onHeadersReceived?.(
      {
        responseHeaders: {
          'content-security-policy': ["default-src 'self'"],
          ETag: ['tracker'],
          'X-Test': ['kept'],
        },
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'X-Test': ['kept'],
        'Referrer-Policy': ['no-referrer'],
        'Content-Security-Policy': ["default-src 'self'", "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"],
      },
    })
  })

  it('cleans tracking parameters only from GET main-frame requests', async () => {
    const listeners = await setupSession()
    const url = 'http://site.ton/path?value=hello%20world&token=~abc&utm_source=test#fragment'
    const cleanedUrl = 'http://site.ton/path?value=hello%20world&token=~abc#fragment'

    const getCallback = vi.fn()
    listeners.onBeforeRequest?.({ url, method: 'GET', resourceType: 'mainFrame' }, getCallback)
    expect(getCallback).toHaveBeenCalledWith({ redirectURL: cleanedUrl })

    const postCallback = vi.fn()
    listeners.onBeforeRequest?.({ url, method: 'POST', resourceType: 'mainFrame' }, postCallback)
    expect(postCallback).toHaveBeenCalledWith({})

    const scriptCallback = vi.fn()
    listeners.onBeforeRequest?.({ url, method: 'GET', resourceType: 'script' }, scriptCallback)
    expect(scriptCallback).toHaveBeenCalledWith({})
  })
})
