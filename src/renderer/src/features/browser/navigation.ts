import { useTabsStore } from '@/stores/tabs'

/** Public navigation facade. Feature modules never depend on the tab store itself. */
export const useAddBrowserTab = () => useTabsStore((state) => state.addTab)
export const useNavigateActiveBrowserTab = () => useTabsStore((state) => state.navigateActiveTab)
export const useOpenOrSwitchBrowserTab = () => useTabsStore((state) => state.openOrSwitchToTab)

export const browserNavigation = {
  addTab: (url?: string) => useTabsStore.getState().addTab(url),
  navigateActiveTab: (url: string) => useTabsStore.getState().navigateActiveTab(url),
}
