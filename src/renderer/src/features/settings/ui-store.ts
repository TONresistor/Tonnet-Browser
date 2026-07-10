/**
 * UI store.
 * Transient UI state that should survive component remounts within a session
 * but reset on app restart. Not persisted.
 */

import { create } from 'zustand'
import type { SettingsSection } from '@/features/settings/components/types'

interface UIState {
  settingsActiveSection: SettingsSection
  setSettingsActiveSection: (section: SettingsSection) => void
}

export const useUIStore = create<UIState>((set) => ({
  settingsActiveSection: 'general',
  setSettingsActiveSection: (section) => set({ settingsActiveSection: section }),
}))
