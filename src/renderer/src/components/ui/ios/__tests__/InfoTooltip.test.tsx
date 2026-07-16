// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InfoTooltip } from '../InfoTooltip'

describe('InfoTooltip', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('uses the exact Telegram info glyph and exposes its help on hover', async () => {
    await act(async () => {
      root.render(<InfoTooltip label="Success" content="Used for successful states." />)
    })

    const trigger = container.querySelector('button')
    const icon = container.querySelector('svg')
    if (!trigger || !icon) throw new Error('Missing info tooltip trigger')

    expect(icon.getAttribute('viewBox')).toBe('0 0 28 28')
    expect(icon.getAttribute('data-figma-node-id')).toBe('6398:8654')
    expect(trigger.className).toContain('text-icon/60')
    expect(trigger.className).not.toContain('text-primary/80')
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('Used for successful states.')
    expect(trigger.getAttribute('aria-describedby')).not.toBeNull()
  })

  it('opens from keyboard focus and closes with Escape', async () => {
    await act(async () => {
      root.render(<InfoTooltip label="Success" content="Used for successful states." />)
    })

    const trigger = container.querySelector('button')
    if (!trigger) throw new Error('Missing info tooltip trigger')

    await act(async () => trigger.focus())
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull()

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
})
