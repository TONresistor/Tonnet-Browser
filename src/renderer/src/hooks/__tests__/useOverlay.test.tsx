// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverlay } from '../useOverlay'

const browser = vi.hoisted(() => ({
  showOverlay: vi.fn(),
  hideOverlay: vi.fn(),
  on: vi.fn(() => vi.fn()),
}))

vi.mock('@/features/browser/client', () => ({ browserClient: browser }))

describe('useOverlay', () => {
  let container: HTMLDivElement
  let root: Root
  let overlay: ReturnType<typeof useOverlay> | null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    overlay = null
    browser.showOverlay.mockClear()
    browser.hideOverlay.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('normalizes DOM geometry before crossing the overlay IPC boundary', async () => {
    function Harness() {
      overlay = useOverlay('theme-actions')
      return null
    }

    await act(async () => root.render(<Harness />))
    act(() => {
      overlay?.show({ x: 1040.75, y: 82.25, width: 219.5, height: 147.5 }, { type: 'menu', items: [] })
    })

    expect(browser.showOverlay).toHaveBeenCalledWith(
      'theme-actions',
      { x: 1041, y: 82, width: 220, height: 148 },
      { type: 'menu', items: [] },
      undefined
    )
  })
})
