// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeColorField } from '../ThemeColorField'

describe('ThemeColorField', () => {
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

  it('does not round-trip an unchanged HSL value through HEX on blur', async () => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(<ThemeColorField label="Background" value="210 26% 13%" onChange={onChange} />)
    })

    const hexInput = container.querySelector<HTMLInputElement>('input:not([type="color"])')
    if (!hexInput) throw new Error('Missing HEX input')
    await act(async () => {
      hexInput.focus()
      hexInput.blur()
    })

    expect(hexInput.value).toBe('#19212A')
    expect(hexInput.className).toContain('rounded-full')
    expect(hexInput.className).not.toContain('rounded-field')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reverts a valid HEX draft on Escape without applying it', async () => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(<ThemeColorField label="Background" value="210 26% 13%" onChange={onChange} />)
    })

    const hexInput = container.querySelector<HTMLInputElement>('input:not([type="color"])')
    if (!hexInput) throw new Error('Missing HEX input')
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!nativeSetter) throw new Error('Missing native input value setter')

    await act(async () => {
      nativeSetter.call(hexInput, '#FFFFFF')
      hexInput.dispatchEvent(new Event('input', { bubbles: true }))
      hexInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(hexInput.value).toBe('#19212A')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves the description into an accessible info tooltip trigger', async () => {
    await act(async () => {
      root.render(
        <ThemeColorField
          label="Success"
          description="Used for completed and connected states."
          value="145 55% 58%"
          onChange={vi.fn()}
        />
      )
    })

    const info = container.querySelector<HTMLButtonElement>('button')
    expect(info?.getAttribute('aria-label')).toContain('Used for completed and connected states.')
    expect(container.textContent).not.toContain('Used for completed and connected states.')
  })

  it('renders a readable non-editing state without disabled-field styling', async () => {
    await act(async () => {
      root.render(<ThemeColorField label="Background" value="210 26% 13%" readOnly onChange={vi.fn()} />)
    })

    expect(container.querySelector('input[type="color"]')).toBeNull()
    const hexInput = container.querySelector<HTMLInputElement>('input:not([type="color"])')
    expect(hexInput?.readOnly).toBe(true)
    expect(hexInput?.disabled).toBe(false)
    expect(container.firstElementChild?.className).not.toContain('opacity-60')
  })
})
