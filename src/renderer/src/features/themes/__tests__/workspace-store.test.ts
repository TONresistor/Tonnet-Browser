import { beforeEach, describe, expect, it } from 'vitest'
import { createThemeFromBase } from '@/lib/theme-utils'
import { useThemeWorkspaceStore } from '../workspace-store'

describe('theme workspace store', () => {
  beforeEach(() => {
    useThemeWorkspaceStore.setState({
      selectedTheme: 'resistance-dog',
      selectionInitialized: false,
      workspace: 'library',
      editorDraft: null,
      importJson: '',
    })
  })

  it('keeps the editor draft outside the page component lifecycle', () => {
    const theme = createThemeFromBase('resistance-dog', 'Draft')
    useThemeWorkspaceStore.getState().editTheme(theme)
    useThemeWorkspaceStore.getState().updateEditorDraft({ ...theme, name: 'Unsaved name' })

    expect(useThemeWorkspaceStore.getState()).toMatchObject({
      workspace: 'edit',
      editorDraft: expect.objectContaining({ id: theme.id, name: 'Unsaved name' }),
    })
  })

  it('only clears a draft through an explicit back action', () => {
    const theme = createThemeFromBase('utya-duck', 'Draft')
    useThemeWorkspaceStore.getState().editTheme(theme)
    useThemeWorkspaceStore.getState().backToLibrary()

    expect(useThemeWorkspaceStore.getState()).toMatchObject({ workspace: 'library', editorDraft: null })
  })

  it('opens a selected library theme with an editable draft in one action', () => {
    const theme = createThemeFromBase('resistance-dog', 'Direct editor')
    useThemeWorkspaceStore.getState().selectTheme('resistance-dog', theme)

    expect(useThemeWorkspaceStore.getState()).toMatchObject({
      selectedTheme: 'resistance-dog',
      selectionInitialized: true,
      workspace: 'library',
      editorDraft: expect.objectContaining({ id: theme.id, name: 'Direct editor' }),
    })
    expect(useThemeWorkspaceStore.getState().editorDraft).not.toBe(theme)
    expect(useThemeWorkspaceStore.getState().editorDraft?.colors).not.toBe(theme.colors)
  })
})
