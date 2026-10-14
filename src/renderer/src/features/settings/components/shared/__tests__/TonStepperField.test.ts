// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { computeStep, TonStepperField } from '../TonStepperField'

describe('computeStep', () => {
  it('increments and decrements by the step', () => {
    expect(computeStep('1', 0.5, 1)).toBe('1.5')
    expect(computeStep('1.5', 0.5, -1)).toBe('1')
  })

  it('never goes below zero', () => {
    expect(computeStep('0', 0.5, -1)).toBe('0')
    expect(computeStep('0.5', 1, -1)).toBe('0')
  })

  it('formats whole numbers without a decimal and fractions to one place', () => {
    expect(computeStep('2', 1, 1)).toBe('3')
    expect(computeStep('2', 0.5, 1)).toBe('2.5')
  })

  it('treats an empty/invalid value as 0', () => {
    expect(computeStep('', 0.5, 1)).toBe('0.5')
    expect(computeStep('abc', 0.5, 1)).toBe('0.5')
  })
})

it('commits the fresh stepped value rather than the controlled value from the previous render', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onChange = vi.fn()
  const onBlur = vi.fn()
  try {
    await act(async () =>
      root.render(
        createElement(TonStepperField, {
          value: '1',
          onChange,
          onBlur,
          ariaLabel: 'Payment limit',
          step: 0.5,
        })
      )
    )
    const [decrement, increment] = container.querySelectorAll('button')
    await act(async () => increment.click())
    expect(onChange).toHaveBeenLastCalledWith('1.5')
    expect(onBlur).toHaveBeenLastCalledWith('1.5')
    await act(async () => decrement.click())
    expect(onChange).toHaveBeenLastCalledWith('0.5')
    expect(onBlur).toHaveBeenLastCalledWith('0.5')
  } finally {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
