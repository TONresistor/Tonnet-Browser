import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sessions, createBrowserView, extractDomain, initStorageListener, firstStorageDispose, secondStorageDispose } =
  vi.hoisted(() => ({
    sessions: {
      initialize: vi.fn(),
      detachWindow: vi.fn(),
      dispose: vi.fn(),
      updateProxyPort: vi.fn(() => Promise.resolve()),
      getSessionForDomain: vi.fn(),
      updateDomainActivity: vi.fn(),
      setTabDomain: vi.fn(),
      getTabDomain: vi.fn(),
      cleanupDomainForTab: vi.fn(),
      getAllSessions: vi.fn(() => []),
      onPrivacySettingsChanged: vi.fn(),
    },
    createBrowserView: vi.fn(),
    extractDomain: vi.fn((url: string) => new URL(url).hostname),
    initStorageListener: vi.fn(),
    firstStorageDispose: vi.fn(),
    secondStorageDispose: vi.fn(),
  }))

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
}))
vi.mock('../browser-view', () => ({ createBrowserView }))
vi.mock('../tabs-session', () => ({
  extractDomain,
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
vi.mock('../tabs-security', () => ({
  setupSecurityHandlers: vi.fn(() => ({ dispose: vi.fn() })),
  ALLOWED_SCHEMES: ['http:', 'https:'],
}))
vi.mock('../tabs-events', () => ({ setupViewEventListeners: vi.fn(() => ({ dispose: vi.fn() })) }))
vi.mock('../../events/renderer-events', () => ({ emitContractToRenderer: vi.fn() }))

import { TabManager } from '../tabs'
import { DisposableStore } from '../../utils/disposable'

class WindowMock extends EventEmitter {
  contentView = {
    children: [] as unknown[],
    addChildView: vi.fn((view: unknown) => this.contentView.children.push(view)),
    removeChildView: vi.fn((view: unknown) => {
      this.contentView.children = this.contentView.children.filter((candidate) => candidate !== view)
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createView(id: number) {
  const webContents = Object.assign(new EventEmitter(), {
    id,
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(() => Promise.resolve()),
  })
  return { webContents }
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
    sessions.getTabDomain.mockReturnValue(undefined)
    sessions.getSessionForDomain.mockResolvedValue({})
    createBrowserView.mockImplementation(() => createView(1))
    initStorageListener
      .mockReturnValueOnce({ dispose: firstStorageDispose })
      .mockReturnValueOnce({ dispose: secondStorageDispose })
  })

  it('reattaches without retaining views or listeners from the previous window', () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new TabManager()
    const close = vi.fn()

    manager.attachWindow(firstWindow as never, 8080, deps)
    manager.views.add('first-tab', { webContents: { close, id: 1 } } as never, new DisposableStore())
    expect(firstWindow.listenerCount('resize')).toBe(1)

    manager.attachWindow(secondWindow as never, 8081, deps)
    expect(firstWindow.listenerCount('resize')).toBe(0)
    expect(secondWindow.listenerCount('resize')).toBe(1)
    expect(firstStorageDispose).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(manager.views.size).toBe(0)
    expect(manager.port).toBe(8081)

    manager.detachWindow(firstWindow as never)
    expect(manager.window).toBe(secondWindow)

    manager.detachWindow(secondWindow as never)
    expect(secondWindow.listenerCount('resize')).toBe(0)
    expect(secondStorageDispose).toHaveBeenCalledOnce()
    expect(manager.window).toBeNull()
  })

  it('keeps attach and detach idempotent and supports a fresh window', () => {
    const window = new WindowMock()
    const nextWindow = new WindowMock()
    const manager = new TabManager()
    manager.attachWindow(window as never, 8080, deps)
    manager.detachWindow(window as never)
    manager.detachWindow(window as never)
    manager.attachWindow(nextWindow as never, 8081, deps)

    expect(window.listenerCount('resize')).toBe(0)
    expect(nextWindow.listenerCount('resize')).toBe(1)
    expect(sessions.initialize).toHaveBeenCalledTimes(2)
    expect(sessions.detachWindow).toHaveBeenCalledOnce()
    expect(sessions.dispose).not.toHaveBeenCalled()
  })

  it('does not create a tab in a replacement window after deferred session creation', async () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new TabManager()
    const session = deferred<object>()
    sessions.getSessionForDomain.mockReturnValueOnce(session.promise)

    manager.attachWindow(firstWindow as never, 8080, deps)
    const creation = manager.createTab('tab-1', 'http://first.ton')
    manager.detachWindow(firstWindow as never)
    manager.attachWindow(secondWindow as never, 8080, deps)
    session.resolve({})

    await expect(creation).resolves.toBe(false)
    expect(createBrowserView).not.toHaveBeenCalled()
    expect(manager.views.size).toBe(0)
    expect(secondWindow.contentView.addChildView).not.toHaveBeenCalled()
  })

  it('does not complete a deferred domain navigation in a replacement window', async () => {
    const firstWindow = new WindowMock()
    const secondWindow = new WindowMock()
    const manager = new TabManager()
    const oldView = createView(1)
    const session = deferred<object>()
    sessions.getTabDomain.mockReturnValue('first.ton')
    sessions.getSessionForDomain.mockReturnValueOnce(session.promise)

    manager.attachWindow(firstWindow as never, 8080, deps)
    manager.views.add('tab-1', oldView as never, new DisposableStore())
    manager.views.activate('tab-1')
    const navigation = manager.navigateInTab('tab-1', 'http://second.ton')
    manager.detachWindow(firstWindow as never)
    manager.attachWindow(secondWindow as never, 8080, deps)
    session.resolve({})

    await expect(navigation).resolves.toBe(false)
    expect(createBrowserView).not.toHaveBeenCalled()
    expect(manager.views.size).toBe(0)
    expect(secondWindow.contentView.addChildView).not.toHaveBeenCalled()
  })

  it('updates the runtime proxy port without reattaching or destroying the window', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const view = createView(1)

    manager.attachWindow(window as never, 8080, deps)
    manager.views.add('tab-1', view as never, new DisposableStore())

    await manager.updateProxyPort(9090)

    expect(manager.port).toBe(9090)
    expect(sessions.updateProxyPort).toHaveBeenCalledWith(9090)
    expect(manager.window).toBe(window)
    expect(window.listenerCount('resize')).toBe(1)
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(firstStorageDispose).not.toHaveBeenCalled()
  })

  it('does not release a session while its proxy port update is pending', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    const session = deferred<object>()
    const portUpdate = deferred<void>()
    sessions.getSessionForDomain.mockReturnValueOnce(session.promise)
    sessions.updateProxyPort.mockReturnValueOnce(portUpdate.promise)
    manager.attachWindow(window as never, 8080, deps)

    const pendingSession = manager.getSessionForDomain('first.ton')
    await vi.waitFor(() => expect(sessions.getSessionForDomain).toHaveBeenCalledOnce())
    const firstUpdate = manager.updateProxyPort(9090)
    const sharedUpdate = manager.updateProxyPort(9090)
    session.resolve({})
    await vi.waitFor(() => expect(sessions.updateProxyPort).toHaveBeenCalledWith(9090))

    let released = false
    void pendingSession.then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)
    expect(sharedUpdate).toBe(firstUpdate)

    portUpdate.resolve()
    await firstUpdate
    await expect(pendingSession).resolves.toEqual({})
  })

  it('propagates a proxy port update failure and allows a retry', async () => {
    const window = new WindowMock()
    const manager = new TabManager()
    sessions.updateProxyPort.mockRejectedValueOnce(new Error('proxy update failed'))
    manager.attachWindow(window as never, 8080, deps)

    await expect(manager.updateProxyPort(9090)).rejects.toThrow('proxy update failed')
    await expect(manager.updateProxyPort(9090)).resolves.toBeUndefined()

    expect(sessions.updateProxyPort).toHaveBeenCalledTimes(2)
  })
})
