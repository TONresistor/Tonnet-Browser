import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadErrorPage: vi.fn(),
  emitContractToRenderer: vi.fn(),
}))

vi.mock('electron', () => ({ WebContentsView: class {} }))
vi.mock('../tabs-storage', () => ({ loadErrorPage: mocks.loadErrorPage }))
vi.mock('../../events/renderer-events', () => ({ emitContractToRenderer: mocks.emitContractToRenderer }))
vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    event: vi.fn(),
  }),
}))

import { setupSecurityHandlers } from '../tabs-security'
import { BrowserUrlSchema } from '../../../shared/ipc-contract/browsing'

function createView(currentUrl = 'http://first.ton') {
  const webContents = Object.assign(new EventEmitter(), {
    getURL: vi.fn(() => currentUrl),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    setWindowOpenHandler: vi.fn(),
  })
  return { webContents }
}

function emitNavigation(
  view: ReturnType<typeof createView>,
  eventName: 'will-navigate' | 'will-redirect',
  url: string,
  overrides: Partial<{ isMainFrame: boolean; isSameDocument: boolean }> = {}
) {
  const preventDefault = vi.fn()
  const details = {
    url,
    isMainFrame: true,
    isSameDocument: false,
    frame: null,
    defaultPrevented: false,
    preventDefault,
    ...overrides,
  }
  view.webContents.emit(eventName, details, url, details.isSameDocument, details.isMainFrame, 1, 1)
  return { details, preventDefault }
}

describe('tab navigation security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cancels and hands off a main-frame cross-domain navigation', () => {
    const view = createView()
    const handoff = vi.fn(() => true)
    setupSecurityHandlers(view as never, 'tab-1', handoff)

    const { preventDefault } = emitNavigation(view, 'will-navigate', 'http://second.ton/page')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(handoff).toHaveBeenCalledWith('http://second.ton/page')
    expect(view.webContents.loadURL).not.toHaveBeenCalled()
  })

  it('allows a main-frame same-domain navigation', () => {
    const view = createView()
    const handoff = vi.fn(() => false)
    setupSecurityHandlers(view as never, 'tab-1', handoff)

    const { preventDefault } = emitNavigation(view, 'will-navigate', 'http://first.ton/page')

    expect(preventDefault).not.toHaveBeenCalled()
    expect(handoff).toHaveBeenCalledWith('http://first.ton/page')
  })

  it('normalizes before handing off a navigation', () => {
    const view = createView()
    const handoff = vi.fn(() => true)
    setupSecurityHandlers(view as never, 'tab-1', handoff)

    const { preventDefault } = emitNavigation(view, 'will-navigate', 'https://second.ton/page')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(handoff).toHaveBeenCalledWith('http://second.ton/page')
    expect(view.webContents.loadURL).not.toHaveBeenCalled()
  })

  it('cancels and hands off a main-frame cross-domain redirect', () => {
    const view = createView()
    const handoff = vi.fn(() => true)
    setupSecurityHandlers(view as never, 'tab-1', handoff)

    const { preventDefault } = emitNavigation(view, 'will-redirect', 'http://second.ton/final')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(handoff).toHaveBeenCalledWith('http://second.ton/final')
  })

  it('ignores subframe redirects for top-level handoff', () => {
    const view = createView()
    const handoff = vi.fn(() => true)
    setupSecurityHandlers(view as never, 'tab-1', handoff)

    const { preventDefault } = emitNavigation(view, 'will-redirect', 'http://second.ton/frame', {
      isMainFrame: false,
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(handoff).not.toHaveBeenCalled()
  })

  it('blocks redirects to unsafe schemes', () => {
    const view = createView()
    const handoff = vi.fn(() => false)
    setupSecurityHandlers(view as never, 'tab-1', handoff)

    const { preventDefault } = emitNavigation(view, 'will-redirect', 'file:///etc/passwd')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(handoff).not.toHaveBeenCalled()
  })

  it('blocks a navigation that exceeds the renderer URL contract', () => {
    const view = createView()
    const handoff = vi.fn(() => true)
    setupSecurityHandlers(view as never, 'tab-1', handoff)
    const prefix = 'http://second.ton/'
    const url = prefix + 'x'.repeat(16_385 - prefix.length)

    const { preventDefault } = emitNavigation(view, 'will-navigate', url)

    expect(BrowserUrlSchema.safeParse(url).success).toBe(false)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(handoff).not.toHaveBeenCalled()
  })
})
