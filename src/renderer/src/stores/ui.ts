/**
 * UI store.
 * Transient UI state that should survive component remounts within a session
 * but reset on app restart. Not persisted.
 */

import { create } from 'zustand'
import type { SettingsSection } from '@/components/settings/types'

export type WalletAccountTab = 'main' | 'cocoon'

interface UIState {
  settingsActiveSection: SettingsSection
  setSettingsActiveSection: (section: SettingsSection) => void
  /** Which account view is currently shown on ton://wallet and the wallet sidebar. */
  walletAccountTab: WalletAccountTab
  setWalletAccountTab: (tab: WalletAccountTab) => void
}

export const useUIStore = create<UIState>((set) => ({
  settingsActiveSection: 'general',
  setSettingsActiveSection: (section) => set({ settingsActiveSection: section }),
  walletAccountTab: 'main',
  setWalletAccountTab: (tab) => set({ walletAccountTab: tab }),
}))
