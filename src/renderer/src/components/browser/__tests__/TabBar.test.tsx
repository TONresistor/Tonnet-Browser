import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '@/stores/tabs'

vi.mock('@/stores/tabs', async () => {
  const { create } = await import('zustand')
  return {
    useTabsStore: create(() => ({
      tabs: [],
      activeTabId: null,
      addTab: vi.fn(),
      closeTab: vi.fn(),
      setActiveTab: vi.fn(),
      duplicateTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      reorderTabs: vi.fn(),
    })),
  }
})
vi.mock('@/features/settings/preferences-store', async () => {
  const { create } = await import('zustand')
  return { usePreferencesStore: create(() => ({ saved: { tabOrientation: 'horizontal' } })) }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useOverlay', () => ({ useOverlay: () => ({ show: vi.fn(), hide: vi.fn() }) }))
vi.mock('@/components/ui/Favicon', () => ({ Favicon: () => null }))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  DragOverlay: ({ children }: { children: React.ReactNode }) => children,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(),
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  horizontalListSortingStrategy: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), isDragging: false }),
}))

import { TabBar } from '../TabBar'
import { useTabsStore } from '@/stores/tabs'
import { usePreferencesStore } from '@/features/settings/preferences-store'

function makeTabs(count: number): Tab[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tab-${i}`,
    url: `http://page-${i}.ton`,
    title: `Page ${i}`,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    history: [`http://page-${i}.ton`],
    historyIndex: 0,
    nativeCanGoBack: false,
    nativeCanGoForward: false,
  }))
}

describe('horizontal tab overflow', () => {
  let dom: Window
  let container: HTMLDivElement
  let root: Root
  let viewportWidth: number
  const resizeCallbacks = new Set<() => void>()

  beforeEach(() => {
    dom = new Window()
    vi.stubGlobal('window', dom)
    vi.stubGlobal('document', dom.document)
    vi.stubGlobal('getComputedStyle', dom.getComputedStyle.bind(dom))
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}
        observe() {
          resizeCallbacks.add(this.callback)
        }
        disconnect() {
          resizeCallbacks.delete(this.callback)
        }
      }
    )
    viewportWidth = 240
    vi.spyOn(dom.HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth)
    vi.spyOn(dom.HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return Math.max(0, this.querySelectorAll('[role="tab"]').length * 106 - 6)
    })
    vi.spyOn(dom.HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
    vi.spyOn(dom.HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return Number(this.getAttribute('aria-label')?.match(/Page (\d+)/)?.[1] ?? 0) * 106
    })
    useTabsStore.setState({ tabs: makeTabs(8), activeTabId: 'tab-0' })
    usePreferencesStore.setState({ saved: { ...usePreferencesStore.getState().saved, tabOrientation: 'horizontal' } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await dom.happyDOM.abort()
  })

  const getStrip = () => container.querySelector<HTMLElement>('[role="tab"]')!.parentElement!

  it('reveals newly created and selected tabs while keeping add outside the scrolling list', async () => {
    await act(async () => root.render(<TabBar />))
    const strip = getStrip()
    expect(strip.contains(container.querySelector('[aria-label="tabs.openNewTab"]'))).toBe(false)

    await act(async () => useTabsStore.setState({ tabs: makeTabs(9), activeTabId: 'tab-8' }))
    expect(strip.scrollLeft).toBe(708)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="tabs.scrollRight"]')!.disabled).toBe(true)

    await act(async () => useTabsStore.setState({ activeTabId: 'tab-0' }))
    expect(strip.scrollLeft).toBe(0)
    expect(container.querySelector<HTMLButtonElement>('[aria-label="tabs.scrollLeft"]')!.disabled).toBe(true)
  })

  it('adjusts after resize and handles vertical wheel movement without swallowing pinch zoom', async () => {
    useTabsStore.setState({ activeTabId: 'tab-1' })
    await act(async () => root.render(<TabBar />))
    const strip = getStrip()
    viewportWidth = 140
    await act(async () => resizeCallbacks.forEach((callback) => callback()))
    expect(strip.scrollLeft).toBe(66)

    const wheel = new dom.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true })
    strip.dispatchEvent(wheel as unknown as WheelEvent)
    expect(wheel.defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(116)

    const pinch = new dom.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true })
    Object.defineProperty(pinch, 'ctrlKey', { value: true })
    strip.dispatchEvent(pinch as unknown as WheelEvent)
    expect(pinch.defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(116)
  })

  it('keeps vertical tabs free of horizontal controls and wheel interception', async () => {
    usePreferencesStore.setState({ saved: { ...usePreferencesStore.getState().saved, tabOrientation: 'vertical' } })
    await act(async () => root.render(<TabBar sidebarWidth={200} />))
    expect(container.querySelector('[aria-label="tabs.scrollLeft"]')).toBeNull()
    expect(container.querySelector('[aria-label="tabs.scrollRight"]')).toBeNull()
    const wheel = new dom.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true })
    getStrip().dispatchEvent(wheel as unknown as WheelEvent)
    expect(wheel.defaultPrevented).toBe(false)
  })

  it('places add directly after the tabs without scroll controls when they fit', async () => {
    useTabsStore.setState({ tabs: makeTabs(2), activeTabId: 'tab-0' })
    await act(async () => root.render(<TabBar />))

    expect(container.querySelector('[aria-label="tabs.scrollLeft"]')).toBeNull()
    expect(container.querySelector('[aria-label="tabs.scrollRight"]')).toBeNull()
    expect(getStrip().nextElementSibling?.getAttribute('aria-label')).toBe('tabs.openNewTab')
  })
})
