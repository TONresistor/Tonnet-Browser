// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESISTANCE_DOG_COLORS, UTYA_DUCK_COLORS } from '@/lib/theme-utils'
import type { ThemeChoice } from '../types'
import { ThemeLibrary } from '../ThemeLibrary'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'appearance.theme.label': 'Themes',
        'appearance.customThemes.title': 'Custom themes',
        'themePage.newTheme': 'New theme',
        'themePage.builtInThemes': 'Built-in themes',
        'themePage.activeTheme': 'Active theme',
        'themeEditor.list.darkTheme': 'Dark theme',
        'themeEditor.list.lightTheme': 'Light theme',
        'themeEditor.list.noThemes': 'No custom themes',
        'common:buttons.import': 'Import',
      })[key] ?? key,
  }),
}))

const choices: ThemeChoice[] = [
  {
    value: 'resistance-dog',
    name: 'Resistance Dog',
    colors: RESISTANCE_DOG_COLORS,
    isDark: true,
  },
  {
    value: 'utya-duck',
    name: 'Utya Duck',
    colors: UTYA_DUCK_COLORS,
    isDark: false,
  },
  {
    value: 'custom:custom-one',
    name: 'Custom One',
    colors: RESISTANCE_DOG_COLORS,
    isDark: true,
    customTheme: {
      id: 'custom-one',
      name: 'Custom One',
      colors: RESISTANCE_DOG_COLORS,
      isDark: true,
      createdAt: 1,
      updatedAt: 1,
    },
  },
]

describe('ThemeLibrary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function renderLibrary(overrides: Partial<React.ComponentProps<typeof ThemeLibrary>> = {}) {
    const props: React.ComponentProps<typeof ThemeLibrary> = {
      choices,
      selectedTheme: 'utya-duck',
      activeTheme: 'resistance-dog',
      onSelect: vi.fn(),
      onCreate: vi.fn(),
      onImport: vi.fn(),
      ...overrides,
    }
    await act(async () => root.render(<ThemeLibrary {...props} />))
    return props
  }

  it('moves the applied theme into a dedicated first group while keeping selection distinct', async () => {
    await renderLibrary()

    const listbox = container.querySelector('[role="listbox"]')
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    const headings = Array.from(container.querySelectorAll('h3')).map((heading) => heading.textContent)

    expect(listbox?.getAttribute('aria-label')).toBe('Themes')
    expect(headings).toEqual(['Active theme', 'Built-in themes', 'Custom themes'])
    expect(options).toHaveLength(3)
    expect(options[0].dataset.themeValue).toBe('resistance-dog')
    expect(options[0].getAttribute('aria-selected')).toBe('false')
    expect(options[0].textContent).not.toContain('Active')
    expect(options[1].getAttribute('aria-selected')).toBe('true')
    expect(options[1].tabIndex).toBe(0)
    expect(options[0].tabIndex).toBe(-1)
  })

  it('shows an active custom theme only once and removes the empty custom section', async () => {
    await renderLibrary({ activeTheme: 'custom:custom-one' })

    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    expect(options[0].dataset.themeValue).toBe('custom:custom-one')
    expect(options.filter((option) => option.textContent?.includes('Custom One'))).toHaveLength(1)
    expect(Array.from(container.querySelectorAll('h3')).map((heading) => heading.textContent)).toEqual([
      'Active theme',
      'Built-in themes',
    ])
  })

  it('uses roving focus for Arrow, Home and End navigation', async () => {
    await renderLibrary()
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))

    await act(async () => {
      options[1].focus()
      options[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(options[2])
    expect(options[2].tabIndex).toBe(0)

    await act(async () => {
      options[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(document.activeElement).toBe(options[0])

    await act(async () => {
      options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(document.activeElement).toBe(options[2])
  })

  it('keeps every option out of the tab order while the rail is disabled', async () => {
    await renderLibrary({ disabled: true })

    const listbox = container.querySelector('[role="listbox"]')
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    expect(listbox?.getAttribute('aria-disabled')).toBe('true')
    expect(options.every((option) => option.disabled && option.tabIndex === -1)).toBe(true)
  })
})
