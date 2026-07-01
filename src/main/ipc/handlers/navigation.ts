/**
 * IPC handlers for page navigation, zoom, and devtools.
 */

import { errorMessage } from '../../../shared/errors'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { isValidNavigationUrl } from '../validation'
import { secureHandle, secureHandleWithEvent, navLimiter, log } from './shared'
import { getSetting } from '../../settings'
import { loadDataHtml } from '../../windows/page-templates'
import {
  getActiveView,
  hideAllViews,
  navigateInTab,
  getActiveTabId,
  fileBrowserCache,
  loadBagFileInTab,
} from '../../windows/tabs'

export function registerNavigationHandlers(): void {
  secureHandleWithEvent(IPC_CHANNELS.NAVIGATE, async (_event, url: string, tabId?: string) => {
    // Rate limit navigation requests
    if (!navLimiter.check()) {
      return { success: false, error: 'Rate limited' }
    }

    log.debug(`Navigate called with URL: ${url}, tabId: ${tabId || 'none'}`)

    // Security: Validate URL before navigation
    const validation = isValidNavigationUrl(url)
    if (!validation.valid) {
      log.warn(`Blocked invalid URL: ${url} (${validation.error})`)
      return { success: false, error: validation.error }
    }

    // ton://storage/browse/<bagId> is handled in-app by the React master-detail
    // file browser (StorageBrowsePage); it falls through to the internal ton://
    // branch below which hides the WebContentsView so React can render.

    // ton://storage/file/<bagId>/<encodedRelPath> opens a single bag file inline
    // in this tab (audio/pdf/image render in the browser, like the old browser).
    const fileMatch = url.match(/^ton:\/\/storage\/file\/([a-fA-F0-9]{64})\/(.+)$/)
    if (fileMatch) {
      const bagId = fileMatch[1]
      let relPath: string
      try {
        relPath = decodeURIComponent(fileMatch[2])
      } catch {
        return { success: false, error: 'Invalid file path' }
      }
      const targetTab = tabId || getActiveTabId()
      if (!targetTab) return { success: false, error: 'No tab to open the file in' }
      loadBagFileInTab(targetTab, bagId, relPath).catch((err) => {
        log.error('Failed to open bag file:', errorMessage(err))
      })
      return { success: true }
    }

    // Don't load internal ton:// URLs in WebContentsView
    if (url.startsWith('ton://')) {
      log.debug('Internal URL, hiding views')
      hideAllViews()
      return { success: true, internal: true }
    }

    // navigateInTab handles view visibility (show/attach) internally
    const targetTabId = tabId || getActiveTabId()
    if (targetTabId) {
      const success = await navigateInTab(targetTabId, url)
      return { success }
    }

    log.warn('No active tab')
    return { success: false, error: 'No active tab' }
  })

  secureHandle(IPC_CHANNELS.GO_BACK, async () => {
    const view = getActiveView()
    if (!view) return { success: false }

    // If viewing a local bag file, restore the file browser instead of goBack
    const currentUrl = view.webContents.getURL()
    if (currentUrl.startsWith('file:///') && currentUrl.includes('/storage/')) {
      const cached = fileBrowserCache.get(view.webContents.id)
      if (cached) {
        await loadDataHtml(view.webContents, cached)
        return { success: true }
      }
    }

    if (view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.GO_FORWARD, () => {
    const view = getActiveView()
    if (view?.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.RELOAD, () => {
    const view = getActiveView()
    if (view) {
      view.webContents.reload()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.STOP, () => {
    const view = getActiveView()
    if (view) {
      view.webContents.stop()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.ZOOM_IN, () => {
    const view = getActiveView()
    if (view) {
      const { zoomMax } = getSetting('appearance')
      const maxFactor = zoomMax / 100
      const currentZoom = view.webContents.getZoomFactor()
      view.webContents.setZoomFactor(Math.min(currentZoom + 0.1, maxFactor))
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.ZOOM_OUT, () => {
    const view = getActiveView()
    if (view) {
      const { zoomMin } = getSetting('appearance')
      const minFactor = zoomMin / 100
      const currentZoom = view.webContents.getZoomFactor()
      view.webContents.setZoomFactor(Math.max(currentZoom - 0.1, minFactor))
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.ZOOM_RESET, () => {
    const view = getActiveView()
    if (view) {
      const { defaultZoom } = getSetting('appearance')
      view.webContents.setZoomFactor(defaultZoom / 100)
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.TOGGLE_DEVTOOLS, () => {
    const view = getActiveView()
    if (view) {
      if (view.webContents.isDevToolsOpened()) {
        view.webContents.closeDevTools()
      } else {
        view.webContents.openDevTools({ mode: 'detach' })
      }
      return { success: true }
    }
    return { success: false }
  })
}
