/**
 * Page Settings principale
 * Container qui orchestre toutes les sections
 */

import { useState, useEffect, useRef } from 'react'
import { createLogger } from '@/logger'
import { UI_NOTIFICATION_TIMEOUT_MS, UI_ERROR_TIMEOUT_MS } from '@shared/constants'
import { usePreferencesStore } from '@/stores/preferences'

const log = createLogger('settings')
import { useBookmarksStore } from '@/stores/bookmarks'
import { SettingsLayout } from '@/components/settings/SettingsLayout'
import { SettingsSidebar } from '@/components/settings/SettingsSidebar'
import { SettingsActions } from '@/components/settings/SettingsActions'
import { LoadingState } from '@/components/settings/shared/LoadingState'
import type { SettingsSection } from '@/components/settings/types'

// Import sections
import { GeneralSection } from '@/components/settings/sections/GeneralSection'
import { NetworkSection } from '@/components/settings/sections/NetworkSection'
import { StorageSection } from '@/components/settings/sections/StorageSection'
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection'
import { PrivacySection } from '@/components/settings/sections/PrivacySection'
import { ContentFilteringSection } from '@/components/settings/sections/ContentFilteringSection'
import { HistorySection } from '@/components/settings/sections/HistorySection'
import { ShortcutsSection } from '@/components/settings/sections/ShortcutsSection'
import { BookmarksSection } from '@/components/settings/sections/BookmarksSection'
import { AdvancedSection } from '@/components/settings/sections/AdvancedSection'
import { AboutSection } from '@/components/settings/sections/AboutSection'
import { WalletSection } from '@/components/settings/sections/WalletSection'
import type { WalletSectionHandle } from '@/components/settings/sections/WalletSection'

export function SettingsPage() {
  // State
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [changingHistoryMode, setChangingHistoryMode] = useState(false)
  const [pendingReset, setPendingReset] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [walletDirty, setWalletDirty] = useState(false)

  // Refs
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const walletSectionRef = useRef<WalletSectionHandle | null>(null)

  // Stores
  const {
    draft,
    isLoaded,
    hasChanges: prefsHasChanges,
    isSaving,
    loadFromMain,
    setDraft,
    save,
    discard,
    resetToDefaults,
  } = usePreferencesStore()
  const { bookmarks, resetBookmarks } = useBookmarksStore()

  const hasChanges = prefsHasChanges || walletDirty

  // Load settings on mount
  useEffect(() => {
    loadFromMain()
  }, [loadFromMain])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current) clearTimeout(clearTimeoutRef.current)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      if (historyErrorTimerRef.current) clearTimeout(historyErrorTimerRef.current)
    }
  }, [])

  // Handlers
  const handleSelectFolder = async () => {
    try {
      const result = await window.electron.storage.selectDownloadFolder()
      if (result.success && result.path) {
        setDraft('downloadPath', result.path)
      }
    } catch (error) {
      log.error('Failed to select folder:', error)
    }
  }

  const handleClearData = async () => {
    setClearing(true)
    setCleared(false)
    try {
      await window.electron.clearBrowsingData()
      setCleared(true)
      clearTimeoutRef.current = setTimeout(() => setCleared(false), UI_NOTIFICATION_TIMEOUT_MS)
    } finally {
      setClearing(false)
    }
  }

  const handleExportBookmarks = () => {
    const data = JSON.stringify(bookmarks, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ton-browser-bookmarks.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleResetBookmarks = () => {
    resetBookmarks()
  }

  const handleResetAll = () => {
    if (pendingReset) {
      resetToDefaults()
      setPendingReset(false)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    } else {
      setPendingReset(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => setPendingReset(false), UI_NOTIFICATION_TIMEOUT_MS)
    }
  }

  const handleSave = async () => {
    await save()
    if (walletSectionRef.current?.hasChanges) {
      await walletSectionRef.current.save()
    }
  }

  const handleDiscard = () => {
    discard()
    walletSectionRef.current?.discard()
  }

  const handleHistoryModeChange = async (newMode: string) => {
    setChangingHistoryMode(true)
    try {
      const result = await window.electron.history.changeMode(newMode)
      if (result.success) {
        setDraft('historyMode', newMode as 'memory' | 'persistent')
      } else {
        setHistoryError(`Failed to change history mode: ${result.error}`)
        if (historyErrorTimerRef.current) clearTimeout(historyErrorTimerRef.current)
        historyErrorTimerRef.current = setTimeout(() => setHistoryError(null), UI_ERROR_TIMEOUT_MS)
      }
    } catch (error) {
      setHistoryError(`Error changing history mode: ${(error as Error).message}`)
      if (historyErrorTimerRef.current) clearTimeout(historyErrorTimerRef.current)
      historyErrorTimerRef.current = setTimeout(() => setHistoryError(null), UI_ERROR_TIMEOUT_MS)
    } finally {
      setChangingHistoryMode(false)
    }
  }

  // Render content based on active section
  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSection draft={draft} setDraft={setDraft} />

      case 'network':
        return <NetworkSection draft={draft} setDraft={setDraft} />

      case 'storage':
        return (
          <StorageSection draft={draft} setDraft={setDraft} isLoaded={isLoaded} onSelectFolder={handleSelectFolder} />
        )

      case 'appearance':
        return <AppearanceSection draft={draft} setDraft={setDraft} />

      case 'privacy':
        return (
          <PrivacySection
            draft={draft}
            setDraft={setDraft}
            clearing={clearing}
            cleared={cleared}
            onClearData={handleClearData}
          />
        )

      case 'content-filtering':
        return <ContentFilteringSection draft={draft} setDraft={setDraft} />

      case 'history':
        return (
          <div>
            <HistorySection
              draft={draft}
              setDraft={setDraft}
              changingHistoryMode={changingHistoryMode}
              onHistoryModeChange={handleHistoryModeChange}
            />
            {historyError && <p className="mt-2 text-sm text-destructive px-1">{historyError}</p>}
          </div>
        )

      case 'shortcuts':
        return <ShortcutsSection />

      case 'bookmarks':
        return (
          <BookmarksSection
            bookmarksCount={bookmarks.length}
            onExport={handleExportBookmarks}
            onReset={handleResetBookmarks}
          />
        )

      case 'advanced':
        return (
          <AdvancedSection draft={draft} setDraft={setDraft} onResetAll={handleResetAll} pendingReset={pendingReset} />
        )

      case 'wallet':
        return <WalletSection onDirtyChange={setWalletDirty} sectionRef={walletSectionRef} />

      case 'about':
        return <AboutSection />

      default:
        return null
    }
  }

  return (
    <SettingsLayout
      sidebar={<SettingsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />}
      content={isLoaded ? renderContent() : <LoadingState />}
      actions={
        <SettingsActions hasChanges={hasChanges} isSaving={isSaving} onSave={handleSave} onDiscard={handleDiscard} />
      }
    />
  )
}
