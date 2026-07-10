import i18n from '@/i18n'
import bookmarkIcon from '@/assets/bookmark.svg'
import cocoonIcon from '@/assets/cocoon.png'
import dnsIcon from '@/assets/dns.svg'
import historyIcon from '@/assets/history.svg'
import messengerIcon from '@/assets/messenger.svg'
import settingsIcon from '@/assets/settings.svg'
import storageIcon from '@/assets/storage.svg'
import walletIcon from '@/assets/wallet.svg'

export type InternalRouteView =
  | 'start'
  | 'storage'
  | 'storage-browse'
  | 'storage-view'
  | 'loading'
  | 'settings'
  | 'history'
  | 'bookmarks'
  | 'wallet'
  | 'dns'
  | 'chat'
  | 'cocoon'

export type InternalRoute =
  | { kind: 'start'; view: 'start' }
  | { kind: 'storage'; view: 'storage' }
  | { kind: 'storage-browse'; view: 'storage-browse'; bagId: string }
  | { kind: 'storage-view'; view: 'storage-view'; bagId: string; filePath: string }
  | { kind: 'storage-file'; view: 'loading' }
  | { kind: 'settings'; view: 'settings' }
  | { kind: 'history'; view: 'history' }
  | { kind: 'bookmarks'; view: 'bookmarks' }
  | { kind: 'wallet'; view: 'wallet' }
  | { kind: 'dns'; view: 'dns' }
  | { kind: 'chat'; view: 'chat' }
  | { kind: 'cocoon'; view: 'cocoon' }
  | { kind: 'loading'; view: 'loading' }
  | { kind: 'fallback'; view: 'start' }

type StaticRouteKind = Exclude<InternalRoute['kind'], 'storage-browse' | 'storage-view' | 'storage-file' | 'fallback'>

interface RouteMetadata {
  kind: StaticRouteKind
  view: InternalRouteView
  title: () => string
  favicon?: string
}

const routes = {
  start: { kind: 'start', view: 'start', title: () => i18n.t('tabs.newTab', { ns: 'browser' }) },
  wallet: {
    kind: 'wallet',
    view: 'wallet',
    title: () => i18n.t('page.title', { ns: 'wallet' }),
    favicon: walletIcon,
  },
  storage: {
    kind: 'storage',
    view: 'storage',
    title: () => i18n.t('storage.title', { ns: 'settings' }),
    favicon: storageIcon,
  },
  settings: {
    kind: 'settings',
    view: 'settings',
    title: () => i18n.t('title', { ns: 'settings' }),
    favicon: settingsIcon,
  },
  cocoon: {
    kind: 'cocoon',
    view: 'cocoon',
    title: () => i18n.t('tooltips.cocoon', { ns: 'common' }),
    favicon: cocoonIcon,
  },
  chat: { kind: 'chat', view: 'chat', title: () => 'Messenger', favicon: messengerIcon },
  bookmarks: {
    kind: 'bookmarks',
    view: 'bookmarks',
    title: () => i18n.t('bookmarks.title', { ns: 'settings' }),
    favicon: bookmarkIcon,
  },
  history: {
    kind: 'history',
    view: 'history',
    title: () => i18n.t('history.title', { ns: 'pages' }),
    favicon: historyIcon,
  },
  dns: { kind: 'dns', view: 'dns', title: () => i18n.t('title', { ns: 'dns' }), favicon: dnsIcon },
  loading: { kind: 'loading', view: 'loading', title: () => i18n.t('appName', { ns: 'common' }) },
} satisfies Record<string, RouteMetadata>

export function isInternalUrl(url: string): boolean {
  return url.startsWith('ton://')
}

export function resolveInternalRoute(url: string): InternalRoute | null {
  if (!isInternalUrl(url)) return null

  const path = url.slice('ton://'.length)
  const staticRoute = routes[path as keyof typeof routes]
  if (staticRoute) return { kind: staticRoute.kind, view: staticRoute.view } as InternalRoute

  if (path.startsWith('storage/browse/')) {
    return { kind: 'storage-browse', view: 'storage-browse', bagId: path.slice('storage/browse/'.length) }
  }

  if (path.startsWith('storage/view/')) {
    const rest = path.slice('storage/view/'.length)
    const separator = rest.indexOf('/')
    if (separator > 0) {
      let filePath = rest.slice(separator + 1)
      try {
        filePath = decodeURIComponent(filePath)
      } catch {
        // Preserve the raw path when a URL contains malformed percent encoding.
      }
      return { kind: 'storage-view', view: 'storage-view', bagId: rest.slice(0, separator), filePath }
    }
  }

  if (path.startsWith('storage/file/')) return { kind: 'storage-file', view: 'loading' }
  return { kind: 'fallback', view: 'start' }
}

export function getInternalPageTitle(url: string): string | null {
  const route = resolveInternalRoute(url)
  if (!route) return null
  if (route.kind === 'storage-browse' || route.kind === 'storage-view' || route.kind === 'storage-file') {
    return routes.storage.title()
  }
  if (route.kind === 'fallback') return i18n.t('appName', { ns: 'common' })
  const metadata = Object.values(routes).find((candidate) => candidate.kind === route.kind)
  return metadata?.title() ?? i18n.t('appName', { ns: 'common' })
}

export function getInternalPageFavicon(url: string): string | null {
  const route = resolveInternalRoute(url)
  if (!route) return null
  if (route.kind === 'storage-browse' || route.kind === 'storage-view' || route.kind === 'storage-file') {
    return storageIcon
  }
  if (route.kind === 'fallback') return null
  const metadata = Object.values(routes).find((candidate) => candidate.kind === route.kind)
  return metadata && 'favicon' in metadata ? metadata.favicon : null
}
