/**
 * Unit tests for the F1 fund-lock fix in cocoon/recover-all.ts.
 *
 * planRecoveryQueueClosure encodes the invariant that a recovery-queue entry is
 * closed ('done') ONLY when its archived wallet was actually drained this pass,
 * never on the mere presence of a refund-request tx.
 */

import { describe, it, expect } from 'vitest'

import { planRecoveryQueueClosure } from '../recover-all'

const DEST = 'EQDestinationWallet0000000000000000000000000000000000'

describe('planRecoveryQueueClosure', () => {
  it('closes only entries whose archive was actually drained', () => {
    const queue = [{ archivedAt: 100 }, { archivedAt: 200 }, { archivedAt: 300 }]
    const drained = new Set<number>([200])

    const plan = planRecoveryQueueClosure(queue, drained, DEST)

    expect(plan).toEqual([
      {
        archivedAt: 200,
        partial: { phase: 'done', sentToMain: DEST, lastError: undefined },
      },
    ])
  })

  it('does NOT close a still-locked archive that only produced a refund-request tx', () => {
    // The regression: a pending/cooldown archive pushes a tx carrying its
    // archivedAt but is never drained, so it must NOT appear in the plan.
    const queue = [{ archivedAt: 424242 }]
    const drainedButPending = new Set<number>() // nothing actually drained

    expect(planRecoveryQueueClosure(queue, drainedButPending, DEST)).toEqual([])
  })

  it('returns an empty plan for an empty queue', () => {
    expect(planRecoveryQueueClosure([], new Set([1, 2, 3]), DEST)).toEqual([])
  })

  it('closes every entry when all archives drained', () => {
    const queue = [{ archivedAt: 1 }, { archivedAt: 2 }]
    const plan = planRecoveryQueueClosure(queue, new Set([1, 2]), DEST)

    expect(plan.map((p) => p.archivedAt)).toEqual([1, 2])
    expect(plan.every((p) => p.partial.phase === 'done' && p.partial.sentToMain === DEST)).toBe(true)
  })

  it('ignores drained archivedAts that are not in the queue', () => {
    const queue = [{ archivedAt: 1 }]
    // 999 was drained (e.g. the current wallet or a non-queued archive) but is
    // not a queue entry — must not fabricate a closure for it.
    const plan = planRecoveryQueueClosure(queue, new Set([1, 999]), DEST)

    expect(plan.map((p) => p.archivedAt)).toEqual([1])
  })
})
