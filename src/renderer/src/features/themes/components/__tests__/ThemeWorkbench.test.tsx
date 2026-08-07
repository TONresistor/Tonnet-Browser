// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomTheme } from '@shared/types'
import { THEME_TOKEN_KEYS } from '@shared/theme-tokens'
import { RESISTANCE_DOG_COLORS } from '@/lib/theme-utils'
import { ThemeWorkbench } from '../ThemeWorkbench'

vi.mock('@/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../ThemeColorField', () => ({
  ThemeColorField: ({ description }: { description: string }) => (
    <div data-testid="theme-color-field" data-description={description} />
  ),
}))

vi.mock('../ThemeDetails', () => ({
  ThemeDetails: () => <div data-testid="theme-details-header" />,
}))

const initialTheme: CustomTheme = {
  id: 'workbench-test',
  name: 'Workbench test',
  description: 'Initial description',
  colors: { ...RESISTANCE_DOG_COLORS },
  isDark: true,
  createdAt: 1,
  updatedAt: 1,
}

const choice = {
  value: 'custom:workbench-test' as const,
  name: initialTheme.name,
  description: initialTheme.description,
  colors: initialTheme.colors,
  isDark: initialTheme.isDark,
  customTheme: initialTheme,
}

const chromeProps = {
  choice,
  activeTheme: 'resistance-dog' as const,
  isPreviewing: false,
  canApply: true,
  onApply: vi.fn(),
  onPreview: vi.fn(),
  onDuplicate: vi.fn(),
  onExport: vi.fn(),
  onDelete: vi.fn(),
}

describe('ThemeWorkbench', () => {
  let container: HTMLDivElement
  let root: Root
  const onBack = vi.fn()
  const onSave = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onBack.mockClear()
    onSave.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function renderWorkbench() {
    function Harness() {
      const [theme, setTheme] = useState(initialTheme)
      return (
        <ThemeWorkbench
          {...chromeProps}
          theme={theme}
          originalTheme={initialTheme}
          isSaving={false}
          onChange={setTheme}
          onSave={onSave}
          onBack={onBack}
        />
      )
    }

    await act(async () => root.render(<Harness />))
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === label)
    if (!match) throw new Error(`Missing button: ${label}`)
    return match
  }

  function changeInput(input: HTMLInputElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!nativeSetter) throw new Error('Missing native input value setter')
    nativeSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('enables save only after a real edit', async () => {
    await renderWorkbench()
    expect(container.querySelector('.theme-preview-pane')).toBeNull()
    expect(container.textContent).not.toContain('themeEditor.editor.themeType')
    expect(container.textContent).not.toContain('themeEditor.editor.resetToBase')
    expect(container.textContent).not.toContain('themeEditor.editor.dark')
    expect(container.textContent).not.toContain('themeEditor.editor.light')
    const colorFields = Array.from(container.querySelectorAll('[data-testid="theme-color-field"]'))
    expect(colorFields).toHaveLength(THEME_TOKEN_KEYS.length)
    expect(colorFields.every((field) => field.getAttribute('data-description')?.endsWith('Desc'))).toBe(true)

    const save = button('themeEditor.editor.saveTheme')
    expect(save.disabled).toBe(true)

    const name = container.querySelector<HTMLInputElement>('input[value="Workbench test"]')
    if (!name) throw new Error('Missing theme name input')
    await act(async () => {
      changeInput(name, 'Updated theme')
    })

    expect(button('themeEditor.editor.saveTheme').disabled).toBe(false)
  })

  it('treats an unsaved draft as dirty before its first edit', async () => {
    await act(async () => {
      root.render(
        <ThemeWorkbench
          {...chromeProps}
          theme={initialTheme}
          originalTheme={null}
          isSaving={false}
          onChange={vi.fn()}
          onSave={onSave}
          onBack={onBack}
        />
      )
    })

    expect(button('themeEditor.editor.saveTheme').disabled).toBe(false)
    await act(async () => button('common:buttons.cancel').click())
    expect(onBack).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('actions.unsavedChanges')
  })

  it('keeps a restored draft dirty against the persisted theme', async () => {
    await act(async () => {
      root.render(
        <ThemeWorkbench
          {...chromeProps}
          theme={{ ...initialTheme, name: 'Restored unsaved draft' }}
          originalTheme={initialTheme}
          isSaving={false}
          onChange={vi.fn()}
          onSave={onSave}
          onBack={onBack}
        />
      )
    })

    expect(button('themeEditor.editor.saveTheme').disabled).toBe(false)
    await act(async () => button('common:buttons.cancel').click())
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('discards a dirty draft directly through Cancel', async () => {
    await renderWorkbench()
    const name = container.querySelector<HTMLInputElement>('input[value="Workbench test"]')
    if (!name) throw new Error('Missing theme name input')
    await act(async () => {
      changeInput(name, 'Unsaved theme')
    })

    await act(async () => button('common:buttons.cancel').click())
    expect(onBack).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain('actions.discard')
  })
})
