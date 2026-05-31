/**
 * Hook for global keyboard shortcuts.
 * Ctrl/Cmd+T, Ctrl/Cmd+W, navigation, zoom, etc.
 */

import { useEffect } from 'react'
import { useTabsStore } from '@/stores/tabs'

export function useKeyboardShortcuts(openOrSwitchToTab: (url: string) => void): void {
  useEffect(() => {
    const { addTab, closeTab } = useTabsStore.getState()

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      // Ctrl/Cmd+T: New tab
      if (mod && !e.shiftKey && e.key === 't') {
        e.preventDefault()
        addTab()
      }
      // Ctrl/Cmd+Shift+T: Reopen last closed tab
      else if (mod && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        useTabsStore.getState().reopenLastClosedTab()
      }
      // Ctrl+Tab: Next tab (Ctrl even on macOS, same as Chrome)
      else if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
        e.preventDefault()
        useTabsStore.getState().nextTab()
      }
      // Ctrl+Shift+Tab: Previous tab (Ctrl even on macOS, same as Chrome)
      else if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault()
        useTabsStore.getState().previousTab()
      }
      // Ctrl/Cmd+1-9: Go to tab N
      else if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        useTabsStore.getState().goToTabByIndex(parseInt(e.key, 10))
      }
      // Ctrl/Cmd+H: History
      else if (mod && e.key === 'h') {
        e.preventDefault()
        openOrSwitchToTab('ton://history')
      }
      // Ctrl/Cmd+W: Close tab
      else if (mod && e.key === 'w') {
        e.preventDefault()
        const currentTabId = useTabsStore.getState().activeTabId
        if (currentTabId) {
          closeTab(currentTabId)
        }
      }
      // Ctrl/Cmd+L: Focus address bar
      else if (mod && e.key === 'l') {
        e.preventDefault()
        // Query by stable id so this does not break when the placeholder is translated.
        const addressInput = document.getElementById('address-bar-input') as HTMLInputElement | null
        addressInput?.focus()
        addressInput?.select()
      }
      // Ctrl/Cmd+R or F5: Reload
      else if ((mod && e.key === 'r') || e.key === 'F5') {
        e.preventDefault()
        window.electron.reload()
      }
      // Alt+Left: Back
      else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        useTabsStore.getState().goBack()
      }
      // Alt+Right: Forward
      else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        useTabsStore.getState().goForward()
      }
      // Escape: Stop loading
      else if (e.key === 'Escape') {
        window.electron.stop()
      }
      // Ctrl/Cmd++: Zoom in
      else if (mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        window.electron.zoomIn()
      }
      // Ctrl/Cmd+-: Zoom out
      else if (mod && e.key === '-') {
        e.preventDefault()
        window.electron.zoomOut()
      }
      // Ctrl/Cmd+0: Reset zoom
      else if (mod && e.key === '0') {
        e.preventDefault()
        window.electron.zoomReset()
      }
      // F12: Toggle DevTools (Ctrl+Shift+I is handled in main process)
      else if (e.key === 'F12') {
        e.preventDefault()
        window.electron.toggleDevTools()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openOrSwitchToTab])
}
