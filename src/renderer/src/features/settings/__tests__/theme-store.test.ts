import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsSchema } from '@shared/types'
import type { SettingsChangedEvent } from '@shared/ipc-events'

const mocks = vi.hoisted(() => ({
  listener: null as ((event: SettingsChangedEvent) => void) | null,
  set: vi.fn(),
  onChanged: vi.fn((listener: (event: SettingsChangedEvent) => void) => {
    mocks.listener = listener
    return vi.fn()
  }),
}))

vi.mock('@/features/settings/client', () => ({
  settingsClient: {
    getAll: vi.fn(),
    set: mocks.set,
    isAvailable: vi.fn(() => true),
    onChanged: mocks.onChanged,
  },
}))

vi.mock('@/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

describe('theme store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.listener = null
    mocks.set.mockResolvedValue({ success: true })
  })

  it('clears custom theme state after a canonical settings reset', async () => {
    const { createThemeFromBase } = await import('@/lib/theme-utils')
    const { useThemeStore } = await import('../theme-store')
    const theme = createThemeFromBase('resistance-dog', 'Custom')
    useThemeStore.setState({
      customThemes: [theme],
      editingTheme: theme,
      previewColors: theme.colors,
      isLoaded: true,
    })

    mocks.listener?.({ reset: true, settings: AppSettingsSchema.parse({}) })

    expect(useThemeStore.getState()).toMatchObject({
      customThemes: [],
      editingTheme: null,
      previewColors: null,
      isLoaded: true,
    })
  })

  it('preserves an active theme draft after unrelated settings changes', async () => {
    const { createThemeFromBase } = await import('@/lib/theme-utils')
    const { useThemeStore } = await import('../theme-store')
    const theme = createThemeFromBase('resistance-dog', 'Custom')
    const previewColors = { ...theme.colors, primary: '#123456' }
    const editingTheme = { ...theme, name: 'Unsaved name' }
    useThemeStore.setState({ customThemes: [theme], editingTheme, previewColors, isLoaded: true })

    mocks.listener?.({
      category: 'appearance',
      values: { sidebarWidth: 300 },
      settings: AppSettingsSchema.parse({ appearance: { sidebarWidth: 300, customThemes: [theme] } }),
    })

    expect(useThemeStore.getState()).toMatchObject({ customThemes: [theme], editingTheme, previewColors })
  })

  it('removes an empty optional description before persistence', async () => {
    const { createThemeFromBase } = await import('@/lib/theme-utils')
    const { useThemeStore } = await import('../theme-store')
    const theme = { ...createThemeFromBase('resistance-dog', 'Custom'), description: 'Old description' }
    useThemeStore.setState({ customThemes: [theme], editingTheme: theme, isLoaded: true })

    useThemeStore.getState().updateTheme(theme.id, { description: undefined })
    await useThemeStore.getState().saveToSettings()

    expect(useThemeStore.getState().customThemes[0]).not.toHaveProperty('description')
    expect(mocks.set).toHaveBeenCalledWith(
      'appearance',
      expect.objectContaining({ customThemes: [expect.not.objectContaining({ description: undefined })] })
    )
  })

  it('reports persistence failures to the editor caller', async () => {
    mocks.set.mockRejectedValueOnce(new Error('disk full'))
    const { useThemeStore } = await import('../theme-store')

    await expect(useThemeStore.getState().saveToSettings()).rejects.toThrow('disk full')
  })

  it('persists an imported theme without an optional description', async () => {
    const { createThemeFromBase } = await import('@/lib/theme-utils')
    const { useThemeStore } = await import('../theme-store')
    const base = createThemeFromBase('resistance-dog', 'Base')

    const imported = useThemeStore
      .getState()
      .importTheme(JSON.stringify({ name: 'Imported', isDark: base.isDark, colors: base.colors }))

    expect(imported).not.toBeNull()
    expect(imported).not.toHaveProperty('description')
    await vi.waitFor(() => expect(mocks.set).toHaveBeenCalled())
    const customThemes = mocks.set.mock.calls[0][1].customThemes
    expect(customThemes[0]).not.toHaveProperty('description')
  })
})
