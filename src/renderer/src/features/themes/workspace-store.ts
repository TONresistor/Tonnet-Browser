import { create } from 'zustand'
import type { CustomTheme } from '@shared/types'
import type { ThemeType } from '@shared/defaults'

export type ThemeWorkspaceKind = 'library' | 'new' | 'import' | 'edit'

interface ThemeWorkspaceState {
  selectedTheme: ThemeType
  selectionInitialized: boolean
  workspace: ThemeWorkspaceKind
  editorDraft: CustomTheme | null
  importJson: string
  initializeSelection: (theme: ThemeType) => void
  selectTheme: (theme: ThemeType, draft?: CustomTheme | null) => void
  showNewTheme: () => void
  showImport: () => void
  editTheme: (theme: CustomTheme) => void
  updateEditorDraft: (theme: CustomTheme) => void
  updateImportJson: (json: string) => void
  backToLibrary: () => void
  finishSave: (theme: ThemeType) => void
}

export const useThemeWorkspaceStore = create<ThemeWorkspaceState>()((set, get) => ({
  selectedTheme: 'resistance-dog',
  selectionInitialized: false,
  workspace: 'library',
  editorDraft: null,
  importJson: '',

  initializeSelection: (theme) => {
    if (get().selectionInitialized) return
    set({ selectedTheme: theme, selectionInitialized: true })
  },
  selectTheme: (theme, draft = null) =>
    set({
      selectedTheme: theme,
      selectionInitialized: true,
      workspace: 'library',
      editorDraft: draft ? { ...draft, colors: { ...draft.colors } } : null,
    }),
  showNewTheme: () => set({ workspace: 'new', editorDraft: null }),
  showImport: () => set({ workspace: 'import', editorDraft: null }),
  editTheme: (theme) => set({ workspace: 'edit', editorDraft: { ...theme, colors: { ...theme.colors } } }),
  updateEditorDraft: (theme) => set({ editorDraft: theme }),
  updateImportJson: (json) => set({ importJson: json }),
  backToLibrary: () => set({ workspace: 'library', editorDraft: null, importJson: '' }),
  finishSave: (theme) =>
    set({ selectedTheme: theme, workspace: 'library', editorDraft: null, importJson: '', selectionInitialized: true }),
}))
