/**
 * Tab bar for multi-tab browsing.
 * Create, switch, and close tabs.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'

interface ContextMenuState {
  tabId: string
  x: number
  y: number
}

export function TabBar() {
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, duplicateTab, closeOtherTabs } = useTabs()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }

  const handleMenuAction = (action: 'close' | 'closeOthers' | 'duplicate') => {
    if (!contextMenu) return

    switch (action) {
      case 'close':
        closeTab(contextMenu.tabId)
        break
      case 'closeOthers':
        closeOtherTabs(contextMenu.tabId)
        break
      case 'duplicate':
        duplicateTab(contextMenu.tabId)
        break
    }
    setContextMenu(null)
  }

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, tabId: string) => {
      const currentIndex = tabs.findIndex((t) => t.id === tabId)

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault()
          const nextIndex = (currentIndex + 1) % tabs.length
          const nextTab = tabs[nextIndex]
          setActiveTab(nextTab.id)
          tabRefs.current.get(nextTab.id)?.focus()
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
          const prevTab = tabs[prevIndex]
          setActiveTab(prevTab.id)
          tabRefs.current.get(prevTab.id)?.focus()
          break
        }
        case 'Delete': {
          e.preventDefault()
          closeTab(tabId)
          break
        }
      }
    },
    [tabs, setActiveTab, closeTab]
  )

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5" role="tablist" aria-label="Browser tabs">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          ref={(el) => {
            if (el) tabRefs.current.set(tab.id, el)
            else tabRefs.current.delete(tab.id)
          }}
          role="tab"
          aria-selected={tab.id === activeTabId}
          tabIndex={tab.id === activeTabId ? 0 : -1}
          className={`no-drag group flex items-center gap-2 px-3 py-1.5 rounded-full cursor-pointer transition-all duration-200 max-w-[200px] border ${
            tab.id === activeTabId
              ? 'bg-surface-active border-border-medium text-foreground'
              : 'bg-surface border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground'
          }`}
          onClick={() => setActiveTab(tab.id)}
          onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
          onContextMenu={(e) => handleContextMenu(e, tab.id)}
        >
          <span className="truncate text-sm flex-1">{tab.title || 'New Tab'}</span>

          <button
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-active rounded-full p-0.5 transition-opacity"
            aria-label={`Close ${tab.title || 'tab'}`}
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.id)
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <button
        className="h-7 w-7 rounded-full no-drag flex items-center justify-center transition-all duration-200 bg-surface text-foreground-muted hover:bg-surface-active hover:text-foreground"
        onClick={() => addTab()}
        title="New Tab"
        aria-label="Open new tab"
      >
        <Plus className="h-4 w-4" />
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-xl py-1.5 min-w-[160px] bg-background/90 backdrop-blur-xl border border-border-medium shadow-lg"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors text-foreground-secondary hover:bg-surface-hover hover:text-foreground"
            onClick={() => handleMenuAction('duplicate')}
          >
            Duplicate Tab
          </button>
          <div className="my-1 mx-2 border-t border-surface-hover" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-50 text-foreground-secondary hover:bg-surface-hover hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-foreground-secondary"
            onClick={() => handleMenuAction('closeOthers')}
            disabled={tabs.length <= 1}
          >
            Close Other Tabs
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors text-destructive hover:bg-destructive/15"
            onClick={() => handleMenuAction('close')}
          >
            Close Tab
          </button>
        </div>
      )}
    </div>
  )
}
