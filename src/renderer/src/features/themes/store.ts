import { create } from 'zustand'
import type { CustomTheme } from '@shared/types'
import type { ThemeType } from '@shared/defaults'
import { errorMessage } from '@shared/errors'
import { createLogger } from '@/logger'
import { parseCustomThemeId } from '@/lib/theme-utils'
import { themeClient } from './client'
import { removeTheme, upsertTheme } from './model'

const log = createLogger('themes')
let loadRequest: Promise<void> | null = null

interface ThemeState {
  activeTheme: ThemeType
  customThemes: CustomTheme[]
  isLoaded: boolean
  loadError: string | null
  isSaving: boolean
  load: () => Promise<void>
  applyTheme: (theme: ThemeType) => Promise<void>
  saveTheme: (theme: CustomTheme) => Promise<void>
  deleteTheme: (themeId: string) => Promise<void>
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  activeTheme: 'resistance-dog',
  customThemes: [],
  isLoaded: false,
  loadError: null,
  isSaving: false,

  load: async () => {
    if (get().isLoaded) return
    if (loadRequest) return loadRequest
    set({ loadError: null })
    loadRequest = (async () => {
      try {
        const appearance = await themeClient.getAppearance()
        set({
          activeTheme: appearance.theme as ThemeType,
          customThemes: appearance.customThemes,
          isLoaded: true,
          loadError: null,
        })
      } catch (error) {
        log.error('Failed to load themes:', error)
        set({ isLoaded: false, loadError: errorMessage(error) })
      } finally {
        loadRequest = null
      }
    })()
    return loadRequest
  },

  applyTheme: async (theme) => {
    const customId = parseCustomThemeId(theme)
    if (customId && !get().customThemes.some((candidate) => candidate.id === customId)) {
      throw new Error('Cannot apply a custom theme that is not in the library')
    }
    set({ isSaving: true })
    try {
      const appearance = await themeClient.applyAppearance({ theme })
      set({ activeTheme: appearance.theme as ThemeType, customThemes: appearance.customThemes, isSaving: false })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },

  saveTheme: async (theme) => {
    set({ isSaving: true })
    try {
      const appearance = await themeClient.applyAppearance({ customThemes: upsertTheme(get().customThemes, theme) })
      set({ activeTheme: appearance.theme as ThemeType, customThemes: appearance.customThemes, isSaving: false })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },

  deleteTheme: async (themeId) => {
    const next = removeTheme(get().customThemes, get().activeTheme, themeId)
    set({ isSaving: true })
    try {
      const appearance = await themeClient.applyAppearance({
        customThemes: next.customThemes,
        ...(next.activeTheme === get().activeTheme ? {} : { theme: next.activeTheme }),
      })
      set({ activeTheme: appearance.theme as ThemeType, customThemes: appearance.customThemes, isSaving: false })
    } catch (error) {
      set({ isSaving: false })
      throw error
    }
  },
}))

if (themeClient.isAvailable()) {
  const unsubscribe = themeClient.onChanged((change) => {
    if (!change.settings) {
      void useThemeStore.getState().load()
      return
    }
    if (!change.reset && change.category !== 'appearance') return
    useThemeStore.setState({
      activeTheme: change.settings.appearance.theme as ThemeType,
      customThemes: change.settings.appearance.customThemes,
      isLoaded: true,
      loadError: null,
    })
  })
  const hot = import.meta.hot
  if (hot) hot.dispose(() => unsubscribe())
}
