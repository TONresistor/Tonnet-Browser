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
    closeDevTools: vi.fn(),
  })
  const historyManager = { addEntry: vi.fn() }
  const handleZoomInput = vi.fn(() => false)
  const listeners = setupViewEventListeners({ webContents } as never, 'tab-1', {
    historyManager: historyManager as never,
    overlayManager: {} as never,
    storage: {} as never,
    cancelNavigation: vi.fn(),
    handleZoomInput,
  })
  return { handleZoomInput, historyManager, listeners, webContents }
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

describe('tab DevTools shortcuts', () => {
  it('toggles the focused page DevTools once', () => {
    const { listeners, webContents } = createHarness()
    const event = { preventDefault: vi.fn() }
    const input = {
      type: 'keyDown',
      key: 'i',
      code: 'KeyI',
      isAutoRepeat: false,
      isComposing: false,
      control: true,
      shift: true,
      alt: false,
      meta: false,
      location: 0,
      modifiers: [],
    }

    webContents.emit('before-input-event', event, input)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(webContents.openDevTools).toHaveBeenCalledExactlyOnceWith({ mode: 'detach' })
    listeners.dispose()
  })

  it('gives zoom handling priority over DevTools', () => {
    const { handleZoomInput, listeners, webContents } = createHarness()
    handleZoomInput.mockReturnValue(true)
    const event = { preventDefault: vi.fn() }

    webContents.emit('before-input-event', event, {
      type: 'keyDown',
      key: 'F12',
      code: 'F12',
      isAutoRepeat: false,
      isComposing: false,
      control: false,
      shift: false,
      alt: false,
      meta: false,
      location: 0,
      modifiers: [],
    })

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(webContents.openDevTools).not.toHaveBeenCalled()
    listeners.dispose()
  })
})
