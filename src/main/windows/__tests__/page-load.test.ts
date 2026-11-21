import type { WebContentsView } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadViewUrlBounded, PAGE_LOAD_TIMEOUT_MS } from '../page-load'

interface StubView {
  view: WebContentsView
  stop: ReturnType<typeof vi.fn>
}

function stubView(loadURL: (url: string) => Promise<void>): StubView {
  const stop = vi.fn()
  const view = {
    webContents: {
      loadURL,
      stop,
      isDestroyed: () => false,
    },
  }
  return { view: view as unknown as WebContentsView, stop }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('loadViewUrlBounded', () => {
  it('reports nothing when the load settles', async () => {
    vi.useFakeTimers()
    const { view } = stubView(() => Promise.resolve())
    const onFailure = vi.fn()

    loadViewUrlBounded(view, 'http://site.ton/', { isCurrent: () => true, onFailure })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS * 2)

    expect(onFailure).not.toHaveBeenCalled()
  })

  it('turns a load that never settles into a timeout failure', async () => {
    vi.useFakeTimers()
    const { view, stop } = stubView(() => new Promise<void>(() => undefined))
    const onFailure = vi.fn()

    loadViewUrlBounded(view, 'http://example.com/', { isCurrent: () => true, onFailure })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS)

    expect(stop).toHaveBeenCalledOnce()
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0][1]).toBe(true)
  })

  it('ignores the deadline once another navigation superseded the load', async () => {
    vi.useFakeTimers()
    const { view, stop } = stubView(() => new Promise<void>(() => undefined))
    const onFailure = vi.fn()

    loadViewUrlBounded(view, 'http://example.com/', { isCurrent: () => false, onFailure })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS)

    expect(stop).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('forwards an early load rejection without waiting for the deadline', async () => {
    vi.useFakeTimers()
    const { view } = stubView(() => Promise.reject(new Error('ERR_CONNECTION_REFUSED')))
    const onFailure = vi.fn()

    loadViewUrlBounded(view, 'http://example.com/', { isCurrent: () => true, onFailure })
    await vi.advanceTimersByTimeAsync(0)

    expect(onFailure).toHaveBeenCalledOnce()
    expect(onFailure.mock.calls[0][1]).toBe(false)
  })
})
