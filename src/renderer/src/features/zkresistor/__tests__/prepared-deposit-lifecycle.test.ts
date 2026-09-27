// @vitest-environment happy-dom
import { Address } from '@ton/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZkResistorPool } from '@shared/types'

const mocks = vi.hoisted(() => ({
  prepareDeposit: vi.fn(async () => ({ noteString: 'secret-note' })),
  finalizeDeposit: vi.fn(async () => {
    throw new Error('proof failed')
  }),
}))

vi.mock('@tonresistor/zkresistor-sdk', () => ({
  buildWithdraw: vi.fn(),
  finalizeDeposit: mocks.finalizeDeposit,
  parseNote: vi.fn(),
  prepareDeposit: mocks.prepareDeposit,
}))

vi.mock('../runtime/artifacts', () => ({
  insertProver: vi.fn(),
  poseidon2: vi.fn(async () => ({})),
  withdrawProver: vi.fn(),
}))

vi.mock('../runtime/merkle', () => ({
  TonPoolSessionFactory: class {
    open() {
      return { client: {}, stateProvider: {} }
    }
  },
}))

vi.mock('../client', () => ({
  zkResistorClient: { send: vi.fn() },
}))

const address = Address.parseRaw(`0:${'0'.repeat(64)}`).toString({ bounceable: true, urlSafe: true })
const pool: ZkResistorPool = {
  id: address,
  address,
  kind: 'ton',
  symbol: 'GRAM',
  name: 'GRAM',
  denomination: '1000000000',
  decimals: 9,
  nextIndex: 0,
  withdrawalCount: 0,
  shieldedDeposits: 0,
  shieldedAmount: '0',
  capacity: 1_048_576,
}

beforeEach(() => {
  mocks.prepareDeposit.mockClear()
  mocks.finalizeDeposit.mockClear()
  vi.resetModules()
})

describe('prepared ZKResistor deposits', () => {
  it('discards a prepared deposit after an error', async () => {
    const runtime = await import('../private-runtime')
    const prepared = await runtime.prepareGramDeposit(pool, address, vi.fn())

    await expect(runtime.submitGramDeposit(prepared.id, address, vi.fn())).rejects.toThrow('proof failed')
    await expect(runtime.submitGramDeposit(prepared.id, address, vi.fn())).rejects.toThrow(
      'Generate a new secret note before depositing'
    )
  })

  it('supports explicit cleanup when leaving the page', async () => {
    const runtime = await import('../private-runtime')
    const prepared = await runtime.prepareGramDeposit(pool, address, vi.fn())

    runtime.discardPreparedDeposit(prepared.id)

    await expect(runtime.submitGramDeposit(prepared.id, address, vi.fn())).rejects.toThrow(
      'Generate a new secret note before depositing'
    )
  })
})
