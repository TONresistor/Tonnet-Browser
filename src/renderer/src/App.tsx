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
const StartPage = lazy(() => import('@/components/pages/StartPage').then((m) => ({ default: m.StartPage })))
const StoragePage = lazy(() => import('@/components/pages/StoragePage').then((m) => ({ default: m.StoragePage })))
const SettingsPage = lazy(() => import('@/components/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const HistoryPage = lazy(() => import('@/components/pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore } from '@/stores/tabs'
import { usePreferencesStore } from '@/stores/preferences'
import { useThemeStore } from '@/stores/themes'
import { applyCustomTheme, removeCustomTheme } from '@/lib/theme-utils'
import { Settings, HardDrive } from 'lucide-react'
import Lottie from 'lottie-react'
import { Button } from '@/components/ui/button'
import i18n, { loadLanguage } from '@/i18n'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@/logger'

const log = createLogger('app')

function App() {
  const { t, i18n: i18nInstance } = useTranslation('common')
  const currentUrl = useBrowserStore((s) => s.currentUrl)
  const proxyConnected = useBrowserStore((s) => s.proxyConnected)
  const activeTabId = useTabsStore((s) => s.activeTabId)
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

  // Preload both animations once, select based on theme
  const animationsRef = useRef<{ dark: unknown; light: unknown } | null>(null)
  const [animationData, setAnimationData] = useState<unknown>(null)

  // Debounce timer for settings save
  const settingsSaveTimer = useRef<NodeJS.Timeout | null>(null)

  // Load preferences from main process on startup
  useEffect(() => {
    usePreferencesStore.getState().loadFromMain()
    useThemeStore.getState().loadFromSettings()
  }, [])

  // Sync current sidebar width with saved value when preferences load
  useEffect(() => {
    setCurrentSidebarWidth(savedSidebarWidth)
  }, [savedSidebarWidth])

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

  // Preload both animations once on mount
  useEffect(() => {
    Promise.all([import('@/assets/loading.json'), import('@/assets/loading-yellow.json')]).then(([dark, light]) => {
      animationsRef.current = { dark: dark.default, light: light.default }
      // Set initial animation based on current theme
      const isLight =
        theme === 'utya-duck' ||
        (theme.startsWith('custom:') &&
          customThemes.find((t) => t.id === theme.replace('custom:', ''))?.isDark === false)
      setAnimationData(isLight ? light.default : dark.default)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switch animation instantly on theme change (no re-import)
  useEffect(() => {
    if (!animationsRef.current) return
    const isLight =
      theme === 'utya-duck' ||
      (theme.startsWith('custom:') && customThemes.find((t) => t.id === theme.replace('custom:', ''))?.isDark === false)
    setAnimationData(isLight ? animationsRef.current.light : animationsRef.current.dark)
  }, [theme, customThemes])

  // Create default tab when proxy connects
  useEffect(() => {
    if (proxyConnected) {
      ensureDefaultTab()
    }
  }, [proxyConnected, ensureDefaultTab])

  // Keyboard shortcuts
  useEffect(() => {
    const { addTab, closeTab } = useTabsStore.getState()

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      // Ctrl/Cmd+T: New tab
      if (mod && !e.shiftKey && e.key === 't') {
        e.preventDefault()
        addTab()
      }
      // Ctrl/Cmd+Shift+T: Reopen last closed tab
      else if (mod && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        useTabsStore.getState().reopenLastClosedTab()
      }
      // Ctrl+Tab: Next tab (Ctrl even on macOS, same as Chrome)
      else if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
        e.preventDefault()
        useTabsStore.getState().nextTab()
      }
      // Ctrl+Shift+Tab: Previous tab (Ctrl even on macOS, same as Chrome)
      else if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault()
        useTabsStore.getState().previousTab()
      }
      // Ctrl/Cmd+1-9: Go to tab N
      else if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        useTabsStore.getState().goToTabByIndex(parseInt(e.key, 10))
      }
      // Ctrl/Cmd+H: History
      else if (mod && e.key === 'h') {
        e.preventDefault()
        openOrSwitchToTab('ton://history')
      }
      // Ctrl/Cmd+W: Close tab
      else if (mod && e.key === 'w') {
        e.preventDefault()
        const currentTabId = useTabsStore.getState().activeTabId
        if (currentTabId) {
          closeTab(currentTabId)
        }
      }
      // Ctrl/Cmd+L: Focus address bar
      else if (mod && e.key === 'l') {
        e.preventDefault()
        const addressInput = document.querySelector('input[placeholder*="ton"]') as HTMLInputElement
        addressInput?.focus()
        addressInput?.select()
      }
      // Ctrl/Cmd+R or F5: Reload
      else if ((mod && e.key === 'r') || e.key === 'F5') {
        e.preventDefault()
        window.electron.reload()
      }
      // Alt+Left: Back
      else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        useTabsStore.getState().goBack()
      }
      // Alt+Right: Forward
      else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        useTabsStore.getState().goForward()
      }
      // Escape: Stop loading
      else if (e.key === 'Escape') {
        window.electron.stop()
      }
      // Ctrl/Cmd++: Zoom in
      else if (mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        window.electron.zoomIn()
      }
      // Ctrl/Cmd+-: Zoom out
      else if (mod && e.key === '-') {
        e.preventDefault()
        window.electron.zoomOut()
      }
      // Ctrl/Cmd+0: Reset zoom
      else if (mod && e.key === '0') {
        e.preventDefault()
        window.electron.zoomReset()
      }
      // F12: Toggle DevTools (Ctrl+Shift+I is handled in main process)
      else if (e.key === 'F12') {
        e.preventDefault()
        window.electron.toggleDevTools()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Listen for IPC events from main process (navigation state updates)
  useEffect(() => {
    const { setNavigation, setLoading, setTitle } = useBrowserStore.getState()

    const unsubNavigate = window.electron.on('page:navigate', (...args: unknown[]) => {
      const data = args[0] as { tabId?: string; url: string; canGoBack: boolean; canGoForward: boolean }
      setNavigation(data.url, data.canGoBack, data.canGoForward)
      // Update tab state
      if (data.tabId) {
        updateTab(data.tabId, { url: data.url, canGoBack: data.canGoBack, canGoForward: data.canGoForward })
      }
    })

    const unsubLoading = window.electron.on('page:loading', (...args: unknown[]) => {
      const loading = args[0] as boolean
      const tabId = args[1] as string | undefined
      setLoading(loading)
      if (tabId) {
        updateTab(tabId, { isLoading: loading })
      }
    })

    const unsubTitle = window.electron.on('page:title', (...args: unknown[]) => {
      const title = args[0] as string
      const tabId = args[1] as string | undefined
      setTitle(title)
      if (tabId) {
        updateTab(tabId, { title })
      }
    })

    const unsubFavicon = window.electron.on('page:favicon', (...args: unknown[]) => {
      const favicon = args[0] as string
      const tabId = args[1] as string | undefined
      if (tabId) {
        updateTab(tabId, { favicon })
      }
    })

    // Handle "Open Link in New Tab" from context menu
    const unsubOpenLink = window.electron.on('context:open-link', (...args: unknown[]) => {
      const url = args[0] as string
      useTabsStore.getState().addTab(url)
    })

    // Handle first-party isolation view recreation: reset renderer history so
    // back/forward buttons don't point to URLs of a destroyed WebContentsView
    const unsubHistoryReset = window.electron.on('tab:history-reset', (...args: unknown[]) => {
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
        // Key forces remount when navigating to settings
        return <SettingsPage key={`settings-${activeTabId}`} />
      case 'history':
        return <HistoryPage />
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
        <div className="no-drag flex items-center gap-0.5 rounded-full px-1 py-0.5 bg-surface border border-surface-hover backdrop-blur-[20px]">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => openOrSwitchToTab('ton://storage')}
            title={t('tooltips.storage')}
          >
            <HardDrive className="h-4 w-4" />
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
      </div>

      {/* Status Bar - Full width */}
      {showStatusBar && <StatusBar />}
    </div>
  )
}

export default App
