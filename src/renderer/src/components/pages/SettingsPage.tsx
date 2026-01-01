/**
 * Settings page.
 * Configure general, network, storage, and privacy settings.
 */

import { useState, useEffect, useRef } from 'react'
import {
  Settings,
  Globe,
  Wifi,
  HardDrive,
  Palette,
  Keyboard,
  Bookmark,
  Wrench,
  Info,
  FolderOpen,
  Trash2,
  CheckCircle,
  RotateCcw,
  ExternalLink,
  Save,
  X,
  Plus,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePreferencesStore, defaultPreferences } from '@/stores/preferences'
import { useBookmarksStore } from '@/stores/bookmarks'
import { useThemeStore } from '@/stores/themes'
import { APP_NAME, APP_VERSION, DEFAULT_BOOKMARKS } from '@shared/constants'
import { ThemeEditor, ThemeList, ImportDialog, ExportDialog } from '@/components/theme-editor'
import type { BuiltInTheme } from '@shared/defaults'
import tonLogo from '@/assets/ton.png'

type SettingsSection =
  | 'general'
  | 'network'
  | 'storage'
  | 'appearance'
  | 'privacy'
  | 'shortcuts'
  | 'bookmarks'
  | 'advanced'
  | 'about'

const SECTIONS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: Globe },
  { id: 'network', label: 'Network', icon: Wifi },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'privacy', label: 'Privacy', icon: Trash2 },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
  { id: 'about', label: 'About', icon: Info },
]

const SHORTCUTS = [
  { action: 'New tab', shortcut: 'Ctrl+T' },
  { action: 'Close tab', shortcut: 'Ctrl+W' },
  { action: 'Focus address bar', shortcut: 'Ctrl+L' },
  { action: 'Reload', shortcut: 'Ctrl+R / F5' },
  { action: 'Back', shortcut: 'Alt+←' },
  { action: 'Forward', shortcut: 'Alt+→' },
  { action: 'Stop loading', shortcut: 'Escape' },
  { action: 'Zoom in', shortcut: 'Ctrl++' },
  { action: 'Zoom out', shortcut: 'Ctrl+-' },
  { action: 'Reset zoom', shortcut: 'Ctrl+0' },
  { action: 'Developer tools', shortcut: 'F12' },
]

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  // Ref for timeout cleanup to prevent memory leaks on unmount
  const clearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { draft, isLoaded, hasChanges, isSaving, loadFromMain, setDraft, save, discard, resetToDefaults } = usePreferencesStore()
  const { bookmarks, resetBookmarks } = useBookmarksStore()

  // Load settings from main process on mount or when becoming active
  useEffect(() => {
    // Always reload when component mounts to ensure fresh data
    loadFromMain()
  }, [loadFromMain])

  // Cleanup timeout on unmount to prevent state updates on unmounted component
  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current) {
        clearTimeout(clearTimeoutRef.current)
      }
    }
  }, [])

  const handleSelectFolder = async () => {
    try {
      const result = await window.electron.storage.selectDownloadFolder()
      if (result.success && result.path) {
        setDraft('downloadPath', result.path)
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
    }
  }

  const handleClearData = async () => {
    setClearing(true)
    setCleared(false)
    try {
      await window.electron.clearBrowsingData()
      setCleared(true)
      // Store timeout ref so it can be cleaned up on unmount
      clearTimeoutRef.current = setTimeout(() => setCleared(false), 3000)
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
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      resetToDefaults()
    }
  }

  const handleSave = async () => {
    await save()
  }

  const handleDiscard = () => {
    discard()
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralSection draft={draft} setDraft={setDraft} />
      case 'network':
        return <NetworkSection draft={draft} setDraft={setDraft} />
      case 'storage':
        return (
          <StorageSection
            draft={draft}
            setDraft={setDraft}
            isLoaded={isLoaded}
            onSelectFolder={handleSelectFolder}
          />
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
        return <AdvancedSection draft={draft} setDraft={setDraft} onResetAll={handleResetAll} />
      case 'about':
        return <AboutSection />
      default:
        return null
    }
  }

  return (
    <div className="flex h-full bg-background-secondary flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-56 border-r border-border p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-6">
            <Settings className="h-6 w-6 text-primary" />
            <h2 className="text-foreground text-xl font-bold">Settings</h2>
          </div>

          <nav className="space-y-2">
            {SECTIONS.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-full text-sm transition-all duration-200 backdrop-blur-md border',
                    isActive
                      ? 'bg-surface-active border-border-strong text-foreground'
                      : 'bg-surface/50 border-border hover:bg-surface-hover'
                  )}
                >
                  <Icon className={cn('h-4 w-4', !isActive && 'text-muted-foreground')} />
                  <span className={!isActive ? 'text-muted-foreground' : ''}>{section.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl mx-auto">
            {!isLoaded ? (
              <div className="flex items-center justify-center h-full py-20">
                <div className="text-muted-foreground">Loading settings...</div>
              </div>
            ) : (
              renderContent()
            )}
          </div>
        </div>
      </div>

      {/* Save Bar - appears when there are unsaved changes */}
      {hasChanges && (
        <div className="px-6 py-3 flex items-center justify-between bg-surface/50 backdrop-blur-lg border-t border-border">
          <p className="text-muted-foreground text-sm">You have unsaved changes</p>
          <div className="flex gap-3">
            <button
              onClick={handleDiscard}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground disabled:opacity-50 bg-surface-hover backdrop-blur-md border border-border-medium"
            >
              <X className="h-4 w-4" />
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 bg-primary/90 backdrop-blur-md shadow-[0_4px_16px_var(--primary-glow),inset_0_1px_0_var(--button-highlight)] text-white"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ Section Components ============

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-xl font-semibold text-foreground mb-1">{title}</h3>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <div className="flex-1 pr-4">
        <p className="text-foreground font-medium">{label}</p>
        {description && <p className="text-muted-foreground text-sm mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-11 h-6 rounded-full transition-colors relative border-2',
        checked
          ? 'bg-primary border-primary'
          : 'bg-border/50 border-border'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-all duration-200',
          checked ? 'left-5 bg-primary-foreground' : 'bg-foreground'
        )}
      />
    </button>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-24 px-3 py-1.5 rounded-full text-sm text-foreground text-right outline-none bg-surface-hover border border-border-medium"
      />
      {suffix && <span className="text-muted-foreground text-sm">{suffix}</span>}
    </div>
  )
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="pl-4 pr-8 py-1.5 rounded-full text-sm text-foreground outline-none cursor-pointer bg-surface-hover border border-border-medium"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-background text-foreground">
          {opt.label}
        </option>
      ))}
    </select>
  )
}

// ============ Section Props ============

import type { AppPreferences } from '@/stores/preferences'

interface SectionProps {
  draft: AppPreferences
  setDraft: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void
}

// ============ Sections ============

function GeneralSection({ draft, setDraft }: SectionProps) {
  return (
    <div>
      <SectionHeader
        title="General"
        description="Basic browser settings"
      />

      {/* Anonymous Mode Section */}
      <div className="bg-card rounded-xl border border-border px-4">
        {/* Anonymous mode toggle */}
        <div className="py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <p className="text-foreground font-medium">Anonymous mode</p>
              <p className="text-muted-foreground text-sm mt-0.5">Route traffic through 3-hop garlic circuit</p>
            </div>
            <Toggle
              checked={draft.anonymousMode}
              onChange={(v) => setDraft('anonymousMode', v)}
              label="Enable anonymous mode"
            />
          </div>
        </div>

        {/* Circuit rotation - visible when anonymous mode is ON */}
        {draft.anonymousMode && (
          <>
            <div className="py-4 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-foreground font-medium">Circuit rotation</p>
                  <p className="text-muted-foreground text-sm mt-0.5">Automatically change circuit for better privacy</p>
                </div>
                <Toggle
                  checked={draft.circuitRotation}
                  onChange={(v) => setDraft('circuitRotation', v)}
                  label="Enable circuit rotation"
                />
              </div>
            </div>

            {draft.circuitRotation && (
              <div className="py-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-foreground font-medium">Rotation interval</p>
                    <p className="text-muted-foreground text-sm mt-0.5">How often to build a new circuit</p>
                  </div>
                  <select
                    value={draft.rotateInterval}
                    onChange={(e) => setDraft('rotateInterval', e.target.value)}
                    className="pl-4 pr-8 py-1.5 rounded-full text-sm text-foreground outline-none cursor-pointer bg-surface-hover border border-border-medium"
                  >
                    <option value="5m" className="bg-background text-foreground">5 minutes</option>
                    <option value="10m" className="bg-background text-foreground">10 minutes</option>
                    <option value="15m" className="bg-background text-foreground">15 minutes</option>
                    <option value="30m" className="bg-background text-foreground">30 minutes</option>
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        {/* How it works - Garlic Routing Diagram */}
        <GarlicRoutingDiagram />
      </div>

      {/* Other General Settings */}
      <div className="mt-6 bg-card rounded-xl border border-border px-4">
        <SettingRow label="Homepage" description="Page to show when opening a new tab">
          <SelectInput
            value={draft.homepage}
            onChange={(v) => setDraft('homepage', v)}
            options={[
              { value: 'ton://start', label: 'Start Page' },
              { value: 'ton://storage', label: 'TON Storage' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Restore tabs" description="Reopen previous tabs on startup">
          <Toggle
            checked={draft.restoreTabs}
            onChange={(v) => setDraft('restoreTabs', v)}
            label="Restore tabs on startup"
          />
        </SettingRow>
      </div>
    </div>
  )
}

function NetworkSection({ draft, setDraft }: SectionProps) {
  return (
    <div>
      <SectionHeader
        title="Network"
        description="Proxy and connection settings"
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Proxy port" description="Local port for TON proxy">
          <NumberInput
            value={draft.proxyPort}
            onChange={(v) => setDraft('proxyPort', v)}
            min={1024}
            max={65535}
          />
        </SettingRow>
        <SettingRow label="Storage API port" description="Local port for storage daemon">
          <NumberInput
            value={draft.storagePort}
            onChange={(v) => setDraft('storagePort', v)}
            min={1024}
            max={65535}
          />
        </SettingRow>
        <SettingRow label="Auto-connect" description="Connect to TON Network on startup">
          <Toggle
            checked={draft.autoConnect}
            onChange={(v) => setDraft('autoConnect', v)}
            label="Auto-connect to network"
          />
        </SettingRow>
        <SettingRow label="Connection timeout" description="Max time to wait for proxy startup">
          <NumberInput
            value={draft.connectionTimeout}
            onChange={(v) => setDraft('connectionTimeout', v)}
            min={10}
            max={120}
            suffix="sec"
          />
        </SettingRow>
        <SettingRow label="Sync check interval" description="How often to check DHT sync status">
          <NumberInput
            value={draft.syncCheckInterval}
            onChange={(v) => setDraft('syncCheckInterval', v)}
            min={1000}
            max={10000}
            step={500}
            suffix="ms"
          />
        </SettingRow>
      </div>
    </div>
  )
}

function StorageSection({
  draft,
  setDraft,
  isLoaded,
  onSelectFolder,
}: SectionProps & {
  isLoaded: boolean
  onSelectFolder: () => void
}) {
  return (
    <div>
      <SectionHeader
        title="TON Storage"
        description="Configure decentralized storage settings"
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Download folder" description="Where TON Storage files are saved">
          <div className="flex items-center gap-2">
            <div className="max-w-[200px] px-3 py-1.5 rounded-full text-sm text-muted-foreground truncate bg-surface-hover border border-border-medium">
              {!isLoaded ? 'Loading...' : draft.downloadPath || 'Not set'}
            </div>
            <button
              onClick={onSelectFolder}
              className="shrink-0 p-2 rounded-full transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium text-foreground-muted"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Update interval" description="How often to refresh download stats">
          <NumberInput
            value={draft.storagePollingInterval}
            onChange={(v) => setDraft('storagePollingInterval', v)}
            min={500}
            max={10000}
            step={500}
            suffix="ms"
          />
        </SettingRow>
      </div>
    </div>
  )
}

function AppearanceSection({ draft, setDraft }: SectionProps) {
  const builtInThemes = [
    { value: 'resistance-dog', label: 'Resistance Dog', description: 'Dark blue theme (default)', color: 'bg-[#5288c1]' },
    { value: 'utya-duck', label: 'Utya Duck', description: 'Bright yellow theme', color: 'bg-[#FFE600]' },
  ]

  // Theme store
  const {
    customThemes,
    createTheme,
    deleteTheme,
    duplicateTheme,
    exportTheme,
    importTheme,
  } = useThemeStore()

  // Local state for modals
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [exportData, setExportData] = useState<{ json: string; name: string } | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)

  // Handle create new theme
  const handleCreateTheme = (base: 'resistance-dog' | 'utya-duck') => {
    const theme = createTheme(base, `Custom Theme ${customThemes.length + 1}`)
    setShowCreateMenu(false)
    setEditingThemeId(theme.id)
  }

  // Handle select custom theme
  const handleSelectCustomTheme = (themeId: string) => {
    setDraft('theme', `custom:${themeId}`)
  }

  // Handle export
  const handleExport = (themeId: string) => {
    const json = exportTheme(themeId)
    const theme = customThemes.find((t) => t.id === themeId)
    if (json && theme) {
      setExportData({ json, name: theme.name })
    }
  }

  // Handle import
  const handleImport = (json: string): boolean => {
    const theme = importTheme(json)
    return theme !== null
  }

  // Handle delete with confirmation
  const handleDelete = (themeId: string) => {
    const theme = customThemes.find((t) => t.id === themeId)
    if (theme && confirm(`Delete "${theme.name}"?`)) {
      // If this theme is currently selected, switch to default
      if (draft.theme === `custom:${themeId}`) {
        setDraft('theme', 'resistance-dog')
      }
      deleteTheme(themeId)
    }
  }

  // Handle theme editor save
  const handleEditorSave = () => {
    setEditingThemeId(null)
    // If we edited a custom theme and it's the current one, it will auto-apply
  }

  return (
    <div>
      <SectionHeader
        title="Appearance"
        description="Customize how the browser looks"
      />

      {/* Built-in themes */}
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Theme" description="Choose color scheme">
          <div className="flex gap-2">
            {builtInThemes.map((theme) => (
              <button
                key={theme.value}
                onClick={() => setDraft('theme', theme.value as BuiltInTheme)}
                className={cn(
                  'flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors min-w-[100px]',
                  draft.theme === theme.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 bg-background-secondary'
                )}
              >
                <div className={cn('w-8 h-8 rounded-full', theme.color)} />
                <span className="text-xs text-foreground">{theme.label}</span>
              </button>
            ))}
          </div>
        </SettingRow>
      </div>

      {/* Custom themes section */}
      <div className="mt-6 bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Custom Themes</h4>
            <p className="text-xs text-muted-foreground mt-0.5">Create and manage your own themes</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowImportDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors bg-surface hover:bg-surface-hover"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
            <div className="relative">
              <button
                onClick={() => setShowCreateMenu(!showCreateMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Create
              </button>
              {showCreateMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowCreateMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                    <button
                      onClick={() => handleCreateTheme('resistance-dog')}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover transition-colors"
                    >
                      Based on Dark theme
                    </button>
                    <button
                      onClick={() => handleCreateTheme('utya-duck')}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover transition-colors"
                    >
                      Based on Light theme
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <ThemeList
          themes={customThemes}
          selectedThemeId={draft.theme}
          onEdit={setEditingThemeId}
          onDelete={handleDelete}
          onDuplicate={duplicateTheme}
          onExport={handleExport}
          onSelect={handleSelectCustomTheme}
        />
      </div>

      {/* Other appearance settings */}
      <div className="mt-6 bg-card rounded-xl border border-border px-4">
        <SettingRow label="Default zoom" description="Initial zoom level for pages">
          <NumberInput
            value={draft.defaultZoom}
            onChange={(v) => setDraft('defaultZoom', v)}
            min={30}
            max={300}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label="Minimum zoom" description="Lowest allowed zoom level">
          <NumberInput
            value={draft.zoomMin}
            onChange={(v) => setDraft('zoomMin', v)}
            min={10}
            max={100}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label="Maximum zoom" description="Highest allowed zoom level">
          <NumberInput
            value={draft.zoomMax}
            onChange={(v) => setDraft('zoomMax', v)}
            min={100}
            max={500}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label="Show bookmarks bar" description="Display quick access bookmarks">
          <Toggle
            checked={draft.showBookmarksBar}
            onChange={(v) => setDraft('showBookmarksBar', v)}
            label="Show bookmarks bar"
          />
        </SettingRow>
        <SettingRow label="Show status bar" description="Display connection status at bottom">
          <Toggle
            checked={draft.showStatusBar}
            onChange={(v) => setDraft('showStatusBar', v)}
            label="Show status bar"
          />
        </SettingRow>
      </div>

      {/* Theme Editor Modal */}
      {editingThemeId && (
        <ThemeEditor
          themeId={editingThemeId}
          onClose={() => setEditingThemeId(null)}
          onSave={handleEditorSave}
        />
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <ImportDialog
          onImport={handleImport}
          onClose={() => setShowImportDialog(false)}
        />
      )}

      {/* Export Dialog */}
      {exportData && (
        <ExportDialog
          themeJson={exportData.json}
          themeName={exportData.name}
          onClose={() => setExportData(null)}
        />
      )}
    </div>
  )
}

function PrivacySection({
  draft,
  setDraft,
  clearing,
  cleared,
  onClearData,
}: SectionProps & {
  clearing: boolean
  cleared: boolean
  onClearData: () => void
}) {
  return (
    <div>
      <SectionHeader
        title="Privacy"
        description="Privacy and data settings"
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow
          label="Clear browsing data"
          description="Delete cache, cookies, and local storage"
        >
          <button
            onClick={onClearData}
            disabled={clearing}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 disabled:opacity-50 bg-destructive/90 shadow-[0_4px_16px_var(--destructive-glow)] text-white"
          >
            {clearing ? (
              'Clearing...'
            ) : cleared ? (
              <>
                <CheckCircle className="h-4 w-4" /> Done
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> Clear
              </>
            )}
          </button>
        </SettingRow>
        <SettingRow
          label="Clear on exit"
          description="Automatically clear data when closing browser"
        >
          <Toggle
            checked={draft.clearOnExit}
            onChange={(v) => setDraft('clearOnExit', v)}
            label="Clear data when closing browser"
          />
        </SettingRow>
      </div>
    </div>
  )
}

function ShortcutsSection() {
  return (
    <div>
      <SectionHeader
        title="Keyboard Shortcuts"
        description="Quick actions for power users"
      />
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">
                Action
              </th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-medium">
                Shortcut
              </th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((item, idx) => (
              <tr
                key={item.action}
                className={idx !== SHORTCUTS.length - 1 ? 'border-b border-border/50' : ''}
              >
                <td className="px-4 py-3 text-foreground text-sm">{item.action}</td>
                <td className="px-4 py-3 text-right">
                  <kbd className="px-2 py-1 bg-background-secondary rounded text-primary text-xs font-mono">
                    {item.shortcut}
                  </kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BookmarksSection({
  bookmarksCount,
  onExport,
  onReset,
}: {
  bookmarksCount: number
  onExport: () => void
  onReset: () => void
}) {
  return (
    <div>
      <SectionHeader
        title="Bookmarks"
        description="Manage your saved sites"
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow
          label="Saved bookmarks"
          description="Number of bookmarks in your library"
        >
          <span className="text-foreground font-medium">{bookmarksCount}</span>
        </SettingRow>
        <SettingRow
          label="Export bookmarks"
          description="Download bookmarks as JSON file"
        >
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
          >
            <ExternalLink className="h-4 w-4" />
            Export
          </button>
        </SettingRow>
        <SettingRow
          label="Reset bookmarks"
          description="Restore default bookmarks"
        >
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-neutral-500/15 border border-neutral-500/30 text-neutral-400 hover:text-neutral-300"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </SettingRow>
      </div>
    </div>
  )
}

function AdvancedSection({ draft, setDraft, onResetAll }: SectionProps & { onResetAll: () => void }) {
  return (
    <div>
      <SectionHeader
        title="Advanced"
        description="Settings for developers and power users"
      />
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Proxy verbosity" description="Logging level for proxy daemon">
          <SelectInput
            value={String(draft.proxyVerbosity)}
            onChange={(v) => setDraft('proxyVerbosity', Number(v))}
            options={[
              { value: '0', label: 'Silent' },
              { value: '1', label: 'Errors only' },
              { value: '2', label: 'Normal' },
              { value: '3', label: 'Verbose' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Storage verbosity" description="Logging level for storage daemon">
          <SelectInput
            value={String(draft.storageVerbosity)}
            onChange={(v) => setDraft('storageVerbosity', Number(v))}
            options={[
              { value: '0', label: 'Silent' },
              { value: '1', label: 'Errors only' },
              { value: '2', label: 'Normal' },
              { value: '3', label: 'Verbose' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Sync test domain" description="Domain used to verify DHT sync">
          <input
            value={draft.syncTestDomain}
            onChange={(e) => setDraft('syncTestDomain', e.target.value)}
            placeholder="tonnet-sync-check.ton"
            className="w-40 px-3 py-1.5 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
          />
        </SettingRow>
      </div>

      <div className="mt-6">
        <button
          onClick={onResetAll}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 bg-destructive/15 border border-destructive/30 text-destructive hover:bg-destructive/25"
        >
          <RotateCcw className="h-4 w-4" />
          Reset all settings to defaults
        </button>
      </div>
    </div>
  )
}

// Simple colors for the diagram - using CSS custom property for theme support
const DIAGRAM_COLOR = 'rgba(255, 255, 255, 0.5)'
const DIAGRAM_COLOR_ACTIVE = 'rgba(255, 255, 255, 0.8)'

function GarlicRoutingDiagram() {
  const [relayIds, setRelayIds] = useState([
    Math.floor(Math.random() * 100) + 1,
    Math.floor(Math.random() * 100) + 1,
    Math.floor(Math.random() * 100) + 1,
  ])
  const [phase, setPhase] = useState<'forward' | 'backward'>('forward')
  const [step, setStep] = useState(0) // 0-4 for forward, 0-4 for backward
  const [isPlaying, setIsPlaying] = useState(false)
  const [circuitCount, setCircuitCount] = useState(0) // Track completed circuits

  // Animation cycle - only runs when playing
  useEffect(() => {
    if (!isPlaying) return

    const interval = setInterval(() => {
      setStep((prevStep) => {
        if (prevStep >= 4) {
          return -1 // Signal to switch phase
        }
        return prevStep + 1
      })
    }, 700)

    return () => clearInterval(interval)
  }, [isPlaying])

  // Handle phase switch when step reaches -1
  useEffect(() => {
    if (step === -1) {
      setPhase((prevPhase) => {
        if (prevPhase === 'backward') {
          // Completed one full circuit (forward + backward)
          const newCount = circuitCount + 1
          setCircuitCount(newCount)

          // Stop after 2 circuits
          if (newCount >= 2) {
            setIsPlaying(false)
            setCircuitCount(0)
            setStep(0)
            return 'forward'
          }

          // New circuit - generate new relay IDs (rotation)
          setRelayIds([
            Math.floor(Math.random() * 100) + 1,
            Math.floor(Math.random() * 100) + 1,
            Math.floor(Math.random() * 100) + 1,
          ])
        }
        return prevPhase === 'forward' ? 'backward' : 'forward'
      })
      if (isPlaying) setStep(0)
    }
  }, [step, circuitCount, isPlaying])

  // Start/stop animation
  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false)
      setStep(0)
      setPhase('forward')
      setCircuitCount(0)
    } else {
      setCircuitCount(0)
      setPhase('forward')
      setStep(0)
      setIsPlaying(true)
    }
  }


  // Check if segment is active (packet has passed through)
  const isSegmentActive = (segmentIndex: number) => {
    if (!isPlaying) return true // Static: all segments visible
    if (phase === 'forward') {
      return step > segmentIndex
    } else {
      // Backward: segments activate from right to left
      const reversedIndex = 3 - segmentIndex
      return step > reversedIndex
    }
  }

  // Check if node is current position
  const isNodeActive = (nodeIndex: number) => {
    if (!isPlaying) return true // Static: all nodes visible
    if (phase === 'forward') {
      return step === nodeIndex
    } else {
      // Backward: node 0=You is at step 4, node 4=.ton is at step 0
      return step === (4 - nodeIndex)
    }
  }

  // Check if relay has been passed
  const isRelayPassed = (relayIndex: number) => {
    if (!isPlaying) return true // Static: all relays visible
    const nodeIndex = relayIndex + 1
    if (phase === 'forward') {
      return step > nodeIndex
    } else {
      return step > (4 - nodeIndex)
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-foreground text-base font-semibold">How it works</p>
        <button
          onClick={handlePlayPause}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all bg-surface-hover border border-border-medium text-foreground-secondary"
        >
          {isPlaying ? (
            <>
              <span className="w-2 h-2 flex items-center justify-center">▪</span>
              Stop
            </>
          ) : (
            <>
              <span className="w-2 h-2 flex items-center justify-center">▶</span>
              Play
            </>
          )}
        </button>
      </div>
      <p className="text-muted-foreground text-base mb-5 leading-relaxed">
        Your traffic is encrypted in 3 layers and routed through independent relays. Each relay only knows its immediate neighbors, never the full path.
      </p>

      {/* SVG Diagram */}
      <div className="relative h-24 w-full">
        <svg className="w-full h-full" viewBox="0 0 500 96" preserveAspectRatio="xMidYMid meet">
          {/* Connection lines */}
          {[0, 1, 2, 3].map((i) => {
            const x1 = 50 + i * 100
            const x2 = 50 + (i + 1) * 100
            const isActive = isSegmentActive(i)

            return (
              <g key={`segment-${i}`}>
                {/* Background line */}
                <line
                  x1={x1 + 18}
                  y1={36}
                  x2={x2 - 18}
                  y2={36}
                  stroke="rgba(255, 255, 255, 0.1)"
                  strokeWidth="2"
                />
                {/* Active line */}
                <line
                  x1={x1 + 18}
                  y1={36}
                  x2={x2 - 18}
                  y2={36}
                  stroke={DIAGRAM_COLOR}
                  strokeWidth="2"
                  style={{
                    opacity: isActive ? 1 : 0,
                    transition: 'opacity 0.3s ease',
                  }}
                />
                {/* Direction arrow - only when playing */}
                {isPlaying && isActive && (
                  <polygon
                    points={phase === 'forward'
                      ? `${x2 - 22},32 ${x2 - 22},40 ${x2 - 14},36`
                      : `${x1 + 22},32 ${x1 + 22},40 ${x1 + 14},36`
                    }
                    fill={DIAGRAM_COLOR}
                  />
                )}
              </g>
            )
          })}

          {/* Nodes */}
          {/* You node */}
          <g>
            <text x="50" y="12" textAnchor="middle" fill="rgba(255, 255, 255, 0.9)" fontSize="12" fontWeight="600">
              You
            </text>
            <circle
              cx="50"
              cy="36"
              r="16"
              fill={isNodeActive(0) ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)'}
              stroke={isNodeActive(0) ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)'}
              strokeWidth="2"
              style={{ transition: 'all 0.3s ease' }}
            />
            {isPlaying && (
              <text x="50" y="68" textAnchor="middle" fill="rgba(255, 255, 255, 0.5)" fontSize="11">
                {phase === 'forward' ? 'encrypts' : 'decrypts'}
              </text>
            )}
          </g>

          {/* Relay nodes */}
          {[0, 1, 2].map((i) => {
            const cx = 150 + i * 100
            const isPassed = isRelayPassed(i)
            const isActive = isNodeActive(i + 1)

            // Action text: forward = decrypt/peel, backward = encrypt/wrap
            const actionText = phase === 'forward' ? 'peels' : 'wraps'

            return (
              <g key={`relay-${i}`}>
                <circle
                  cx={cx}
                  cy={36}
                  r="16"
                  fill={isActive || isPassed ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.04)'}
                  stroke={isActive || isPassed ? DIAGRAM_COLOR : 'rgba(255, 255, 255, 0.15)'}
                  strokeWidth="2"
                  style={{ transition: 'all 0.3s ease' }}
                />
                <text x={cx} y="68" textAnchor="middle" fill="rgba(255, 255, 255, 0.6)" fontSize="11">
                  Relay {relayIds[i]}
                </text>
                {isPlaying && (isActive || isPassed) && (
                  <text x={cx} y="84" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontSize="10">
                    {actionText}
                  </text>
                )}
              </g>
            )
          })}

          {/* .ton node */}
          <g>
            <text x="450" y="12" textAnchor="middle" fill="rgba(255, 255, 255, 0.9)" fontSize="12" fontWeight="600">
              .ton
            </text>
            <circle
              cx="450"
              cy="36"
              r="16"
              fill={isNodeActive(4) ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)'}
              stroke={isNodeActive(4) ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.2)'}
              strokeWidth="2"
              style={{ transition: 'all 0.3s ease' }}
            />
            {isPlaying && (
              <text x="450" y="68" textAnchor="middle" fill="rgba(255, 255, 255, 0.5)" fontSize="11">
                {phase === 'forward' ? 'receives' : 'responds'}
              </text>
            )}
          </g>

          {/* Animated packet - only when playing */}
          {isPlaying && (
            <circle
              cx={phase === 'forward' ? 50 + step * 100 : 450 - step * 100}
              cy={36}
              r="6"
              fill={DIAGRAM_COLOR_ACTIVE}
              style={{
                transition: 'cx 0.6s ease-in-out',
              }}
            />
          )}
        </svg>
      </div>

      <p className="text-xs text-muted-foreground/60 text-center mt-4">
        New circuit every rotation
      </p>
    </div>
  )
}

function AboutSection() {
  return (
    <div>
      <SectionHeader title="About" />
      <div className="bg-card rounded-xl border border-border p-6 text-center">
        <div className="w-16 h-16 mx-auto mb-4">
          <img src={tonLogo} alt="TON" className="w-full h-full object-contain" />
        </div>
        <h3 className="text-2xl font-bold text-foreground mb-1">{APP_NAME}</h3>
        <p className="text-muted-foreground mb-4">Version {APP_VERSION}</p>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          A privacy-focused browser for the TON Network. Browse .ton websites securely
          through the decentralized network.
        </p>

        <div className="mt-6 pt-6 border-t border-border">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Electron</p>
              <p className="text-foreground font-mono">{window.electron?.versions?.electron || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Chromium</p>
              <p className="text-foreground font-mono">{window.electron?.versions?.chrome || 'N/A'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Node.js</p>
              <p className="text-foreground font-mono">{window.electron?.versions?.node || 'N/A'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
          onClick={() => window.electron.navigate('http://github.com/example/ton-browser')}
        >
          <ExternalLink className="h-4 w-4" />
          GitHub
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
          onClick={() => window.electron.navigate('http://documentations.ton')}
        >
          <ExternalLink className="h-4 w-4" />
          TON Docs
        </button>
      </div>
    </div>
  )
}
