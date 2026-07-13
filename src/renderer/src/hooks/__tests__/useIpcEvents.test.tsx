import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  updateTab: vi.fn(),
  setNavigation: vi.fn(),
  setLoading: vi.fn(),
  setTitle: vi.fn(),
  state: {
    tabs: [
      {
        id: 'tab-1',
        url: 'http://first.ton',
        history: ['http://first.ton'],
        historyIndex: 0,
      },
    ],
    activeTabId: 'tab-1' as string | null,
    updateTab: vi.fn(),
  },
}))

vi.mock('@/stores/browser', () => ({
  useBrowserStore: {
    getState: () => ({
      setNavigation: mocks.setNavigation,
      setLoading: mocks.setLoading,
      setTitle: mocks.setTitle,
    }),
  },
}))

vi.mock('@/stores/tabs', () => ({
  useTabsStore: {
    getState: () => mocks.state,
  },
}))

vi.mock('@/features/browser/client', () => ({
  browserClient: {
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      mocks.listeners.set(channel, listener)
      return () => mocks.listeners.delete(channel)
    }),
  },
}))

import { useIpcEvents } from '../useIpcEvents'

let unmount: (() => Promise<void>) | undefined

describe('useIpcEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
    mocks.state.activeTabId = 'tab-1'
    const browser = new Window({ url: 'http://localhost' })
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', browser.document)
    vi.stubGlobal('navigator', browser.navigator)
    vi.stubGlobal('Node', browser.Node)
    vi.stubGlobal('Element', browser.Element)
    vi.stubGlobal('HTMLElement', browser.HTMLElement)
    vi.stubGlobal('Event', browser.Event)
    vi.stubGlobal('MutationObserver', browser.MutationObserver)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(async () => {
    await unmount?.()
    unmount = undefined
    vi.unstubAllGlobals()
  })

  it('resets an active tab to the target URL', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const Harness = () => {
      useIpcEvents(mocks.updateTab as never)
      return null
    }
    await act(async () => root.render(React.createElement(Harness)))
    unmount = async () => {
      await act(async () => root.unmount())
      container.remove()
    }

    await act(async () => mocks.listeners.get('tab:history-reset')?.('tab-1', 'http://second.ton/page'))

    expect(mocks.state.updateTab).toHaveBeenCalledWith('tab-1', {
      url: 'http://second.ton/page',
      history: ['http://second.ton/page'],
      historyIndex: 0,
      canGoBack: false,
      canGoForward: false,
    })
    expect(mocks.setNavigation).toHaveBeenCalledWith('http://second.ton/page', false, false)
  })
})
