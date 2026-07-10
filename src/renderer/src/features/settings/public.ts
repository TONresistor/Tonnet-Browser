import { usePreferencesStore } from './preferences-store'

export const useSeedingEnabled = () => usePreferencesStore((state) => state.draft.seedingEnabled)
export const useSetPreferenceDraft = () => usePreferencesStore((state) => state.setDraft)
export const useSavePreferences = () => usePreferencesStore((state) => state.save)
export const useShowBookmarksBar = () => usePreferencesStore((state) => state.saved.showBookmarksBar)
export const useShowStatusBar = () => usePreferencesStore((state) => state.saved.showStatusBar)
export const useTabOrientation = () => usePreferencesStore((state) => state.saved.tabOrientation)
export const useSavedSidebarWidth = () => usePreferencesStore((state) => state.saved.sidebarWidth)
export const useMessengerNetworkEnabled = () => usePreferencesStore((state) => state.saved.messengerNetworkEnabled)
