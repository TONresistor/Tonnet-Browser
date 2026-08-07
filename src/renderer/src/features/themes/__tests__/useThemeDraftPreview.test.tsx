// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomTheme } from '@shared/types'
import { RESISTANCE_DOG_COLORS, UTYA_DUCK_COLORS } from '@/lib/theme-utils'
import { useThemeDraftPreview } from '../useThemeDraftPreview'
import { useThemeStore } from '../store'

vi.mock('@/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

const draft: CustomTheme = {
  id: 'draft-theme',
  name: 'Draft theme',
  colors: { ...UTYA_DUCK_COLORS, primary: '120 60% 45%' },
  isDark: false,
  createdAt: 1,
  updatedAt: 1,
}

describe('useThemeDraftPreview', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    document.documentElement.style.cssText = ''
    document.documentElement.setAttribute('data-theme', 'resistance-dog')
    useThemeStore.setState({ activeTheme: 'resistance-dog', customThemes: [] })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.documentElement.style.cssText = ''
    document.documentElement.removeAttribute('data-theme')
    vi.unstubAllGlobals()
  })

  it('applies the draft only during explicit preview and restores the persisted selection', async () => {
    function Harness({ enabled }: { enabled: boolean }) {
      useThemeDraftPreview(draft, enabled)
      return null
    }

    await act(async () => root.render(<Harness enabled={false} />))
    expect(document.documentElement.dataset.theme).toBe('resistance-dog')

    await act(async () => root.render(<Harness enabled />))

    expect(document.documentElement.dataset.theme).toBe('custom:draft-theme')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(draft.colors.primary)

    await act(async () => root.render(<Harness enabled={false} />))

    expect(document.documentElement.dataset.theme).toBe('resistance-dog')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  })

  it('restores the latest persisted custom theme after editing', async () => {
    const persisted: CustomTheme = {
      ...draft,
      id: 'persisted-theme',
      colors: { ...RESISTANCE_DOG_COLORS, primary: '280 70% 52%' },
      isDark: true,
    }
    useThemeStore.setState({ activeTheme: 'custom:persisted-theme', customThemes: [persisted] })

    function Harness() {
      useThemeDraftPreview(draft, true)
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => root.unmount())

    expect(document.documentElement.dataset.theme).toBe('custom:persisted-theme')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(persisted.colors.primary)

    root = createRoot(container)
  })
})
