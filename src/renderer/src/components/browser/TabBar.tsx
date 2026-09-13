/**
 * Tab bar for multi-tab browsing.
 * Create, switch, and close tabs with drag & drop support.
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect, memo, useMemo } from 'react'
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
import { Plus, Globe, ChevronLeft, ChevronRight } from 'lucide-react'
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
  const stripRef = useRef<HTMLDivElement>(null)
  const scrollControlsRef = useRef<HTMLDivElement>(null)
  const [scrollEdges, setScrollEdges] = useState({ overflow: false, left: false, right: false })
  const menuRef = useRef<{
    show: ReturnType<typeof useOverlay>['show']
    hide: ReturnType<typeof useOverlay>['hide']
  } | null>(null)

  const isVertical = tabOrientation === 'vertical'

  const registerTabRef = useCallback((tabId: string, node: HTMLDivElement | null) => {
    if (node) tabRefs.current.set(tabId, node)
    else tabRefs.current.delete(tabId)
  }, [])

  const updateScrollEdges = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return
    const controlsWidth = scrollControlsRef.current?.offsetWidth ?? 0
    const extraGap =
      controlsWidth && strip.parentElement ? parseFloat(getComputedStyle(strip.parentElement).gap) || 0 : 0
    const overflow = strip.scrollWidth > strip.clientWidth + controlsWidth + extraGap + 1
    const left = strip.scrollLeft > 1
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1
    setScrollEdges((previous) =>
      previous.overflow === overflow && previous.left === left && previous.right === right
        ? previous
        : { overflow, left, right }
    )
  }, [])

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (isVertical || !strip) return
    const update = () => {
      const tab = activeTabId ? tabRefs.current.get(activeTabId) : null
      if (tab && !activeId) {
        if (tab.offsetLeft < strip.scrollLeft) strip.scrollLeft = tab.offsetLeft
        else if (tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
          strip.scrollLeft = tab.offsetLeft + tab.offsetWidth - strip.clientWidth
        }
      }
      updateScrollEdges()
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [activeTabId, activeId, isVertical, tabs.length, updateScrollEdges])

  useEffect(() => {
    const strip = stripRef.current
    if (isVertical || !strip) return
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      if (strip.scrollWidth <= strip.clientWidth) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1
      strip.scrollLeft += event.deltaY * unit
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [isVertical])

  const scrollTabs = (direction: number) => {
    const strip = stripRef.current
    if (strip) strip.scrollBy({ left: direction * Math.max(100, strip.clientWidth * 0.75) })
  }

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
      className={`flex gap-1.5 px-2 py-1.5 ${isVertical ? 'flex-col flex-1 overflow-y-auto' : 'min-w-0 flex-1 items-center'}`}
      role="tablist"
      aria-label={t('tabs.browserTabs')}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{ announcements }}
      >
        <div
          ref={stripRef}
          onScroll={updateScrollEdges}
          className={
            isVertical
              ? 'contents'
              : 'relative flex w-max min-w-0 flex-[0_1_auto] items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          }
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
                onRef={registerTabRef}
              />
            ))}
          </SortableContext>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeId &&
            (() => {
              const activeTab = tabs.find((t) => t.id === activeId)
              return activeTab ? (
                <div
                  className={`px-2.5 py-1.5 ${isVertical ? 'rounded-lg' : 'rounded-full'} text-sm bg-card text-heading shadow-2xl opacity-90 border border-border-subtle flex items-center gap-2 ${isVertical ? 'w-full' : 'max-w-[200px]'}`}
                >
                  {activeTab.favicon ? (
                    <img src={activeTab.favicon} alt="" className="w-5 h-5 flex-shrink-0 object-contain" />
                  ) : (
                    <Globe className="w-5 h-5 flex-shrink-0 text-icon/60" />
                  )}
                  <span className="truncate">{activeTab.title || t('tabs.newTab')}</span>
                </div>
              ) : null
            })()}
        </DragOverlay>
      </DndContext>

      {!isVertical && scrollEdges.overflow && (
        <div ref={scrollControlsRef} className="flex shrink-0 gap-0.5">
          <button
            type="button"
            className="no-drag flex h-7 w-7 items-center justify-center rounded-full text-icon/60 hover:bg-surface-active hover:text-icon disabled:opacity-30"
            disabled={!scrollEdges.left}
            onClick={() => scrollTabs(-1)}
            title={t('tabs.scrollLeft')}
            aria-label={t('tabs.scrollLeft')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="no-drag flex h-7 w-7 items-center justify-center rounded-full text-icon/60 hover:bg-surface-active hover:text-icon disabled:opacity-30"
            disabled={!scrollEdges.right}
            onClick={() => scrollTabs(1)}
            title={t('tabs.scrollRight')}
            aria-label={t('tabs.scrollRight')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <button
        className={`${isVertical ? 'w-full py-2 rounded-lg' : 'h-7 w-7 shrink-0 rounded-full'} no-drag flex items-center justify-center transition-all duration-200 bg-surface text-icon/60 hover:bg-surface-active hover:text-icon`}
        onClick={() => addTab()}
        title={t('tabs.newTab')}
        aria-label={t('tabs.openNewTab')}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  )
})
