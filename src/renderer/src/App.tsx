/**
 * Main application component.
 * Browser chrome with tabs, navigation, and content area.
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavigationButtons } from '@/components/browser/NavigationButtons'
import { AddressBar } from '@/components/browser/AddressBar'
import { WindowControls } from '@/components/browser/WindowControls'
import { TabBar } from '@/components/browser/TabBar'
import { BookmarksBar } from '@/components/browser/BookmarksBar'
import { StatusBar } from '@/components/browser/StatusBar'
import { ResizablePanel } from '@/components/browser/ResizablePanel'
import { LandingPage } from '@/components/pages/LandingPage'
import { StartPage } from '@/components/pages/StartPage'
const StoragePage = lazy(() => import('@/components/pages/StoragePage').then((m) => ({ default: m.StoragePage })))
const SettingsPage = lazy(() => import('@/components/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const HistoryPage = lazy(() => import('@/components/pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const BookmarksPage = lazy(() => import('@/components/pages/BookmarksPage').then((m) => ({ default: m.BookmarksPage })))
const WalletPage = lazy(() => import('@/components/pages/WalletPage'))
const DnsPage = lazy(() => import('@/components/pages/DnsPage'))
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore } from '@/stores/tabs'
import { usePreferencesStore } from '@/stores/preferences'
import { useThemeStore } from '@/stores/themes'
import { useWalletStore } from '@/stores/wallet'
import { applyCustomTheme, removeCustomTheme } from '@/lib/theme-utils'
import { WalletSidebar } from '@/components/wallet/WalletSidebar'
import { Settings } from 'lucide-react'
import walletIcon from '@/assets/wallet.svg'
import storageIcon from '@/assets/storage.svg'
import { Button } from '@/components/ui/button'
import Lottie from 'lottie-react'
import loadingDark from '@/assets/loading.json'
import loadingLight from '@/assets/loading-yellow.json'
import i18n, { loadLanguage } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { loadBookmarksFromMain } from '@/stores/bookmarks'
import { createLogger } from '@/logger'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useIpcEvents } from '@/hooks/useIpcEvents'

const log = createLogger('app')

function isLightTheme(theme: string, customThemes: { id: string; isDark: boolean }[]): boolean {
  return (
    theme === 'utya-duck' ||
    (theme.startsWith('custom:') && customThemes.find((t) => t.id === theme.replace('custom:', ''))?.isDark === false)
  )
}

// Wallet pill button — simple click opens ton://wallet page

function App() {
  const { t, i18n: i18nInstance } = useTranslation('common')
  const currentUrl = useBrowserStore((s) => s.currentUrl)
  const proxyConnected = useBrowserStore((s) => s.proxyConnected)
  const updateTab = useTabsStore((s) => s.updateTab)
  const openOrSwitchToTab = useTabsStore((s) => s.openOrSwitchToTab)
  const ensureDefaultTab = useTabsStore((s) => s.ensureDefaultTab)
  const showBookmarksBar = usePreferencesStore((s) => s.saved.showBookmarksBar)
  const showStatusBar = usePreferencesStore((s) => s.saved.showStatusBar)
  const theme = usePreferencesStore((s) => s.saved.theme)
  const language = usePreferencesStore((s) => s.saved.language)
  const tabOrientation = usePreferencesStore((s) => s.saved.tabOrientation)
  const savedSidebarWidth = usePreferencesStore((s) => s.saved.sidebarWidth)
  const setDraft = usePreferencesStore((s) => s.setDraft)
  const customThemes = useThemeStore((state) => state.customThemes)

  // Track current sidebar width in real-time during resize
  const [currentSidebarWidth, setCurrentSidebarWidth] = useState(savedSidebarWidth)
  const [walletSidebarOpen, setWalletSidebarOpen] = useState(false)
  const [walletSidebarWidth, setWalletSidebarWidth] = useState(320)

  // Animation data selected based on theme (loaded synchronously, never null)
  const [animationData, setAnimationData] = useState<unknown>(() =>
    isLightTheme(theme, customThemes) ? loadingLight : loadingDark
  )

  // Debounce timer for settings save
  const settingsSaveTimer = useRef<NodeJS.Timeout | null>(null)

  // Load preferences from main process on startup
  useEffect(() => {
    usePreferencesStore.getState().loadFromMain()
    useThemeStore.getState().loadFromSettings()
    useWalletStore.getState().init()
    loadBookmarksFromMain()
  }, [])

  // Sync current sidebar width with saved value when preferences load
  useEffect(() => {
    setCurrentSidebarWidth(savedSidebarWidth)
  }, [savedSidebarWidth])

  // Sync wallet sidebar width with main process
  useEffect(() => {
    window.electron.updateWalletSidebarWidth(walletSidebarOpen ? walletSidebarWidth : 0)
    return () => {
      window.electron.updateWalletSidebarWidth(0)
    }
  }, [walletSidebarOpen, walletSidebarWidth])

  // Sync document lang attribute with i18n language
  useEffect(() => {
    document.documentElement.lang = i18nInstance.language
  }, [i18nInstance.language])

  // Update i18n language when preference changes (with lazy loading)
  useEffect(() => {
    if (language && i18n.language !== language) {
      loadLanguage(language).catch((error) => {
        log.error('Failed to load language:', error)
      })
    }
  }, [language])

  // Apply theme to document
  useEffect(() => {
    if (theme.startsWith('custom:')) {
      // Custom theme
      const customThemeId = theme.replace('custom:', '')
      const customTheme = customThemes.find((t) => t.id === customThemeId)
      if (customTheme) {
        applyCustomTheme(customTheme)
      } else {
        // Fallback if theme was deleted
        removeCustomTheme()
        document.documentElement.setAttribute('data-theme', 'resistance-dog')
      }
    } else {
      // Built-in theme
      removeCustomTheme()
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [theme, customThemes])

  // Switch animation on theme change
  useEffect(() => {
    setAnimationData(isLightTheme(theme, customThemes) ? loadingLight : loadingDark)
  }, [theme, customThemes])

  // Create default tab when proxy connects + prefetch lazy pages
  useEffect(() => {
    if (proxyConnected) {
      ensureDefaultTab()
      // Prefetch lazy chunks while idle so they're instant when clicked
      requestIdleCallback(() => {
        import('@/components/pages/SettingsPage')
        import('@/components/pages/StoragePage')
        import('@/components/pages/HistoryPage')
        import('@/components/pages/BookmarksPage')
        import('@/components/pages/WalletPage')
        import('@/components/pages/DnsPage')
      })
    }
  }, [proxyConnected, ensureDefaultTab])

  // Keyboard shortcuts (extracted to hook)
  useKeyboardShortcuts(openOrSwitchToTab)

  // IPC events from main process (extracted to hook)
  useIpcEvents(updateTab)

  // Determine which internal page to show
  const isInternalPage = currentUrl.startsWith('ton://')
  const internalPage = currentUrl.replace('ton://', '')

  const renderContent = () => {
    // Show landing page if not connected
    if (!proxyConnected && (internalPage === 'start' || !isInternalPage)) {
      return <LandingPage />
    }

    if (!isInternalPage) {
      // External page - WebContentsView handles this, this is just a background
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-background-secondary">
          <Lottie animationData={animationData} className="w-64 h-64" loop autoplay />
        </div>
      )
    }

    switch (internalPage) {
      case 'start':
        return <StartPage />
      case 'storage':
        return <StoragePage />
      case 'settings':
        return <SettingsPage />
      case 'history':
        return <HistoryPage />
      case 'bookmarks':
        return <BookmarksPage />
      case 'wallet':
        return <WalletPage />
      case 'dns':
        return <DnsPage />
      case 'loading':
        return (
          <div className="w-full h-full flex flex-col items-center justify-center bg-background-secondary">
            <Lottie animationData={animationData} className="w-64 h-64" loop autoplay />
          </div>
        )
      default:
        return <StartPage />
    }
  }

  // Vertical tabs: sidebar only affects content area, not full window
  const isVertical = tabOrientation === 'vertical'

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Tab Bar Row - Only in horizontal mode */}
      {!isVertical && (
        <div className="flex items-center bg-background drag-region min-h-[44px]">
          {proxyConnected && <TabBar />}
          <div className="flex-1" />
          <WindowControls />
        </div>
      )}

      {/* Navigation Bar - Full width */}
      <div className={`flex items-center px-2 py-1.5 gap-2 bg-background ${isVertical ? 'drag-region' : ''}`}>
        <div className="no-drag">
          <NavigationButtons />
        </div>
        <div className="no-drag flex-1">
          <AddressBar />
        </div>
        <div className="no-drag flex items-center gap-0.5 rounded-full px-1 py-0.5 glass-surface">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => openOrSwitchToTab('ton://storage')}
            title={t('tooltips.storage')}
          >
            <img src={storageIcon} alt="" className="h-4 w-4 brightness-0 invert" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => setWalletSidebarOpen((v) => !v)}
            title={t('tooltips.wallet')}
          >
            <img src={walletIcon} alt="" className="h-4 w-4 brightness-0 invert" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => openOrSwitchToTab('ton://settings')}
            title={t('tooltips.settings')}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        {/* Window Controls in nav bar - Only in vertical/sidebar mode */}
        {isVertical && (
          <div className="no-drag">
            <WindowControls />
          </div>
        )}
      </div>

      {/* Bookmarks Bar - Full width */}
      {showBookmarksBar && <BookmarksBar />}

      {/* Main Content Area - Sidebar + Content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar (vertical tabs) - Resizable in vertical mode */}
        {isVertical && proxyConnected && (
          <ResizablePanel
            defaultWidth={savedSidebarWidth}
            minWidth={64}
            maxWidth={400}
            onResize={(width) => {
              // Update local state immediately for real-time UI updates
              setCurrentSidebarWidth(width)
              setDraft('sidebarWidth', width)

              // Debounce settings save to avoid excessive disk writes
              if (settingsSaveTimer.current) {
                clearTimeout(settingsSaveTimer.current)
              }
              settingsSaveTimer.current = setTimeout(() => {
                window.electron.settings
                  .set('appearance', { sidebarWidth: width })
                  .catch((err) => log.error('Failed to save sidebar width:', err))
              }, 300)
            }}
            className="flex flex-col bg-background border-r border-border"
          >
            <TabBar sidebarWidth={currentSidebarWidth} />
          </ResizablePanel>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-auto min-h-0">
          <Suspense
            fallback={
              <div className="w-full h-full flex flex-col items-center justify-center bg-background-secondary">
                {animationData ? (
                  <Lottie animationData={animationData} className="w-64 h-64" loop autoplay />
                ) : (
                  <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
              </div>
            }
          >
            {renderContent()}
          </Suspense>
        </div>

        {/* Right sidebar (wallet) */}
        {walletSidebarOpen && (
          <ResizablePanel
            side="right"
            defaultWidth={walletSidebarWidth}
            minWidth={280}
            maxWidth={420}
            onResize={(width) => {
              setWalletSidebarWidth(width)
              window.electron.updateWalletSidebarWidth(width)
            }}
            className="border-l border-border"
          >
            <WalletSidebar onClose={() => setWalletSidebarOpen(false)} />
          </ResizablePanel>
        )}
      </div>

      {/* Status Bar - Full width */}
      {showStatusBar && <StatusBar />}
    </div>
  )
}

export default App
