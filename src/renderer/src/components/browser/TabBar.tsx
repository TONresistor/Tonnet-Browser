/**
 * Tab bar for multi-tab browsing.
 * Create, switch, and close tabs with drag & drop support.
 */

import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { Plus, Globe } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'
import { SortableTab } from './SortableTab'
import { useTranslation } from 'react-i18next'
import { usePreferences } from '@/stores/preferences'

interface ContextMenuState {
  tabId: string
  x: number
  y: number
}

interface TabBarProps {
  sidebarWidth?: number
}

export const TabBar = memo(function TabBar({ sidebarWidth }: TabBarProps) {
  const { t } = useTranslation('browser')
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, duplicateTab, closeOtherTabs, reorderTabs } = useTabs()
  const { tabOrientation } = usePreferences()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const isVertical = tabOrientation === 'vertical'

  // Memoize tab IDs array to avoid recalculation on every render
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs])

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

  // Configure drag & drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px of movement before drag starts (prevents accidental drags)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Drag & drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over || active.id === over.id) return

    const oldIndex = tabs.findIndex((t) => t.id === active.id)
    const newIndex = tabs.findIndex((t) => t.id === over.id)

    if (oldIndex !== -1 && newIndex !== -1) {
      reorderTabs(active.id as string, newIndex)
    }
  }

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, tabId: string) => {
      const currentIndex = tabs.findIndex((t) => t.id === tabId)

      // Arrow keys for navigation (adjust based on orientation)
      const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight'
      const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft'

      switch (e.key) {
        case nextKey: {
          e.preventDefault()
          const nextIndex = (currentIndex + 1) % tabs.length
          const nextTab = tabs[nextIndex]
          setActiveTab(nextTab.id)
          tabRefs.current.get(nextTab.id)?.focus()
          break
        }
        case prevKey: {
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
    [tabs, setActiveTab, closeTab, isVertical]
  )

  return (
    <div
      className={`flex gap-1.5 px-2 py-1.5 ${isVertical ? 'flex-col flex-1 overflow-y-auto' : 'items-center'}`}
      role="tablist"
      aria-label={t('tabs.browserTabs')}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart({ active }) {
              const tab = tabs.find((t) => t.id === active.id)
              return t('tabs.pickedUp', { title: tab?.title || t('tabs.newTab') })
            },
            onDragOver({ active, over }) {
              if (!over) return ''
              const activeTab = tabs.find((t) => t.id === active.id)
              const overTab = tabs.find((t) => t.id === over.id)
              return t('tabs.dragOver', { activeTitle: activeTab?.title, overTitle: overTab?.title })
            },
            onDragEnd({ active, over }) {
              if (!over) return t('tabs.dragCancelled')
              const tab = tabs.find((t) => t.id === active.id)
              return t('tabs.reordered', { title: tab?.title })
            },
            onDragCancel({ active }) {
              const tab = tabs.find((t) => t.id === active.id)
              return t('tabs.dragCancelledFull', { title: tab?.title })
            },
          },
        }}
      >
        <SortableContext
          items={tabIds}
          strategy={isVertical ? verticalListSortingStrategy : horizontalListSortingStrategy}
        >
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onActivate={() => setActiveTab(tab.id)}
              onClose={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
              isVertical={isVertical}
              sidebarWidth={sidebarWidth}
            />
          ))}
        </SortableContext>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeId &&
            (() => {
              const activeTab = tabs.find((t) => t.id === activeId)
              return activeTab ? (
                <div className={`px-2.5 py-1.5 ${isVertical ? 'rounded-lg' : 'rounded-full'} text-sm bg-surface text-foreground shadow-2xl opacity-90 border border-border-medium flex items-center gap-2 ${isVertical ? 'w-full' : 'max-w-[200px]'}`}>
                  {activeTab.favicon ? (
                    <img src={activeTab.favicon} alt="" className="w-5 h-5 flex-shrink-0 object-contain" />
                  ) : (
                    <Globe className="w-5 h-5 flex-shrink-0" />
                  )}
                  <span className="truncate">{activeTab.title || t('tabs.newTab')}</span>
                </div>
              ) : null
            })()}
        </DragOverlay>
      </DndContext>

      <button
        className={`${isVertical ? 'w-full py-2 rounded-lg' : 'h-7 w-7 rounded-full'} no-drag flex items-center justify-center transition-all duration-200 bg-surface text-foreground-muted hover:bg-surface-active hover:text-foreground`}
        onClick={() => addTab()}
        title={t('tabs.newTab')}
        aria-label={t('tabs.openNewTab')}
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
            {t('tabs.duplicateTab')}
          </button>
          <div className="my-1 mx-2 border-t border-surface-hover" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-50 text-foreground-secondary hover:bg-surface-hover hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-foreground-secondary"
            onClick={() => handleMenuAction('closeOthers')}
            disabled={tabs.length <= 1}
          >
            {t('tabs.closeOtherTabs')}
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm transition-colors text-destructive hover:bg-destructive/15"
            onClick={() => handleMenuAction('close')}
          >
            {t('tabs.closeTab')}
          </button>
        </div>
      )}
    </div>
  )
})
