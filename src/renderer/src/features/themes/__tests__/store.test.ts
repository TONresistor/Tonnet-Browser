import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsSchema } from '@shared/types'
import type { AppearanceSettings } from '@shared/types'
import type { SettingsChangedEvent } from '@shared/ipc-events'

const mocks = vi.hoisted(() => ({
  listener: null as ((event: SettingsChangedEvent) => void) | null,
  getAppearance: vi.fn(),
  applyAppearance: vi.fn(),
}))

vi.mock('../client', () => ({
  themeClient: {
    isAvailable: () => true,
    getAppearance: mocks.getAppearance,
    applyAppearance: mocks.applyAppearance,
    onChanged: (listener: (event: SettingsChangedEvent) => void) => {
      mocks.listener = listener
      return vi.fn()
    },
  },
}))

vi.mock('@/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

describe('theme store transactions', () => {
  let appearance: AppearanceSettings

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.listener = null
    appearance = AppSettingsSchema.parse({}).appearance
    mocks.getAppearance.mockImplementation(async () => appearance)
    mocks.applyAppearance.mockImplementation(async (patch: Partial<AppearanceSettings>) => {
      appearance = { ...appearance, ...patch }
      return appearance
    })
  })

  it('keeps load failures visible and allows a clean retry', async () => {
    mocks.getAppearance.mockRejectedValueOnce(new Error('appearance unavailable'))
    const { useThemeStore } = await import('../store')

    await useThemeStore.getState().load()
    expect(useThemeStore.getState()).toMatchObject({
      isLoaded: false,
      loadError: 'appearance unavailable',
    })

    await useThemeStore.getState().load()
    expect(useThemeStore.getState()).toMatchObject({
      isLoaded: true,
      loadError: null,
      activeTheme: appearance.theme,
    })
  })

  it('does not persist a newly-created draft until saveTheme is called', async () => {
    const { createThemeFromBase } = await import('@/lib/theme-utils')
    const { useThemeStore } = await import('../store')
    const draft = createThemeFromBase('resistance-dog', 'Draft')

    expect(mocks.applyAppearance).not.toHaveBeenCalled()
    await useThemeStore.getState().saveTheme(draft)

    expect(mocks.applyAppearance).toHaveBeenCalledOnce()
    expect(mocks.applyAppearance).toHaveBeenCalledWith({ customThemes: [expect.objectContaining({ id: draft.id })] })
  })

  it('removes an active custom theme and selects the fallback in one settings write', async () => {
    const { createThemeFromBase } = await import('@/lib/theme-utils')
    const { customThemeValue } = await import('../model')
    const { useThemeStore } = await import('../store')
    const theme = createThemeFromBase('resistance-dog', 'Active')
    useThemeStore.setState({ activeTheme: customThemeValue(theme.id), customThemes: [theme], isLoaded: true })

    await useThemeStore.getState().deleteTheme(theme.id)

    expect(mocks.applyAppearance).toHaveBeenCalledWith({ customThemes: [], theme: 'resistance-dog' })
    expect(useThemeStore.getState()).toMatchObject({ activeTheme: 'resistance-dog', customThemes: [] })
  })

  it('rejects applying an unknown custom theme before crossing the IPC boundary', async () => {
    const { useThemeStore } = await import('../store')

    await expect(useThemeStore.getState().applyTheme('custom:missing')).rejects.toThrow('not in the library')
    expect(mocks.applyAppearance).not.toHaveBeenCalled()
  })

  it('converges on the canonical appearance after Reset All', async () => {
    const { createThemeFromBase } = await import('@/lib/theme-utils')
    const { useThemeStore } = await import('../store')
    const theme = createThemeFromBase('utya-duck', 'Temporary')
    useThemeStore.setState({ activeTheme: `custom:${theme.id}`, customThemes: [theme], isLoaded: true })

    mocks.listener?.({ reset: true, settings: AppSettingsSchema.parse({}) })

    expect(useThemeStore.getState()).toMatchObject({
      activeTheme: 'resistance-dog',
      customThemes: [],
      isLoaded: true,
    })
  })
})
