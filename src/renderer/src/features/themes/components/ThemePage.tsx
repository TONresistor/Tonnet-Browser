import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { BuiltInTheme, ThemeType } from '@shared/defaults'
import type { CustomTheme } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { createThemeFromBase, exportThemeToJson, RESISTANCE_DOG_COLORS, UTYA_DUCK_COLORS } from '@/lib/theme-utils'
import { downloadTextFile } from '@/lib/download'
import { useThemeStore } from '../store'
import { customThemeValue, duplicateThemeDraft, isThemeDraftDirty } from '../model'
import { useThemeWorkspaceStore } from '../workspace-store'
import { ThemeLibrary } from './ThemeLibrary'
import { ThemeDeleteDialog } from './ThemeDeleteDialog'
import { ThemeDiscardDialog } from './ThemeDiscardDialog'
import { ThemeImportPanel } from './ThemeImportPanel'
import { ThemeStartPanel } from './ThemeStartPanel'
import { ThemeWorkbench } from './ThemeWorkbench'
import { Button } from '@/components/ui/button'
import type { ThemeChoice } from './types'
import { useTranslation } from 'react-i18next'
import './theme-page.css'

type PendingWorkspaceAction =
  | { kind: 'select'; theme: ThemeType }
  | { kind: 'new' }
  | { kind: 'import' }
  | { kind: 'duplicate'; theme: CustomTheme }

export function ThemePage() {
  const { t } = useTranslation('settings')
  const { activeTheme, customThemes, isLoaded, loadError, isSaving, load, applyTheme, saveTheme, deleteTheme } =
    useThemeStore()
  const {
    selectedTheme,
    selectionInitialized,
    workspace,
    editorDraft,
    importJson,
    initializeSelection,
    selectTheme,
    showNewTheme,
    showImport,
    editTheme,
    updateEditorDraft,
    updateImportJson,
    backToLibrary,
    finishSave,
  } = useThemeWorkspaceStore()
  const [mutationError, setMutationError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CustomTheme | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [pendingWorkspaceAction, setPendingWorkspaceAction] = useState<PendingWorkspaceAction | null>(null)

  useEffect(() => {
    if (!isLoaded && !loadError) void load()
  }, [isLoaded, load, loadError])

  const choices = useMemo<ThemeChoice[]>(
    () => [
      {
        value: 'resistance-dog',
        name: t('appearance.theme.resistanceDog'),
        description: t('appearance.theme.resistanceDogDesc'),
        colors: RESISTANCE_DOG_COLORS,
        isDark: true,
      },
      {
        value: 'utya-duck',
        name: t('appearance.theme.utyaDuck'),
        description: t('appearance.theme.utyaDuckDesc'),
        colors: UTYA_DUCK_COLORS,
        isDark: false,
      },
      ...customThemes.map((theme) => ({
        value: customThemeValue(theme.id),
        name: theme.name,
        description: theme.description,
        colors: theme.colors,
        isDark: theme.isDark,
        customTheme: theme,
      })),
    ],
    [customThemes, t]
  )

  const selectedChoice = choices.find((choice) => choice.value === selectedTheme) ?? choices[0]

  const createDraftForChoice = useCallback(
    (choice: ThemeChoice): CustomTheme => {
      if (choice.customTheme) return { ...choice.customTheme, colors: { ...choice.customTheme.colors } }
      if (choice.value !== 'resistance-dog' && choice.value !== 'utya-duck') {
        throw new Error(`Cannot edit unknown theme: ${choice.value}`)
      }
      const draft = createThemeFromBase(choice.value, `${choice.name} ${t('themePage.copySuffix')}`)
      return { ...draft, description: choice.description }
    },
    [t]
  )

  useEffect(() => {
    if (!isLoaded) return
    const fallback = choices.some((choice) => choice.value === activeTheme) ? activeTheme : 'resistance-dog'
    if (!selectionInitialized) {
      initializeSelection(fallback)
      return
    }

    const choice = choices.find((candidate) => candidate.value === selectedTheme)
    if (!choice) {
      selectTheme(fallback)
      return
    }
    if (workspace === 'library' && !editorDraft) updateEditorDraft(createDraftForChoice(choice))
  }, [
    activeTheme,
    choices,
    createDraftForChoice,
    editorDraft,
    initializeSelection,
    isLoaded,
    selectTheme,
    selectedTheme,
    selectionInitialized,
    updateEditorDraft,
    workspace,
  ])

  const paneChoice = useMemo<ThemeChoice>(() => {
    if (workspace === 'library' || !editorDraft) return selectedChoice
    return {
      value: customThemeValue(editorDraft.id),
      name: editorDraft.name,
      description: editorDraft.description,
      colors: editorDraft.colors,
      isDark: editorDraft.isDark,
    }
  }, [editorDraft, selectedChoice, workspace])

  const originalTheme = useMemo<CustomTheme | null>(() => {
    if (!editorDraft) return null
    if (workspace !== 'library') return customThemes.find((theme) => theme.id === editorDraft.id) ?? null
    if (selectedChoice.customTheme) return selectedChoice.customTheme
    return {
      ...editorDraft,
      name: `${selectedChoice.name} ${t('themePage.copySuffix')}`,
      description: selectedChoice.description,
      colors: { ...selectedChoice.colors },
      isDark: selectedChoice.isDark,
    }
  }, [customThemes, editorDraft, selectedChoice, t, workspace])

  const hasUnsavedChanges = editorDraft !== null && isThemeDraftDirty(editorDraft, originalTheme)

  const performWorkspaceAction = (action: PendingWorkspaceAction) => {
    setIsPreviewing(false)
    setMutationError('')
    if (action.kind === 'select') {
      const choice = choices.find((candidate) => candidate.value === action.theme)
      if (choice) selectTheme(action.theme, createDraftForChoice(choice))
      return
    }
    if (action.kind === 'new') {
      showNewTheme()
      return
    }
    if (action.kind === 'import') {
      showImport()
      return
    }
    editTheme(duplicateThemeDraft(action.theme, t('themePage.copySuffix')))
  }

  const requestWorkspaceAction = (action: PendingWorkspaceAction) => {
    if (hasUnsavedChanges) {
      setPendingWorkspaceAction(action)
      return
    }
    performWorkspaceAction(action)
  }

  const chooseBase = (base: BuiltInTheme) => {
    const theme = createThemeFromBase(base, `${t('themeEditor.customThemePrefix')} ${customThemes.length + 1}`)
    editTheme(theme)
  }

  const saveDraft = async (theme: CustomTheme) => {
    await saveTheme(theme)
    setIsPreviewing(false)
    finishSave(customThemeValue(theme.id))
  }

  const applySelected = async () => {
    setMutationError('')
    try {
      await applyTheme(selectedChoice.value)
      setIsPreviewing(false)
    } catch (applyError) {
      setMutationError(errorMessage(applyError))
    }
  }

  const removeSelected = async () => {
    const theme = deleteTarget
    if (!theme) return
    setMutationError('')
    try {
      await deleteTheme(theme.id)
      setIsPreviewing(false)
      selectTheme('resistance-dog')
    } catch (deleteError) {
      setMutationError(errorMessage(deleteError))
    } finally {
      setDeleteTarget(null)
    }
  }

  const exportSelected = () => {
    const theme = selectedChoice.customTheme
    if (!theme) return
    const fileName = `${
      theme.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'theme'
    }.json`
    downloadTextFile(exportThemeToJson(theme), fileName)
  }

  const selectFromLibrary = (theme: ThemeType) => {
    if (workspace === 'library' && theme === selectedTheme) return
    requestWorkspaceAction({ kind: 'select', theme })
  }

  const discardDraft = () => {
    setIsPreviewing(false)
    if (workspace === 'library') updateEditorDraft(createDraftForChoice(selectedChoice))
    else backToLibrary()
  }

  if (!isLoaded) {
    if (loadError) {
      return (
        <div className="grid h-full place-items-center bg-background-secondary p-6">
          <div className="w-full max-w-sm rounded-card border border-border-subtle bg-elevation-1 p-5 text-center">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <h1 className="mt-3 text-lg font-semibold text-heading">{t('appearance.theme.label')}</h1>
            <p role="alert" className="mt-1 text-sm text-muted-foreground">
              {loadError}
            </p>
            <Button onClick={() => void load()} className="mt-4">
              {t('common:buttons.retry')}
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div
        role="status"
        aria-live="polite"
        className="grid h-full grid-cols-[288px_minmax(0,1fr)] gap-6 bg-background-secondary p-3"
      >
        <span className="sr-only">{t('common:loading.settings')}</span>
        <div className="animate-pulse rounded-panel border border-border-subtle bg-elevation-1 shadow-panel" />
        <div className="mx-auto mt-10 h-80 w-full max-w-4xl animate-pulse rounded-card bg-elevation-1" />
      </div>
    )
  }

  return (
    <div className="theme-page-shell h-full overflow-hidden bg-background-secondary">
      {workspace === 'library' || workspace === 'edit' ? (
        <div className="theme-page-layout h-full min-h-0">
          <ThemeLibrary
            choices={choices}
            selectedTheme={selectedTheme}
            activeTheme={activeTheme}
            onSelect={selectFromLibrary}
            onCreate={() => requestWorkspaceAction({ kind: 'new' })}
            onImport={() => requestWorkspaceAction({ kind: 'import' })}
            disabled={isSaving}
          />

          <main className="theme-page-main theme-page-main--editor flex min-h-0 min-w-0 flex-col">
            {mutationError && (
              <p
                role="alert"
                className="mx-auto mt-4 w-[calc(100%-2rem)] max-w-[880px] shrink-0 rounded-control bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {mutationError}
              </p>
            )}
            {editorDraft && (
              <ThemeWorkbench
                choice={paneChoice}
                theme={editorDraft}
                originalTheme={originalTheme}
                activeTheme={activeTheme}
                isSaving={isSaving}
                isPreviewing={isPreviewing}
                canApply={workspace === 'library'}
                onChange={updateEditorDraft}
                onSave={saveDraft}
                onBack={discardDraft}
                onApply={() => void applySelected()}
                onPreview={() => setIsPreviewing((previewing) => !previewing)}
                onDuplicate={() => {
                  if (selectedChoice.customTheme)
                    requestWorkspaceAction({ kind: 'duplicate', theme: selectedChoice.customTheme })
                }}
                onExport={exportSelected}
                onDelete={() => setDeleteTarget(selectedChoice.customTheme ?? null)}
              />
            )}
          </main>
        </div>
      ) : (
        <main className="theme-page-workspace h-full min-h-0 overflow-y-auto p-5">
          {workspace === 'new' && <ThemeStartPanel onChoose={chooseBase} onBack={backToLibrary} />}
          {workspace === 'import' && (
            <ThemeImportPanel
              json={importJson}
              onJsonChange={updateImportJson}
              onReview={editTheme}
              onBack={backToLibrary}
            />
          )}
        </main>
      )}
      <ThemeDeleteDialog
        themeName={deleteTarget?.name ?? null}
        isDeleting={isSaving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void removeSelected()}
      />
      <ThemeDiscardDialog
        isOpen={pendingWorkspaceAction !== null}
        onCancel={() => setPendingWorkspaceAction(null)}
        onConfirm={() => {
          const action = pendingWorkspaceAction
          setPendingWorkspaceAction(null)
          if (action) performWorkspaceAction(action)
        }}
      />
    </div>
  )
}
