import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const contextMenuDispose = vi.fn()

vi.mock('../main-context-menu', () => ({
  setupMainContextMenu: vi.fn(() => ({ dispose: contextMenuDispose })),
}))

import { attachWindowScope } from '../window-scope'

class WindowMock extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn(),
  })
  contentView = { children: [] as unknown[] }
}

describe('window scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('attaches and disposes only window-owned resources', () => {
    const order: string[] = []
    const window = new WindowMock()
    const overlayManager = {
      attachWindow: vi.fn(),
      detachWindow: vi.fn(() => order.push('overlay')),
    }
    const tabManager = {
      attachWindow: vi.fn(),
      detachWindow: vi.fn(() => order.push('tabs')),
      getActiveView: vi.fn(() => null),
      pageZoom: { handleInput: vi.fn(() => false) },
    }
    contextMenuDispose.mockImplementation(() => order.push('menu'))

    const scope = attachWindowScope(window as never, 8080, {
      overlayManager: overlayManager as never,
      tabManager: tabManager as never,
      tabDeps: {} as never,
    })

    expect(overlayManager.attachWindow).toHaveBeenCalledWith(window, expect.any(Function))
    expect(tabManager.attachWindow).toHaveBeenCalledWith(window, 8080, {})
    expect(window.listenerCount('closed')).toBe(1)

    window.emit('closed')
    scope.dispose()

    expect(order).toEqual(['tabs', 'overlay', 'menu'])
    expect(window.listenerCount('closed')).toBe(0)
  })

  it('can attach a fresh window after the previous scope closes', () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const overlayManager = { attachWindow: vi.fn(), detachWindow: vi.fn() }
    const tabManager = {
      attachWindow: vi.fn(),
      detachWindow: vi.fn(),
      getActiveView: vi.fn(() => null),
      pageZoom: { handleInput: vi.fn(() => false) },
    }
    const deps = {
      overlayManager: overlayManager as never,
      tabManager: tabManager as never,
      tabDeps: {} as never,
    }

    const firstScope = attachWindowScope(firstWindow as never, 8080, deps)
    firstWindow.emit('closed')
    const secondScope = attachWindowScope(secondWindow as never, 9090, deps)

    expect(tabManager.attachWindow).toHaveBeenNthCalledWith(2, secondWindow, 9090, {})
    expect(firstWindow.listenerCount('closed')).toBe(0)
    expect(secondWindow.listenerCount('closed')).toBe(1)

    firstScope.dispose()
    secondScope.dispose()
    expect(tabManager.detachWindow).toHaveBeenCalledTimes(2)
    expect(overlayManager.detachWindow).toHaveBeenCalledTimes(2)
  })

  it('routes chrome and overlay input to the visible target and disposes the chrome listener', () => {
    const window = new WindowMock()
    const tabContents = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      openDevTools: vi.fn(),
      closeDevTools: vi.fn(),
    })
    const view = { webContents: tabContents }
    window.contentView.children = [view]
    const overlayManager = { attachWindow: vi.fn(), detachWindow: vi.fn() }
    const tabManager = {
      attachWindow: vi.fn(),
      detachWindow: vi.fn(),
      getActiveView: vi.fn(() => view),
      pageZoom: { handleInput: vi.fn(() => false) },
    }
    const scope = attachWindowScope(window as never, 8080, {
      overlayManager: overlayManager as never,
      tabManager: tabManager as never,
      tabDeps: {} as never,
    })
    const overlayInput = overlayManager.attachWindow.mock.calls[0]?.[1] as
      | ((event: Electron.Event, input: Electron.Input) => void)
      | undefined
    const input = {
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
    } as Electron.Input

    window.webContents.emit('before-input-event', { preventDefault: vi.fn() }, input)
    expect(tabContents.openDevTools).toHaveBeenCalledOnce()

    window.contentView.children = []
    overlayInput?.({ preventDefault: vi.fn() } as never, input)
    expect(window.webContents.openDevTools).toHaveBeenCalledOnce()

    expect(window.webContents.listenerCount('before-input-event')).toBe(1)
    scope.dispose()
    expect(window.webContents.listenerCount('before-input-event')).toBe(0)
  })
})
