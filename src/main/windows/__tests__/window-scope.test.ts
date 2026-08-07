import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const contextMenuDispose = vi.fn()

vi.mock('../main-context-menu', () => ({
  setupMainContextMenu: vi.fn(() => ({ dispose: contextMenuDispose })),
}))

import { attachWindowScope } from '../window-scope'

class WindowMock extends EventEmitter {}

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
    }
    contextMenuDispose.mockImplementation(() => order.push('menu'))

    const scope = attachWindowScope(window as never, 8080, {
      overlayManager: overlayManager as never,
      tabManager: tabManager as never,
      tabDeps: {} as never,
    })

    expect(overlayManager.attachWindow).toHaveBeenCalledWith(window)
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
    const tabManager = { attachWindow: vi.fn(), detachWindow: vi.fn() }
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
})
