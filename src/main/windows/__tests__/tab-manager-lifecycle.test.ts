import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessions, initStorageListener, firstStorageDispose, secondStorageDispose } = vi.hoisted(() => ({
  sessions: {
    initialize: vi.fn(),
    dispose: vi.fn(),
    getSessionForDomain: vi.fn(),
    updateDomainActivity: vi.fn(),
    setTabDomain: vi.fn(),
    getTabDomain: vi.fn(),
    cleanupDomainForTab: vi.fn(),
    getAllSessions: vi.fn(() => []),
    onPrivacySettingsChanged: vi.fn(),
  },
  initStorageListener: vi.fn(),
  firstStorageDispose: vi.fn(),
  secondStorageDispose: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
}))
vi.mock('../browser-view', () => ({ createBrowserView: vi.fn() }))
vi.mock('../tabs-session', () => ({
  extractDomain: vi.fn(),
  TabSessionManager: vi.fn(function () {
    return sessions
  }),
}))
vi.mock('../tabs-storage', () => ({
  loadStorageBag: vi.fn(),
  loadErrorPage: vi.fn(),
  createTabStorageState: vi.fn(() => ({
    storageManager: null,
    storageBagCache: new Map(),
    storageBrowserLoading: new Set(),
    fileBrowserCache: new Map(),
  })),
  disposeTabStorageState: vi.fn(),
  initStorageListener,
  resolveBagFilePath: vi.fn(),
}))
vi.mock('../tabs-bounds', () => ({
  updateViewBounds: vi.fn(),
  updateSidebarBounds: vi.fn(),
  invalidateAppearanceCache: vi.fn(),
}))
vi.mock('../tabs-security', () => ({ setupSecurityHandlers: vi.fn(), ALLOWED_SCHEMES: ['http:', 'https:'] }))
vi.mock('../tabs-events', () => ({ setupViewEventListeners: vi.fn() }))
vi.mock('../../events/renderer-events', () => ({ emitToRenderer: vi.fn() }))

import { TabManager } from '../tabs'

class WindowMock extends EventEmitter {
  contentView = { children: [], addChildView: vi.fn(), removeChildView: vi.fn() }
}

const deps = {
  overlayManager: { hideAll: vi.fn() },
  proxyManager: {},
  storageManager: {},
  historyManager: {},
  contentFilterManager: {},
  paymentInterceptor: {},
} as never

describe('TabManager lifecycle ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initStorageListener
      .mockReturnValueOnce({ dispose: firstStorageDispose })
      .mockReturnValueOnce({ dispose: secondStorageDispose })
  })

  it('reinitializes without accumulating window or storage listeners', () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new TabManager()

    manager.initialize(firstWindow as never, 8080, deps)
    expect(firstWindow.listenerCount('resize')).toBe(1)

    manager.initialize(secondWindow as never, 8081, deps)
    expect(firstWindow.listenerCount('resize')).toBe(0)
    expect(secondWindow.listenerCount('resize')).toBe(1)
    expect(firstStorageDispose).toHaveBeenCalledOnce()
    expect(manager.port).toBe(8081)

    manager.dispose()
    expect(secondWindow.listenerCount('resize')).toBe(0)
    expect(secondStorageDispose).toHaveBeenCalledOnce()
    expect(manager.window).toBeNull()
  })

  it('keeps initialize and dispose idempotent when no views exist', () => {
    const window = new WindowMock()
    const manager = new TabManager()
    manager.initialize(window as never, 8080, deps)
    manager.dispose()
    manager.dispose()

    expect(window.listenerCount('resize')).toBe(0)
    expect(sessions.initialize).toHaveBeenCalledOnce()
    expect(sessions.dispose).toHaveBeenCalledTimes(2)
  })
})
