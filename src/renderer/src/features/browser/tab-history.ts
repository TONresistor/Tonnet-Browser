interface TabHistory {
  url: string
  history: string[]
  historyIndex: number
  nativeCanGoBack?: boolean
  nativeCanGoForward?: boolean
  legacyStorageHistory?: boolean
}

export function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href
  } catch {
    return a === b
  }
}

function isReloadablePage(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/**
 * Walks the app-level list for the nearest page the app can load itself.
 * Chromium forgets its history whenever a tab's view is recreated for a new
 * domain, so those entries only exist here.
 */
function appLevelTraversal(tab: TabHistory, direction: 'back' | 'forward'): number | null {
  const step = direction === 'back' ? -1 : 1
  for (let index = tab.historyIndex + step; index >= 0 && index < tab.history.length; index += step) {
    const candidate = tab.history[index]
    if (!isReloadablePage(candidate) || sameUrl(candidate, tab.url)) continue
    return index
  }
  return null
}

/** Chromium owns web visits; React routes and legacy Storage keep their existing URL history. */
export function selectTabTraversal(tab: TabHistory, direction: 'back' | 'forward'): number | 'native' | null {
  const step = direction === 'back' ? -1 : 1
  const adjacent = tab.historyIndex + step
  if (tab.url.startsWith('ton://') || tab.url.startsWith('file:') || tab.legacyStorageHistory) {
    return adjacent >= 0 && adjacent < tab.history.length ? adjacent : null
  }
  let internal: number | null = null
  for (let index = adjacent; index >= 0 && index < tab.history.length; index += step) {
    if (tab.history[index].startsWith('ton://')) {
      internal = index
      break
    }
  }
  if (direction === 'forward' && internal !== null && sameUrl(tab.url, tab.history[tab.historyIndex])) return internal
  if (direction === 'back' ? tab.nativeCanGoBack : tab.nativeCanGoForward) return 'native'
  // A page the app can reload is nearer than an internal route behind it: after a
  // view recreation the list is the only history left, and walking to the nearest
  // ton:// entry first would skip every web page in between.
  return appLevelTraversal(tab, direction) ?? internal
}

export function tabNavigationFlags(tab: TabHistory): { canGoBack: boolean; canGoForward: boolean } {
  return {
    canGoBack: selectTabTraversal(tab, 'back') !== null,
    canGoForward: selectTabTraversal(tab, 'forward') !== null,
  }
}
