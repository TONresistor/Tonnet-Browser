// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Segmented } from '../Segmented'

describe('Segmented', () => {
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

  it('exposes a single-selection group with roving keyboard focus', async () => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(
        <Segmented
          value="browser"
          onChange={onChange}
          ariaLabel="Preview mode"
          options={[
            { value: 'browser', label: 'Browser' },
            { value: 'components', label: 'Components' },
          ]}
        />
      )
    })

    const group = container.querySelector<HTMLElement>('[role="radiogroup"]')
    const radios = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    expect(group?.getAttribute('aria-label')).toBe('Preview mode')
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1])

    await act(async () => {
      radios[0].focus()
      radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('components')
    expect(document.activeElement).toBe(radios[1])
  })
})
