import { describe, it, expect } from 'vitest'
import { computeStep } from '../TonStepperField'

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
