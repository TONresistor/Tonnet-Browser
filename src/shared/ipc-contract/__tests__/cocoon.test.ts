import { describe, expect, it } from 'vitest'
import {
  COCOON_EVENT_CONTRACTS,
  COCOON_REQUEST_CONTRACTS,
  cocoonArchiveExportMnemonicContract,
  cocoonFundContract,
  cocoonRecoveryEnqueueContract,
  CocoonStateSchema,
  RecoveryDriverEventSchema,
} from '../cocoon'

describe('Cocoon IPC contracts', () => {
  it('catalogues every request and push event without duplicate channels', () => {
    expect(COCOON_REQUEST_CONTRACTS).toHaveLength(25)
    expect(COCOON_EVENT_CONTRACTS).toHaveLength(4)
    const channels = [...COCOON_REQUEST_CONTRACTS, ...COCOON_EVENT_CONTRACTS].map(({ channel }) => channel)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('validates lifecycle states and rejects invalid ports or phases', () => {
    expect(CocoonStateSchema.parse({ kind: 'ready', httpPort: 8080 })).toEqual({ kind: 'ready', httpPort: 8080 })
    expect(() => CocoonStateSchema.parse({ kind: 'ready', httpPort: 70_000 })).toThrow()
    expect(() => CocoonStateSchema.parse({ kind: 'starting', phase: 'wallet' })).toThrow()
  })

  it('keeps monetary inputs lossless and rejects signed or fractional values', () => {
    expect(cocoonFundContract.input.parse([{ amount: '18446744073709551615' }])).toEqual([
      { amount: '18446744073709551615' },
    ])
    expect(cocoonFundContract.input.parse([{ amount: 'max' }])).toEqual([{ amount: 'max' }])
    expect(() => cocoonFundContract.input.parse([{ amount: '-1' }])).toThrow()
    expect(() => cocoonFundContract.input.parse([{ amount: '1.5' }])).toThrow()
  })

  it('marks every mnemonic-returning operation as secret and enforces 24 words', () => {
    expect(cocoonArchiveExportMnemonicContract.redaction).toBe('secret')
    const mnemonic = Array.from({ length: 24 }, (_, index) => `word${index}`)
    expect(cocoonArchiveExportMnemonicContract.output.parse({ mnemonic })).toEqual({ mnemonic })
    expect(() => cocoonArchiveExportMnemonicContract.output.parse({ mnemonic: mnemonic.slice(1) })).toThrow()
  })

  it('validates recovery identity before enqueue and driver event delivery', () => {
    expect(cocoonRecoveryEnqueueContract.input.parse([{ archivedAt: 1, clientSCAddress: 'EQ-client' }])).toBeDefined()
    expect(() => cocoonRecoveryEnqueueContract.input.parse([{ archivedAt: -1, clientSCAddress: '' }])).toThrow()
    expect(
      RecoveryDriverEventSchema.parse({
        type: 'cooldown',
        archivedAt: 1,
        clientSCAddress: 'EQ-client',
        unlockTs: 2,
      })
    ).toBeDefined()
    expect(() => RecoveryDriverEventSchema.parse({ type: 'cooldown', archivedAt: 1 })).toThrow()
  })
})
