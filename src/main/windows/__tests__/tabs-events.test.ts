import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  emitContractToRenderer: vi.fn(),
  extractFavicon: vi.fn(() => Promise.resolve(null)),
  loadStorageBrowser: vi.fn(() => Promise.resolve()),
  loadErrorPage: vi.fn(),
}))

vi.mock('electron', () => ({ WebContentsView: class {}, clipboard: { writeText: vi.fn() } }))
vi.mock('../../events/renderer-events', () => ({ emitContractToRenderer: mocks.emitContractToRenderer }))
vi.mock('../browser-view', () => ({ extractFavicon: mocks.extractFavicon }))
vi.mock('../tabs-storage', () => ({
  loadStorageBrowser: mocks.loadStorageBrowser,
  loadErrorPage: mocks.loadErrorPage,
}))
vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), event: vi.fn() }),
}))

import { setupViewEventListeners } from '../tabs-events'

function createHarness() {
  const webContents = Object.assign(new EventEmitter(), {
    navigationHistory: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
    },
    getTitle: vi.fn(() => 'Whitepaper'),
    getURL: vi.fn(() => 'http://whitepaper.ton'),
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    openDevTools: vi.fn(),
    inspectElement: vi.fn(),
  })
  const historyManager = { addEntry: vi.fn() }
  const overlayManager = { show: vi.fn(), hide: vi.fn() }
  const listeners = setupViewEventListeners(
    { webContents, getBounds: () => ({ x: 0, y: 80, width: 1200, height: 800 }) } as never,
    'tab-1',
    {
      historyManager: historyManager as never,
      overlayManager: overlayManager as never,
      storage: {} as never,
      cancelNavigation: vi.fn(),
      handleZoomInput: vi.fn(() => false),
    }
  )
  return { historyManager, listeners, overlayManager, webContents }
}

describe('tab navigation events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.emitContractToRenderer.mockImplementation(
      (contract: { payload: { parse(args: unknown[]): unknown } }, ...args: unknown[]) => contract.payload.parse(args)
    )
  })

  it('does not expose an oversized internal data page as the tab URL', () => {
    const { historyManager, listeners, webContents } = createHarness()
    const internalUrl = `data:text/html;charset=utf-8,${'x'.repeat(20_000)}`

    expect(() => webContents.emit('did-navigate', {}, internalUrl)).not.toThrow()
    expect(mocks.emitContractToRenderer).not.toHaveBeenCalled()
    expect(historyManager.addEntry).not.toHaveBeenCalled()

    listeners.dispose()
  })

  it('does not expose a local storage file path as the tab URL', () => {
    const { historyManager, listeners, webContents } = createHarness()

    webContents.emit('did-navigate', {}, 'file:///Users/example/TON_Technical_Whitepaper.pdf')

    expect(mocks.emitContractToRenderer).not.toHaveBeenCalled()
    expect(historyManager.addEntry).not.toHaveBeenCalled()

    listeners.dispose()
  })

  it('still publishes ordinary page navigations', () => {
    const { historyManager, listeners, webContents } = createHarness()

    webContents.emit('did-navigate', {}, 'http://whitepaper.ton')

    expect(mocks.emitContractToRenderer).toHaveBeenCalledOnce()
    expect(historyManager.addEntry).toHaveBeenCalledWith('http://whitepaper.ton', 'Whitepaper')

    listeners.dispose()
  })
})

describe('DevTools access from a focused page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles the shortcut the main window no longer sees, and nothing else', () => {
    const { listeners, webContents } = createHarness()
    const shortcut = { preventDefault: vi.fn() }
    const typing = { preventDefault: vi.fn() }
    const input = { type: 'keyDown', key: 'i', code: 'KeyI', control: true, shift: true, alt: false, meta: false }

    webContents.emit('before-input-event', shortcut, input)
    webContents.emit('before-input-event', typing, { ...input, control: false, shift: false })

    expect(shortcut.preventDefault).toHaveBeenCalled()
    expect(webContents.openDevTools).toHaveBeenCalledExactlyOnceWith({ mode: 'detach' })
    expect(typing.preventDefault).not.toHaveBeenCalled()

    listeners.dispose()
  })

  it('inspects the element the context menu was opened on', () => {
    const { listeners, overlayManager, webContents } = createHarness()

    webContents.emit('context-menu', {}, { x: 120, y: 240, editFlags: {} })
    const [, , content, onAction] = overlayManager.show.mock.calls[0]
    const inspect = content.items.find((item: { id: string }) => item.id === 'inspect')
    onAction('inspect', inspect.data)
    webContents.emit('devtools-opened')

    expect(webContents.inspectElement).toHaveBeenCalledWith(120, 240)

    listeners.dispose()
  })
})
