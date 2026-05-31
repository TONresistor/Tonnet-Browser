/**
 * Hook for IPC events from main process.
 * Navigation state, loading, title, favicon, context menu, history reset.
 */

import { useEffect } from 'react'
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore } from '@/stores/tabs'
import { IPC_CHANNELS } from '@shared/ipc-channels'

export function useIpcEvents(updateTab: ReturnType<typeof useTabsStore.getState>['updateTab']): void {
  useEffect(() => {
    const { setNavigation, setLoading, setTitle } = useBrowserStore.getState()

    const unsubNavigate = window.electron.on(IPC_CHANNELS.PAGE_NAVIGATE, (...args: unknown[]) => {
      const data = args[0] as { tabId?: string; url: string; canGoBack: boolean; canGoForward: boolean }
      setNavigation(data.url, data.canGoBack, data.canGoForward)
      // Update tab state + push to history for bag file navigation
      if (data.tabId) {
        const tab = useTabsStore.getState().tabs.find((t) => t.id === data.tabId)
        if (tab && data.url !== tab.url && data.url.startsWith('file:///') && data.url.includes('/storage/')) {
          const newHistory = tab.history.slice(0, tab.historyIndex + 1)
          newHistory.push(data.url)
          updateTab(data.tabId, {
            url: data.url,
            canGoBack: true,
            canGoForward: false,
            history: newHistory,
            historyIndex: newHistory.length - 1,
          })
        } else {
          updateTab(data.tabId, { url: data.url, canGoBack: data.canGoBack, canGoForward: data.canGoForward })
        }
      }
    })

    const unsubLoading = window.electron.on(IPC_CHANNELS.PAGE_LOADING, (...args: unknown[]) => {
      const loading = args[0] as boolean
      const tabId = args[1] as string | undefined
      setLoading(loading)
      if (tabId) {
        updateTab(tabId, { isLoading: loading })
      }
    })

    const unsubTitle = window.electron.on(IPC_CHANNELS.PAGE_TITLE, (...args: unknown[]) => {
      const title = args[0] as string
      const tabId = args[1] as string | undefined
      setTitle(title)
      if (tabId) {
        updateTab(tabId, { title })
      }
    })

    const unsubFavicon = window.electron.on(IPC_CHANNELS.PAGE_FAVICON, (...args: unknown[]) => {
      const favicon = args[0] as string
      const tabId = args[1] as string | undefined
      if (tabId) {
        updateTab(tabId, { favicon })
      }
    })

    // Handle "Open Link in New Tab" from context menu
    const unsubOpenLink = window.electron.on(IPC_CHANNELS.CONTEXT_OPEN_LINK, (...args: unknown[]) => {
      const url = args[0] as string
      useTabsStore.getState().addTab(url)
    })

    // Handle first-party isolation view recreation: reset renderer history so
    // back/forward buttons don't point to URLs of a destroyed WebContentsView
    const unsubHistoryReset = window.electron.on(IPC_CHANNELS.TAB_HISTORY_RESET, (...args: unknown[]) => {
      const tabId = args[0] as string
      const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
      if (tab) {
        useTabsStore.getState().updateTab(tabId, {
          history: [tab.url],
          historyIndex: 0,
          canGoBack: false,
          canGoForward: false,
        })
      }
    })

    return () => {
      unsubNavigate()
      unsubLoading()
      unsubTitle()
      unsubFavicon()
      unsubOpenLink()
      unsubHistoryReset()
    }
  }, [updateTab])
}
