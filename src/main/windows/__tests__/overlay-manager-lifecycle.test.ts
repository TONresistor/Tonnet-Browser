import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ views: [] as Array<{ webContents: { close: ReturnType<typeof vi.fn> } }> }))

vi.mock('electron', () => {
  class WebContentsView {
    webContents = {
      loadURL: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      send: vi.fn(),
      focus: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    setBackgroundColor = vi.fn()
    setBounds = vi.fn()

    constructor() {
      state.views.push(this)
    }
  }
  return { BrowserWindow: class {}, WebContentsView }
})

import { OverlayManager } from '../overlay-manager'

class WindowMock extends EventEmitter {
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  webContents = { send: vi.fn() }
}

describe('OverlayManager window lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.views.length = 0
  })

  it('replaces the pool and ignores stale window detaches', () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new OverlayManager()

    manager.attachWindow(firstWindow as never)
    manager.show('menu', { x: 0, y: 0, width: 10, height: 10 }, { type: 'menu' })
    const firstViews = [...state.views]

    manager.attachWindow(secondWindow as never)
    const secondViews = state.views.slice(2)

    expect(firstViews).toHaveLength(2)
    expect(secondViews).toHaveLength(2)
    expect(firstViews.every((view) => view.webContents.close.mock.calls.length === 1)).toBe(true)
    expect(firstWindow.listenerCount('resize')).toBe(0)
    expect(secondWindow.listenerCount('resize')).toBe(1)

    manager.detachWindow(firstWindow as never)
    expect(secondWindow.listenerCount('resize')).toBe(1)
    expect(secondViews.every((view) => view.webContents.close.mock.calls.length === 0)).toBe(true)

    manager.detachWindow(secondWindow as never)
    manager.detachWindow(secondWindow as never)

    expect(secondWindow.listenerCount('resize')).toBe(0)
    expect(secondViews.every((view) => view.webContents.close.mock.calls.length === 1)).toBe(true)
  })
})
