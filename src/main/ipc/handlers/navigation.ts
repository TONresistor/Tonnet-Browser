/**
 * IPC handlers for page navigation, zoom, and devtools.
 */

import { IPC_CHANNELS } from '../../../shared/types'
import { isValidNavigationUrl } from '../validation'
import { secureHandle, secureHandleWithEvent, navLimiter, log } from './shared'
import { getSetting } from '../../settings'
import { getActiveView, hideAllViews, navigateInTab, getActiveTabId } from '../../windows/tabs'

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

  secureHandle(IPC_CHANNELS.GO_BACK, () => {
    const view = getActiveView()
    if (view?.webContents.navigationHistory.canGoBack()) {
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
