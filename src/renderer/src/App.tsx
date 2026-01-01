/**
 * Main application component.
 * Browser chrome with tabs, navigation, and content area.
 */

import { useEffect } from 'react'
import { NavigationButtons } from '@/components/browser/NavigationButtons'
import { AddressBar } from '@/components/browser/AddressBar'
import { WindowControls } from '@/components/browser/WindowControls'
import { TabBar } from '@/components/browser/TabBar'
import { BookmarksBar } from '@/components/browser/BookmarksBar'
import { StatusBar } from '@/components/browser/StatusBar'
import { LandingPage } from '@/components/pages/LandingPage'
import { StartPage } from '@/components/pages/StartPage'
import { StoragePage } from '@/components/pages/StoragePage'
import { SettingsPage } from '@/components/pages/SettingsPage'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { usePreferences, usePreferencesStore } from '@/stores/preferences'
import { useThemeStore } from '@/stores/themes'
import { applyCustomTheme, removeCustomTheme } from '@/lib/theme-utils'
import { Settings, HardDrive } from 'lucide-react'
import Lottie from 'lottie-react'
import loadingAnimation from '@/assets/loading.json'
import loadingYellowAnimation from '@/assets/loading-yellow.json'
import { Button } from '@/components/ui/button'

function App() {
  const { currentUrl, proxyConnected } = useSettingsStore()
  const { activeTabId, updateTab, openOrSwitchToTab, ensureDefaultTab } = useTabsStore()
  const { showBookmarksBar, showStatusBar, theme } = usePreferences()
  const customThemes = useThemeStore((state) => state.customThemes)

  // Load preferences from main process on startup
  useEffect(() => {
    usePreferencesStore.getState().loadFromMain()
    useThemeStore.getState().loadFromSettings()
  }, [])

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

  // Create default tab when proxy connects
  useEffect(() => {
    if (proxyConnected) {
      ensureDefaultTab()
    }
  }, [proxyConnected, ensureDefaultTab])

  // Keyboard shortcuts
  useEffect(() => {
    const { addTab, closeTab, activeTabId, goBack, goForward } = useTabsStore.getState()

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+T: New tab
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault()
        addTab()
      }
      // Ctrl+W: Close tab
      else if (e.ctrlKey && e.key === 'w') {
        e.preventDefault()
        const currentTabId = useTabsStore.getState().activeTabId
        if (currentTabId) {
          closeTab(currentTabId)
        }
      }
      // Ctrl+L: Focus address bar
      else if (e.ctrlKey && e.key === 'l') {
        e.preventDefault()
        const addressInput = document.querySelector('input[placeholder*="ton"]') as HTMLInputElement
        addressInput?.focus()
        addressInput?.select()
      }
      // Ctrl+R or F5: Reload
      else if ((e.ctrlKey && e.key === 'r') || e.key === 'F5') {
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
      // Ctrl++: Zoom in
      else if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        window.electron.zoomIn()
      }
      // Ctrl+-: Zoom out
      else if (e.ctrlKey && e.key === '-') {
        e.preventDefault()
        window.electron.zoomOut()
      }
      // Ctrl+0: Reset zoom
      else if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        window.electron.zoomReset()
      }
      // F12: Toggle DevTools
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
    const { setNavigation, setLoading, setTitle } = useSettingsStore.getState()

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

    // Handle "Open Link in New Tab" from context menu
    const unsubOpenLink = window.electron.on('context:open-link', (...args: unknown[]) => {
      const url = args[0] as string
      useTabsStore.getState().addTab(url)
    })

    return () => {
      unsubNavigate()
      unsubLoading()
      unsubTitle()
      unsubOpenLink()
    }
  }, [updateTab])

  // Determine which internal page to show
  const isInternalPage = currentUrl.startsWith('ton://')
  const internalPage = currentUrl.replace('ton://', '')

  // Determine loading animation based on theme type
  const isLightTheme = theme === 'utya-duck' ||
    (theme.startsWith('custom:') &&
      customThemes.find((t) => t.id === theme.replace('custom:', ''))?.isDark === false)
  const currentLoadingAnimation = isLightTheme ? loadingYellowAnimation : loadingAnimation

  const renderContent = () => {
    // Show landing page if not connected
    if (!proxyConnected && (internalPage === 'start' || !isInternalPage)) {
      return <LandingPage />
    }

    if (!isInternalPage) {
      // External page - BrowserView handles this, this is just a background
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-background-secondary">
          <Lottie animationData={currentLoadingAnimation} className="w-64 h-64" loop autoplay />
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
      case 'loading':
        return (
          <div className="w-full h-full flex flex-col items-center justify-center bg-background-secondary">
            <Lottie animationData={currentLoadingAnimation} className="w-64 h-64" loop autoplay />
          </div>
        )
      default:
        return <StartPage />
    }
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Tab Bar + Window Controls - entire bar is draggable except buttons */}
      <div className="flex items-center bg-background drag-region min-h-[44px]">
        {proxyConnected && <TabBar />}
        {/* Spacer fills remaining space */}
        <div className="flex-1" />
        {/* Window Controls */}
        <WindowControls />
      </div>

      {/* Navigation Bar */}
      <div className="flex items-center px-2 py-1.5 gap-2 bg-background">
        <NavigationButtons />
        <AddressBar />
        <div
          className="flex items-center gap-0.5 rounded-full px-1 py-0.5 bg-surface border border-surface-hover backdrop-blur-[20px]"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => openOrSwitchToTab('ton://storage')}
            title="Storage"
          >
            <HardDrive className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={() => openOrSwitchToTab('ton://settings')}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Bookmarks Bar */}
      {showBookmarksBar && <BookmarksBar />}

      {/* Content Area */}
      <div className="flex-1 overflow-auto">
        {renderContent()}
      </div>

      {/* Status Bar */}
      {showStatusBar && <StatusBar />}
    </div>
  )
}

export default App
