import { lazy, type ReactNode } from 'react'
import type { InternalRoute } from './internal-routes'
import { StartPage } from '@/components/pages/StartPage'
import { SettingsPage } from '@/features/settings/components/SettingsPage'
import { StoragePage } from '@/features/storage/components/StoragePage'
import { WalletPage } from '@/features/wallet/components/WalletPage'
import { ThemePage } from '@/features/themes/components/ThemePage'
import { HistoryPage } from '@/features/history/components/HistoryPage'
import { BookmarksPage } from '@/features/bookmarks/components/BookmarksPage'
import ChatPage from '@/features/messenger/components/ChatPage'
import DnsPage from '@/features/dns/components/DnsPage'
import CocoonChatPage from '@/features/cocoon/components/CocoonChatPage'

const views = {
  start: StartPage,
  storage: StoragePage,
  'storage-browse': lazy(() =>
    import('@/features/storage/components/StorageBrowsePage').then((module) => ({ default: module.StorageBrowsePage }))
  ),
  'storage-view': lazy(() =>
    import('@/features/storage/components/StorageFileViewerPage').then((module) => ({
      default: module.StorageFileViewerPage,
    }))
  ),
  settings: SettingsPage,
  theme: ThemePage,
  history: HistoryPage,
  bookmarks: BookmarksPage,
  wallet: WalletPage,
  dns: DnsPage,
  chat: ChatPage,
  cocoon: CocoonChatPage,
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
