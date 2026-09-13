import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContentsView } from 'electron'
import { attachActiveView } from '../tabs-attach'

vi.mock('../tabs-bounds', () => ({ updateViewBounds: vi.fn() }))

function fixture() {
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const view = { webContents } as unknown as WebContentsView
  let current = true
  const window = {
    contentView: { children: [] as unknown[], addChildView: vi.fn(), removeChildView: vi.fn() },
  }
  const manager = {
    window: window as never,
    sidebarWidth: 0,
    views: { activeViewId: 'tab', get: () => view },
    ownsWindowGeneration: () => true,
    captureNavigation: () => () => current,
  }
  return {
    manager,
    view,
    webContents,
    window,
    supersede: () => {
      current = false
    },
  }
}

describe('navigation attachment', () => {
  it('attaches the view immediately instead of waiting for dom-ready', () => {
    const { manager, view, window } = fixture()
    attachActiveView(manager, view, 'tab', 1)
    expect(window.contentView.addChildView).toHaveBeenCalledOnce()
    expect(window.contentView.addChildView).toHaveBeenCalledWith(view)
  })

  it('does not attach a superseded navigation', () => {
    const { manager, view, window, supersede } = fixture()
    supersede()
    attachActiveView(manager, view, 'tab', 1)
    expect(window.contentView.addChildView).not.toHaveBeenCalled()
  })
})
