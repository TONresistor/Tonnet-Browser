import { lazy, type ReactNode } from 'react'
import type { InternalRoute } from './internal-routes'

const views = {
  start: lazy(() => import('@/components/pages/StartPage').then((module) => ({ default: module.StartPage }))),
  storage: lazy(() =>
    import('@/features/storage/components/StoragePage').then((module) => ({ default: module.StoragePage }))
  ),
  'storage-browse': lazy(() =>
    import('@/features/storage/components/StorageBrowsePage').then((module) => ({ default: module.StorageBrowsePage }))
  ),
  'storage-view': lazy(() =>
    import('@/features/storage/components/StorageFileViewerPage').then((module) => ({
      default: module.StorageFileViewerPage,
    }))
  ),
  settings: lazy(() =>
    import('@/features/settings/components/SettingsPage').then((module) => ({ default: module.SettingsPage }))
  ),
  theme: lazy(() => import('@/features/themes/components/ThemePage').then((module) => ({ default: module.ThemePage }))),
  history: lazy(() =>
    import('@/features/history/components/HistoryPage').then((module) => ({ default: module.HistoryPage }))
  ),
  bookmarks: lazy(() =>
    import('@/features/bookmarks/components/BookmarksPage').then((module) => ({ default: module.BookmarksPage }))
  ),
  wallet: lazy(() => import('@/features/wallet/components/WalletPage')),
  dns: lazy(() => import('@/features/dns/components/DnsPage')),
  chat: lazy(() => import('@/features/messenger/components/ChatPage')),
  cocoon: lazy(() => import('@/features/cocoon/components/CocoonChatPage')),
}

interface InternalRouteContentProps {
  route: InternalRoute
  loading: ReactNode
}

export function InternalRouteContent({ route, loading }: InternalRouteContentProps) {
  if (route.view === 'loading') return loading
  if (route.view === 'storage-browse' && route.kind === 'storage-browse') {
    const View = views['storage-browse']
    return <View bagId={route.bagId} />
  }
  if (route.view === 'storage-view' && route.kind === 'storage-view') {
    const View = views['storage-view']
    return <View bagId={route.bagId} filePath={route.filePath} />
  }

  const View = views[route.view]
  return <View />
}
