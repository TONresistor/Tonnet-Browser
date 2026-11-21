import type { WebContentsView } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { armLoadWatchdog, loadUrlReportingFailure } from '../page-load'
import { PAGE_LOAD_TIMEOUT_MS } from '../constants'

interface StubView {
  view: WebContentsView
  stop: ReturnType<typeof vi.fn>
  setLoading: (loading: boolean) => void
}

function stubView(options: {
  loadURL?: (url: string) => Promise<void>
  loading?: boolean
  destroyed?: boolean
}): StubView {
  const stop = vi.fn()
  let loading = options.loading ?? true
  const webContents = {
    loadURL: options.loadURL ?? (() => Promise.resolve()),
    stop,
    isLoading: () => loading,
    isDestroyed: () => options.destroyed ?? false,
  }
  return {
    view: { webContents } as unknown as WebContentsView,
    stop,
    setLoading: (next: boolean) => {
      loading = next
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('loadUrlReportingFailure', () => {
  it('forwards an early rejection without waiting', async () => {
    vi.useFakeTimers()
    const { view } = stubView({ loadURL: () => Promise.reject(new Error('ERR_CONNECTION_REFUSED')) })
    const onFailure = vi.fn()

    loadUrlReportingFailure(view, 'http://example.com/', onFailure)
    await vi.advanceTimersByTimeAsync(0)

    expect(onFailure).toHaveBeenCalledOnce()
    expect((onFailure.mock.calls[0][0] as Error).message).toBe('ERR_CONNECTION_REFUSED')
  })

  it('reports nothing when the load commits', async () => {
    vi.useFakeTimers()
    const { view } = stubView({})
    const onFailure = vi.fn()

    loadUrlReportingFailure(view, 'http://site.ton/', onFailure)
    await vi.advanceTimersByTimeAsync(0)

    expect(onFailure).not.toHaveBeenCalled()
  })
})

describe('armLoadWatchdog', () => {
  it('fires only after the deadline while the view is still loading', async () => {
    vi.useFakeTimers()
    const { view, stop } = stubView({})
    const onTimeout = vi.fn()

    armLoadWatchdog(view, onTimeout)
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS - 1)
    expect(onTimeout).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(stop).not.toHaveBeenCalled()
  })

  it('stays silent when the page finished before the deadline', async () => {
    vi.useFakeTimers()
    const { view, setLoading } = stubView({})
    const onTimeout = vi.fn()

    armLoadWatchdog(view, onTimeout)
    setLoading(false)
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS)

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('can be disarmed by its cancel function', async () => {
    vi.useFakeTimers()
    const { view } = stubView({})
    const onTimeout = vi.fn()

    const cancel = armLoadWatchdog(view, onTimeout)
    cancel()
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS)

    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('does not fire for a destroyed view', async () => {
    vi.useFakeTimers()
    const { view } = stubView({ destroyed: true })
    const onTimeout = vi.fn()

    armLoadWatchdog(view, onTimeout)
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_TIMEOUT_MS)

    expect(onTimeout).not.toHaveBeenCalled()
  })
})
