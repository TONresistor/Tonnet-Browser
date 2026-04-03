/**
 * View bounds calculation for WebContentsViews.
 * Computes position and size based on layout settings (vertical/horizontal tabs, bookmarks bar, sidebar).
 */

import { WebContentsView, BrowserWindow } from 'electron'
import { UI_DIMENSIONS } from '../../shared/constants'
import { getSetting, type AppearanceSettings } from '../settings'

const { TABBAR_HEIGHT, NAVBAR_HEIGHT, BOOKMARKS_HEIGHT, STATUSBAR_HEIGHT, DEFAULT_SIDEBAR_WIDTH } = UI_DIMENSIONS

// Cache for appearance settings to avoid redundant getSetting() calls during resize
interface AppearanceCache {
  showBookmarksBar: boolean
  isVertical: boolean
  timestamp: number
}
let appearanceCache: AppearanceCache | null = null
import { APPEARANCE_CACHE_VALIDITY_MS as CACHE_VALIDITY_MS } from './constants'

/** Invalidate the appearance cache (call when settings change). */
export function invalidateAppearanceCache(): void {
  appearanceCache = null
}

/** Get cached appearance settings or refresh cache. */
export function getAppearanceSettings(): AppearanceCache {
  const now = Date.now()

  if (appearanceCache && now - appearanceCache.timestamp < CACHE_VALIDITY_MS) {
    return appearanceCache
  }

  const appearance: AppearanceSettings = getSetting('appearance')
  appearanceCache = {
    showBookmarksBar: appearance.showBookmarksBar ?? false,
    isVertical: appearance.tabOrientation === 'vertical',
    timestamp: now,
  }

  return appearanceCache
}

/** Update bounds of a WebContentsView based on current window size and layout settings. */
export function updateViewBounds(view: WebContentsView, win: BrowserWindow, walletSidebarWidth: number): void {
  const bounds = win.getContentBounds()

  const { isVertical, showBookmarksBar } = getAppearanceSettings()
  const sidebarWidth = (getSetting('appearance') as AppearanceSettings).sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH

  let chromeHeight = NAVBAR_HEIGHT
  if (!isVertical) {
    chromeHeight += TABBAR_HEIGHT
  }
  if (showBookmarksBar) {
    chromeHeight += BOOKMARKS_HEIGHT
  }

  const x = isVertical ? sidebarWidth : 0
  const width = (isVertical ? bounds.width - sidebarWidth : bounds.width) - walletSidebarWidth

  view.setBounds({
    x,
    y: chromeHeight,
    width,
    height: bounds.height - chromeHeight - STATUSBAR_HEIGHT,
  })
}

/** Update bounds for sidebar resize (vertical layout only). */
export function updateSidebarBounds(view: WebContentsView, win: BrowserWindow, sidebarWidth: number): void {
  const bounds = win.getContentBounds()
  const { isVertical, showBookmarksBar } = getAppearanceSettings()

  if (!isVertical) return

  let chromeHeight = NAVBAR_HEIGHT
  if (showBookmarksBar) {
    chromeHeight += BOOKMARKS_HEIGHT
  }

  view.setBounds({
    x: sidebarWidth,
    y: chromeHeight,
    width: bounds.width - sidebarWidth,
    height: bounds.height - chromeHeight - STATUSBAR_HEIGHT,
  })
}
