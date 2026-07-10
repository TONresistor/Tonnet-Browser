import { describe, it, expect } from 'vitest'
import { stakeBlocksRunner } from '../runner'

describe('stakeBlocksRunner', () => {
  it('allows the runner only for an active stake with no pending intent', () => {
    expect(stakeBlocksRunner(false, 'active')).toBe(false)
  })

  it('blocks the runner when a withdraw intent is pending', () => {
    expect(stakeBlocksRunner(true, 'active')).toBe(true)
  })

  it('blocks the runner for any non-active stake status', () => {
    for (const status of ['closing', 'cooldown', 'refundable', 'closed', undefined]) {
      expect(stakeBlocksRunner(false, status)).toBe(true)
    }
  })
})
