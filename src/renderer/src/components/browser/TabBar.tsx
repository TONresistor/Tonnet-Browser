/**
 * Tab bar for multi-tab browsing.
 * Create, switch, and close tabs with drag & drop support.
 */

import { useState, useRef, useCallback, memo, useMemo } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  DragCancelEvent,
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
import { useTabsStore } from '@/stores/tabs'
import { useShallow } from 'zustand/react/shallow'
import { SortableTab } from './SortableTab'
import { useTranslation } from 'react-i18next'
import { usePreferencesStore } from '@/features/settings/preferences-store'
import { useOverlay } from '@/hooks/useOverlay'
import { clampToViewport } from '@/lib/overlay-position'
import type { OverlayMenuItem } from '@shared/types'

interface TabBarProps {
  sidebarWidth?: number
}

export const TabBar = memo(function TabBar({ sidebarWidth }: TabBarProps) {
  const { t } = useTranslation('browser')
  const { tabs, activeTabId, addTab, closeTab, setActiveTab, duplicateTab, closeOtherTabs, reorderTabs } = useTabsStore(
    useShallow((s) => ({
      tabs: s.tabs,
      activeTabId: s.activeTabId,
      addTab: s.addTab,
      closeTab: s.closeTab,
      setActiveTab: s.setActiveTab,
      duplicateTab: s.duplicateTab,
      closeOtherTabs: s.closeOtherTabs,
      reorderTabs: s.reorderTabs,
    }))
  )
  const tabOrientation = usePreferencesStore((s) => s.saved.tabOrientation)
  const [activeId, setActiveId] = useState<string | null>(null)
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const menuRef = useRef<{
    show: ReturnType<typeof useOverlay>['show']
    hide: ReturnType<typeof useOverlay>['hide']
  } | null>(null)

  const isVertical = tabOrientation === 'vertical'

  // Memoize tab IDs array to avoid recalculation on every render
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs])

  const handleOverlayAction = useCallback(
    (actionType: string, data: unknown) => {
      const d = data as Record<string, string>
      menuRef.current?.hide()
      switch (actionType) {
        case 'duplicate':
          duplicateTab(d.tabId)
          break
        case 'close-others':
          closeOtherTabs(d.tabId)
          break
        case 'close':
          closeTab(d.tabId)
          break
        case 'dismiss':
          break
      }
    },
    [duplicateTab, closeOtherTabs, closeTab]
  )

  const menu = useOverlay('tab-context-menu', handleOverlayAction)
  menuRef.current = menu

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

  const handleActivate = useCallback((tabId: string) => setActiveTab(tabId), [setActiveTab])
  const handleClose = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.stopPropagation()
      closeTab(tabId)
    },
    [closeTab]
  )
  const handleContextMenuCb = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      e.preventDefault()
      const menuW = 200,
        menuH = 160
      const { x: menuX, y: menuY } = clampToViewport(e.clientX, e.clientY, menuW, menuH)
      const items: OverlayMenuItem[] = [
        { id: 'duplicate', label: t('tabs.duplicateTab'), data: { tabId } },
        { id: '_sep1', label: '', separator: true },
        { id: 'close-others', label: t('tabs.closeOtherTabs'), data: { tabId }, disabled: tabs.length <= 1 },
        { id: 'close', label: t('tabs.closeTab'), data: { tabId }, destructive: true },
      ]
      menu.show({ x: menuX, y: menuY, width: menuW, height: menuH }, { type: 'menu', items })
    },
    [menu, t, tabs.length]
  )
  const handleKeyDownCb = useCallback(
    (e: React.KeyboardEvent, tabId: string) => handleTabKeyDown(e, tabId),
    [handleTabKeyDown]
  )

  const announcements = useMemo(
    () => ({
      onDragStart({ active }: DragStartEvent) {
        const tab = tabs.find((t) => t.id === active.id)
        return t('tabs.pickedUp', { title: tab?.title || t('tabs.newTab') })
      },
      onDragOver({ active, over }: DragOverEvent) {
        if (!over) return ''
        const activeTab = tabs.find((t) => t.id === active.id)
        const overTab = tabs.find((t) => t.id === over.id)
        return t('tabs.dragOver', { activeTitle: activeTab?.title, overTitle: overTab?.title })
      },
      onDragEnd({ active, over }: DragEndEvent) {
        if (!over) return t('tabs.dragCancelled')
        const tab = tabs.find((t) => t.id === active.id)
        return t('tabs.reordered', { title: tab?.title })
      },
      onDragCancel({ active }: DragCancelEvent) {
        const tab = tabs.find((t) => t.id === active.id)
        return t('tabs.dragCancelledFull', { title: tab?.title })
      },
    }),
    [tabs, t]
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
        accessibility={{ announcements }}
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
              onActivate={handleActivate}
              onClose={handleClose}
              onContextMenu={handleContextMenuCb}
              onKeyDown={handleKeyDownCb}
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
                <div
                  className={`px-2.5 py-1.5 ${isVertical ? 'rounded-lg' : 'rounded-full'} text-sm bg-surface text-foreground shadow-2xl opacity-90 border border-border-medium flex items-center gap-2 ${isVertical ? 'w-full' : 'max-w-[200px]'}`}
                >
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
    </div>
  )
})
