// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createThemeFromBase } from '@/lib/theme-utils'
import { customThemeValue } from '../../model'
import { useThemeStore } from '../../store'
import { useThemeWorkspaceStore } from '../../workspace-store'
import { ThemePage } from '../ThemePage'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/logger', () => ({ createLogger: () => ({ error: vi.fn() }) }))

vi.mock('../ThemeLibrary', () => ({
  ThemeLibrary: ({
    disabled,
    selectedTheme,
    onSelect,
    onCreate,
    onImport,
  }: {
    disabled?: boolean
    selectedTheme: string
    onSelect: (theme: 'utya-duck') => void
    onCreate: () => void
    onImport: () => void
  }) => (
    <div data-testid="theme-library" data-disabled={String(Boolean(disabled))} data-selected={selectedTheme}>
      <button type="button" onClick={() => onSelect('utya-duck')}>
        select-utya
      </button>
      <button type="button" onClick={onCreate}>
        create-theme
      </button>
      <button type="button" onClick={onImport}>
        import-theme
      </button>
    </div>
  ),
}))
vi.mock('../ThemeWorkbench', () => ({
  ThemeWorkbench: ({
    choice,
    theme,
    isPreviewing,
    onPreview,
    onDelete,
  }: {
    choice: { customTheme?: { id: string } }
    theme: { name: string }
    isPreviewing: boolean
    onPreview: () => void
    onDelete: () => void
  }) => (
    <div
      data-testid="theme-workbench"
      data-theme-name={theme.name}
      data-previewing={String(isPreviewing)}
      data-menu-theme={choice.customTheme?.id ?? ''}
    >
      <button type="button" onClick={onPreview}>
        preview-theme
      </button>
      <button type="button" onClick={onDelete}>
        request-delete
      </button>
    </div>
  ),
}))
vi.mock('../ThemeStartPanel', () => ({ ThemeStartPanel: () => <div data-testid="theme-start" /> }))
vi.mock('../ThemeImportPanel', () => ({ ThemeImportPanel: () => <div data-testid="theme-import" /> }))

describe('ThemePage layout', () => {
  let container: HTMLDivElement
  let root: Root
  let themeId: string
  let theme: ReturnType<typeof createThemeFromBase>
  let deleteTheme: Mock<(themeId: string) => Promise<void>>
  let applyTheme: Mock<(theme: string) => Promise<void>>

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    theme = createThemeFromBase('resistance-dog', 'Inline editor')
    themeId = theme.id
    const value = customThemeValue(theme.id)
    deleteTheme = vi.fn().mockResolvedValue(undefined)
    applyTheme = vi.fn().mockResolvedValue(undefined)
    useThemeStore.setState({
      activeTheme: value,
      customThemes: [theme],
      isLoaded: true,
      loadError: '',
      isSaving: false,
      deleteTheme,
      applyTheme,
    })
    useThemeWorkspaceStore.setState({
      selectedTheme: value,
      selectionInitialized: true,
      workspace: 'library',
      editorDraft: theme,
      importJson: '',
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('opens the selected theme directly in the editor and keeps the library enabled', async () => {
    await act(async () => root.render(<ThemePage />))

    expect(container.querySelector('[data-testid="theme-library"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="theme-library"]')?.getAttribute('data-disabled')).toBe('false')
    expect(container.querySelector('[data-testid="theme-workbench"]')).not.toBeNull()
  })

  it('switches directly to another editable theme from the sidebar', async () => {
    await act(async () => root.render(<ThemePage />))
    const selectUtya = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'select-utya'
    )
    if (!selectUtya) throw new Error('Missing theme selection control')
    await act(async () => selectUtya.click())

    expect(container.querySelector('[data-testid="theme-library"]')?.getAttribute('data-selected')).toBe('utya-duck')
    expect(container.querySelector('[data-testid="theme-workbench"]')?.getAttribute('data-theme-name')).toContain(
      'appearance.theme.utyaDuck'
    )
  })

  it('confirms before a sidebar selection discards unsaved changes', async () => {
    await act(async () => root.render(<ThemePage />))
    await act(async () => useThemeWorkspaceStore.getState().updateEditorDraft({ ...theme, name: 'Unsaved theme name' }))

    const selectUtya = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'select-utya'
    )
    if (!selectUtya) throw new Error('Missing theme selection control')
    await act(async () => selectUtya.click())

    expect(container.querySelector('[data-testid="theme-library"]')?.getAttribute('data-selected')).toBe(
      customThemeValue(theme.id)
    )
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('actions.unsavedChanges')

    const discard = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'actions.discard'
    )
    if (!discard) throw new Error('Missing discard confirmation control')
    await act(async () => discard.click())

    expect(container.querySelector('[data-testid="theme-library"]')?.getAttribute('data-selected')).toBe('utya-duck')
  })

  it('uses the same discard guard before starting a new theme', async () => {
    await act(async () => root.render(<ThemePage />))
    await act(async () =>
      useThemeWorkspaceStore.getState().updateEditorDraft({ ...theme, description: 'Unsaved description' })
    )

    const createTheme = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'create-theme'
    )
    if (!createTheme) throw new Error('Missing create theme control')
    await act(async () => createTheme.click())

    expect(container.querySelector('[data-testid="theme-start"]')).toBeNull()
    const discard = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (button) => button.textContent === 'actions.discard'
    )
    if (!discard) throw new Error('Missing discard confirmation control')
    await act(async () => discard.click())

    expect(container.querySelector('[data-testid="theme-start"]')).not.toBeNull()
  })

  it('does not expose persisted-theme menu actions for a transient edit draft', async () => {
    useThemeWorkspaceStore.setState({ workspace: 'edit', editorDraft: { ...theme, colors: { ...theme.colors } } })
    await act(async () => root.render(<ThemePage />))

    expect(container.querySelector('[data-testid="theme-workbench"]')?.getAttribute('data-menu-theme')).toBe('')
  })

  it('toggles temporary preview without persisting the active theme', async () => {
    await act(async () => root.render(<ThemePage />))
    const preview = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'preview-theme'
    )
    if (!preview) throw new Error('Missing preview control')
    await act(async () => preview.click())

    expect(container.querySelector('[data-testid="theme-workbench"]')?.getAttribute('data-previewing')).toBe('true')
    expect(applyTheme).not.toHaveBeenCalled()
  })

  it('opens the existing modal pattern and deletes after explicit confirmation', async () => {
    await act(async () => root.render(<ThemePage />))

    const requestDelete = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'request-delete'
    )
    if (!requestDelete) throw new Error('Missing delete request control')
    await act(async () => requestDelete.click())

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('appearance.customThemes.deleteConfirm')
    expect(dialog?.querySelector('h2')?.className).toContain('text-center')
    expect(dialog?.querySelector('p')?.className).toContain('text-center')
    expect(dialog?.querySelector('svg')).toBeNull()

    const confirm = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'common:buttons.delete'
    )
    if (!confirm) throw new Error('Missing delete confirmation control')
    await act(async () => confirm.click())

    expect(deleteTheme).toHaveBeenCalledWith(themeId)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
