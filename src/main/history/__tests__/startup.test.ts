import { describe, expect, it, vi } from 'vitest'
import { reconcileHistoryModeAtStartup } from '../startup'

describe('history startup reconciliation', () => {
  it('persists a degraded runtime mode before startup continues', async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const reportFailure = vi.fn()

    await reconcileHistoryModeAtStartup('memory', 'persistent', persist, reportFailure)

    expect(persist).toHaveBeenCalledWith('memory')
    expect(reportFailure).not.toHaveBeenCalled()
  })

  it('keeps startup available when persistence fails', async () => {
    const error = new Error('disk full')
    const reportFailure = vi.fn()

    await expect(
      reconcileHistoryModeAtStartup('memory', 'persistent', vi.fn().mockRejectedValue(error), reportFailure)
    ).resolves.toBeUndefined()
    expect(reportFailure).toHaveBeenCalledWith(error)
  })

  it('does not write an already aligned mode', async () => {
    const persist = vi.fn()

    await reconcileHistoryModeAtStartup('memory', 'memory', persist, vi.fn())

    expect(persist).not.toHaveBeenCalled()
  })
})
