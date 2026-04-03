/**
 * Event listeners for tab WebContentsViews.
 * Handles navigation events, loading states, favicon extraction, and context menus.
 */

import { WebContentsView } from 'electron'
import { loadStorageBrowser, loadErrorPage } from './tabs-storage'
import { extractFavicon } from './browser-view'
import { createLogger } from '../../shared/logger'
import { emitToRenderer } from '../ipc/handlers/shared'
import { historyManager } from '../history/manager'
import { overlayManager } from './overlay-manager'
import { clipboard } from 'electron'

const log = createLogger('tabs-events')

/** Set up non-security event listeners on a view (loading, navigation, favicon, context menu). */
export function setupViewEventListeners(view: WebContentsView, tabId: string): void {
  view.webContents.on('did-start-loading', () => {
    emitToRenderer('page:loading', true, tabId)
  })

  view.webContents.on('did-stop-loading', () => {
    emitToRenderer('page:loading', false, tabId)
  })

  const handleNavigate = (_e: unknown, url: string): void => {
    emitToRenderer('page:navigate', {
      tabId,
      url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })
    historyManager.addEntry(url, view.webContents.getTitle())
  }
  view.webContents.on('did-navigate', handleNavigate)
  view.webContents.on('did-navigate-in-page', handleNavigate)

  view.webContents.on('page-title-updated', (_e, title) => {
    emitToRenderer('page:title', title, tabId)

    const url = view.webContents.getURL()
    historyManager.addEntry(url, title, undefined, false)
  })

  // Extract favicon and detect empty storage bag pages
  view.webContents.on('did-finish-load', async () => {
    try {
      const favicon = await extractFavicon(view)
      if (favicon) {
        emitToRenderer('page:favicon', favicon, tabId)
      }
    } catch (error) {
      log.debug(`Failed to extract favicon for tab ${tabId}:`, error)
    }

    try {
      const pageUrl = view.webContents.getURL()
      const url = new URL(pageUrl)
      if (url.hostname.endsWith('.ton') && !pageUrl.startsWith('data:')) {
        const { textLen, htmlLen } = await view.webContents.executeJavaScript(
          '({ textLen: document.body ? document.body.innerText.trim().length : 0, htmlLen: document.body ? document.body.innerHTML.trim().length : 0 })'
        )
        if (htmlLen < 50 && textLen < 10) {
          log.info(`Empty page detected for ${url.hostname}, trying storage browser`)
          loadStorageBrowser(view, url.hostname).catch(() => {
            log.debug('Not a storage bag or no files available')
          })
        }
      }
    } catch (err) {
      log.debug('Empty page detection failed:', err)
    }
  })

  // Handle load failures
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3 || errorCode === -2 || errorCode === 0) {
      return
    }

    if (validatedURL.startsWith('data:') || validatedURL.startsWith('file:')) {
      return
    }

    log.warn(`Page load failed: ${errorDescription} (code: ${errorCode}) for ${validatedURL}`)

    try {
      const url = new URL(validatedURL)
      if (url.hostname.endsWith('.ton')) {
        loadStorageBrowser(view, url.hostname).catch(() => {
          loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
        })
        return
      }
    } catch (err) {
      log.debug('URL parse failed in did-fail-load:', err)
    }

    loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
  })

  // Context menu for web pages (overlay instead of native menu)
  view.webContents.on('context-menu', (_e, params) => {
    const items: Array<{
      id: string
      label: string
      separator?: boolean
      disabled?: boolean
      destructive?: boolean
      data?: Record<string, string>
    }> = []

    // Text editing options
    if (params.isEditable) {
      items.push(
        { id: 'cut', label: 'Cut', disabled: !params.editFlags.canCut },
        { id: 'copy', label: 'Copy', disabled: !params.editFlags.canCopy },
        { id: 'paste', label: 'Paste', disabled: !params.editFlags.canPaste },
        { id: '_sep1', label: '', separator: true },
        { id: 'select-all', label: 'Select All' }
      )
    } else if (params.selectionText) {
      items.push({ id: 'copy', label: 'Copy' })
    }

    // Link options
    if (params.linkURL) {
      if (items.length > 0) items.push({ id: '_sep2', label: '', separator: true })
      items.push(
        { id: 'open-link-new-tab', label: 'Open Link in New Tab', data: { url: params.linkURL } },
        { id: 'copy-link', label: 'Copy Link Address', data: { url: params.linkURL } }
      )
    }

    // Image options
    if (params.hasImageContents && params.srcURL) {
      if (items.length > 0) items.push({ id: '_sep3', label: '', separator: true })
      items.push({ id: 'copy-image-url', label: 'Copy Image Address', data: { url: params.srcURL } })
    }

    // Navigation options
    if (items.length > 0) items.push({ id: '_sep4', label: '', separator: true })
    items.push(
      { id: 'back', label: 'Back', disabled: !view.webContents.navigationHistory.canGoBack() },
      { id: 'forward', label: 'Forward', disabled: !view.webContents.navigationHistory.canGoForward() },
      { id: 'reload', label: 'Reload' }
    )

    if (items.length === 0) return

    // Calculate menu height: ~36px per item, 1px per separator, 8px padding
    const visibleItems = items.filter((i) => !i.separator).length
    const separators = items.filter((i) => i.separator).length
    const menuH = visibleItems * 36 + separators * 9 + 8
    const menuW = 220

    // Clamp to window bounds
    const winBounds = view.getBounds()
    const menuX = Math.max(0, Math.min(params.x, winBounds.width - menuW))
    const menuY = Math.max(0, Math.min(params.y, winBounds.height - menuH))

    // Offset by view position in window
    const offsetX = winBounds.x + menuX
    const offsetY = winBounds.y + menuY

    overlayManager.show(
      'page-context-menu',
      { x: offsetX, y: offsetY, width: menuW, height: menuH },
      { type: 'menu', items },
      (actionType, actionData) => {
        const d = actionData as Record<string, string>
        switch (actionType) {
          case 'cut':
            view.webContents.cut()
            break
          case 'copy':
            view.webContents.copy()
            break
          case 'paste':
            view.webContents.paste()
            break
          case 'select-all':
            view.webContents.selectAll()
            break
          case 'open-link-new-tab':
            emitToRenderer('context:open-link', d.url)
            break
          case 'copy-link':
            clipboard.writeText(d.url)
            break
          case 'copy-image-url':
            clipboard.writeText(d.url)
            break
          case 'back':
            view.webContents.navigationHistory.goBack()
            break
          case 'forward':
            view.webContents.navigationHistory.goForward()
            break
          case 'reload':
            view.webContents.reload()
            break
          case 'dismiss':
            break
        }
        overlayManager.hide('page-context-menu')
      }
    )
  })
}
