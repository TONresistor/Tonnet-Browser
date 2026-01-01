/**
 * Custom themes store.
 * Manages user-created themes.
 */

import { create } from 'zustand'
import type { CustomTheme, ThemeColors } from '@shared/types'
import {
  createThemeFromBase,
  exportThemeToJson,
  importThemeFromJson,
  generateThemeId,
} from '../lib/theme-utils'

interface ThemeStore {
  // Custom themes list
  customThemes: CustomTheme[]

  // Editor state
  editingTheme: CustomTheme | null
  previewColors: ThemeColors | null

  // Loading state
  isLoaded: boolean

  // CRUD operations
  createTheme: (base: 'resistance-dog' | 'utya-duck', name: string) => CustomTheme
  updateTheme: (id: string, updates: Partial<Omit<CustomTheme, 'id' | 'createdAt'>>) => void
  updateThemeColor: (id: string, colorKey: keyof ThemeColors, value: string) => void
  deleteTheme: (id: string) => void
  duplicateTheme: (id: string) => CustomTheme | null

  // Editor actions
  startEditing: (id: string) => void
  stopEditing: () => void
  setPreviewColors: (colors: ThemeColors | null) => void

  // Import/Export
  exportTheme: (id: string) => string | null
  importTheme: (json: string) => CustomTheme | null

  // Persistence
  loadFromSettings: () => Promise<void>
  saveToSettings: () => Promise<void>
}

export const useThemeStore = create<ThemeStore>()((set, get) => ({
  customThemes: [],
  editingTheme: null,
  previewColors: null,
  isLoaded: false,

  createTheme: (base, name) => {
    const theme = createThemeFromBase(base, name)
    set((state) => ({
      customThemes: [...state.customThemes, theme],
    }))
    // Auto-save after creation
    get().saveToSettings()
    return theme
  },

  updateTheme: (id, updates) => {
    set((state) => ({
      customThemes: state.customThemes.map((t) =>
        t.id === id
          ? { ...t, ...updates, updatedAt: Date.now() }
          : t
      ),
      editingTheme:
        state.editingTheme?.id === id
          ? { ...state.editingTheme, ...updates, updatedAt: Date.now() }
          : state.editingTheme,
    }))
  },

  updateThemeColor: (id, colorKey, value) => {
    set((state) => {
      const theme = state.customThemes.find((t) => t.id === id)
      if (!theme) return state

      const updatedColors = { ...theme.colors, [colorKey]: value }
      const updatedTheme = {
        ...theme,
        colors: updatedColors,
        updatedAt: Date.now(),
      }

      return {
        customThemes: state.customThemes.map((t) =>
          t.id === id ? updatedTheme : t
        ),
        editingTheme:
          state.editingTheme?.id === id ? updatedTheme : state.editingTheme,
        previewColors: state.editingTheme?.id === id ? updatedColors : state.previewColors,
      }
    })
  },

  deleteTheme: (id) => {
    set((state) => ({
      customThemes: state.customThemes.filter((t) => t.id !== id),
      editingTheme: state.editingTheme?.id === id ? null : state.editingTheme,
    }))
    get().saveToSettings()
  },

  duplicateTheme: (id) => {
    const { customThemes } = get()
    const original = customThemes.find((t) => t.id === id)
    if (!original) return null

    const now = Date.now()
    const duplicate: CustomTheme = {
      ...original,
      id: generateThemeId(),
      name: `${original.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
    }

    set((state) => ({
      customThemes: [...state.customThemes, duplicate],
    }))
    get().saveToSettings()
    return duplicate
  },

  startEditing: (id) => {
    const { customThemes } = get()
    const theme = customThemes.find((t) => t.id === id)
    if (theme) {
      set({
        editingTheme: { ...theme },
        previewColors: { ...theme.colors },
      })
    }
  },

  stopEditing: () => {
    set({
      editingTheme: null,
      previewColors: null,
    })
  },

  setPreviewColors: (colors) => {
    set({ previewColors: colors })
  },

  exportTheme: (id) => {
    const { customThemes } = get()
    const theme = customThemes.find((t) => t.id === id)
    if (!theme) return null
    return exportThemeToJson(theme)
  },

  importTheme: (json) => {
    const theme = importThemeFromJson(json)
    if (!theme) return null

    set((state) => ({
      customThemes: [...state.customThemes, theme],
    }))
    get().saveToSettings()
    return theme
  },

  loadFromSettings: async () => {
    try {
      const settings = await window.electron.settings.getAll()
      const customThemes = settings.appearance?.customThemes || []
      set({ customThemes, isLoaded: true })
    } catch (error) {
      console.error('[ThemeStore] Failed to load themes:', error)
      set({ isLoaded: true })
    }
  },

  saveToSettings: async () => {
    try {
      const { customThemes } = get()
      await window.electron.settings.set('appearance', { customThemes })
    } catch (error) {
      console.error('[ThemeStore] Failed to save themes:', error)
    }
  },
}))

// Note: loadFromSettings() is called from App.tsx useEffect
// to ensure consistent initialization with other stores
