// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { AppIcon } from '../AppIcon'

describe('AppIcon', () => {
  it('renders product glyphs as a currentColor mask instead of an image', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<AppIcon name="wallet" className="h-4 w-4 text-icon" />))

    const icon = container.querySelector<HTMLElement>('[data-app-icon="wallet"]')
    expect(icon).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(icon?.style.backgroundColor).toBe('currentcolor')
    expect(icon?.style.maskImage).toMatch(/^url\("data:image\/svg\+xml/)
    expect(icon?.style.maskImage).toMatch(/"\)$/)
    expect(icon?.className).toContain('text-icon')

    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  })

  it('renders standard navigation glyphs as inline SVG', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => root.render(<AppIcon name="back" className="h-4 w-4" />))

    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()

    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  })
})
