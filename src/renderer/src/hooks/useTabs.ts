/**
 * Hook for tab management.
 * Wraps the tabs store with actions.
 */

import { useTabsStore } from '../stores/tabs'

export function useTabs() {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, updateTab, duplicateTab, closeOtherTabs } = useTabsStore()

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // IPC listeners are handled in App.tsx to avoid duplicates

  return {
    tabs,
    activeTab,
    activeTabId,
    addTab,
    closeTab,
    setActiveTab,
    updateTab,
    duplicateTab,
    closeOtherTabs,
  }
}
