// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESISTANCE_DOG_COLORS } from '@/lib/theme-utils'
import type { ThemeChoice } from '../types'
import { ThemeDetails } from '../ThemeDetails'

const overlay = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  handler: null as ((action: string, data: unknown) => void) | null,
}))

vi.mock('@/hooks/useOverlay', () => ({
  useOverlay: (_id: string, handler: (action: string, data: unknown) => void) => {
    overlay.handler = handler
    return { show: overlay.show, hide: overlay.hide }
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const builtInChoice: ThemeChoice = {
  value: 'resistance-dog',
  name: 'Resistance Dog',
  description: 'Dark default',
  colors: RESISTANCE_DOG_COLORS,
  isDark: true,
}

const customChoice: ThemeChoice = {
  ...builtInChoice,
  value: 'custom:enterprise',
  name: 'Enterprise',
  customTheme: {
    id: 'enterprise',
    name: 'Enterprise',
    colors: RESISTANCE_DOG_COLORS,
    isDark: true,
    createdAt: 1,
    updatedAt: 1,
  },
}

describe('ThemeDetails', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    overlay.show.mockClear()
    overlay.hide.mockClear()
    overlay.handler = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function renderDetails(
    choice: ThemeChoice,
    overrides: Partial<React.ComponentProps<typeof ThemeDetails>> = {}
  ) {
    const props: React.ComponentProps<typeof ThemeDetails> = {
      choice,
      activeTheme: 'utya-duck',
      isSaving: false,
      isPreviewing: false,
      onApply: vi.fn(),
      onPreview: vi.fn(),
      onDuplicate: vi.fn(),
      onExport: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    }
    await act(async () => root.render(<ThemeDetails {...props} />))
    return props
  }

  it('replaces Customize with an explicit preview action', async () => {
    const props = await renderDetails(builtInChoice)
    const preview = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'themeEditor.editor.preview'
    )
    if (!preview) throw new Error('Missing preview action')

    expect(preview.getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toContain('themePage.customize')
    await act(async () => preview.click())
    expect(props.onPreview).toHaveBeenCalledOnce()
  })

  it('omits the active state from the header and keeps only the relevant action', async () => {
    await renderDetails(builtInChoice, { activeTheme: 'resistance-dog' })

    expect(container.textContent).not.toContain('themePage.active')
    expect(container.textContent).not.toContain('themePage.useTheme')
    expect(container.textContent).toContain('themeEditor.editor.preview')
  })

  it('shows only the theme description below the title and omits the line when it is empty', async () => {
    await renderDetails(customChoice)

    const subtitle = container.querySelector('header p')
    expect(subtitle?.textContent).toBe('Dark default')
    expect(container.textContent).not.toContain('appearance.customThemes.title')
    expect(container.textContent).not.toContain('themeEditor.list.darkTheme')
    expect(container.textContent).not.toContain('·')

    await renderDetails({ ...customChoice, description: undefined })
    expect(container.querySelector('header p')).toBeNull()
  })

  it('moves custom theme utilities into the shared overlay menu', async () => {
    const props = await renderDetails(customChoice)
    const more = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
    if (!more) throw new Error('Missing theme action menu button')

    await act(async () => more.click())

    expect(overlay.show).toHaveBeenCalledOnce()
    const content = overlay.show.mock.calls[0][1] as { type: string; items: Array<Record<string, unknown>> }
    expect(content.type).toBe('menu')
    expect(content.items.map((item) => item.id)).toEqual(['duplicate', 'export', 'separator', 'delete'])
    expect(content.items.at(-1)).toMatchObject({ destructive: true })

    overlay.handler?.('duplicate', {})
    expect(props.onDuplicate).toHaveBeenCalledOnce()
    expect(overlay.hide).toHaveBeenCalledOnce()
  })

  it('routes the custom theme delete action from the overflow menu', async () => {
    const props = await renderDetails(customChoice)
    const more = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
    if (!more) throw new Error('Missing theme action menu button')

    await act(async () => more.click())
    overlay.handler?.('delete', {})

    expect(props.onDelete).toHaveBeenCalledOnce()
    expect(overlay.hide).toHaveBeenCalledOnce()
  })
})
