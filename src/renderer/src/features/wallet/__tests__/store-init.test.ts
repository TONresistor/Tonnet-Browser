import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletTransaction } from '@shared/types'

const mocks = vi.hoisted(() => ({
  listener: null as ((transaction: WalletTransaction) => void) | null,
  getState: vi.fn(),
  getSettings: vi.fn(),
}))

vi.mock('../client', () => ({
  walletClient: {
    ...mocks,
    isAvailable: () => false,
    onBalanceUpdated: () => () => {},
    onNewTransaction: (listener: (transaction: WalletTransaction) => void) => {
      mocks.listener = listener
      return () => {}
    },
    onStateChanged: () => () => {},
  },
}))

import { useWalletStore } from '../store'

beforeEach(() => {
  mocks.getState.mockReset().mockResolvedValue({ isCreated: false })
  mocks.getSettings.mockReset().mockResolvedValue({ notificationStyle: 'popup' })
  useWalletStore.setState({ initialized: false, isLoading: false, isCreated: false, error: null })
})

describe('wallet initialization', () => {
  it('can retry initialization after a failed state request', async () => {
    mocks.getState.mockRejectedValueOnce(new Error('IPC unavailable'))

    await useWalletStore.getState().init()
    await useWalletStore.getState().init()

    expect(mocks.getState).toHaveBeenCalledTimes(2)
    expect(useWalletStore.getState()).toMatchObject({ initialized: true, isLoading: false, error: null })
  })

  it('can retry initialization after a failed settings request', async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error('Settings unavailable'))

    await useWalletStore.getState().init()
    await useWalletStore.getState().init()

    expect(mocks.getSettings).toHaveBeenCalledTimes(2)
    expect(useWalletStore.getState().initialized).toBe(true)
  })

  it('does not repeat successful initialization when no wallet exists', async () => {
    await useWalletStore.getState().init()
    await useWalletStore.getState().init()

    expect(mocks.getState).toHaveBeenCalledOnce()
    expect(useWalletStore.getState()).toMatchObject({ initialized: true, isCreated: false })
  })
})

it('reconciles operation updates and preserves x402 metadata without a reload', () => {
  const pending: WalletTransaction = {
    id: 'operation',
    operationId: 'operation',
    type: 'x402',
    amount: '5',
    address: 'recipient',
    timestamp: 1,
    status: 'pending',
    x402Domain: 'shop.ton',
    x402Url: 'https://shop.ton/resource',
  }
  const chain: WalletTransaction = {
    id: 'chain-hash',
    hash: 'chain-hash',
    type: 'send',
    amount: '5',
    address: 'recipient',
    timestamp: 2,
    status: 'confirmed',
  }
  useWalletStore.setState({ transactions: [chain, pending] })
  mocks.listener!({ ...chain, id: 'operation', operationId: 'operation', operationState: 'included' })
  expect(useWalletStore.getState().transactions).toHaveLength(1)
  expect(useWalletStore.getState().transactions[0]).toMatchObject({
    status: 'confirmed',
    operationState: 'included',
    type: 'x402',
    x402Domain: 'shop.ton',
  })
  mocks.listener!({
    ...chain,
    operationId: 'operation',
    operationState: 'included',
    execution: 'partial',
    status: 'pending',
  })
  mocks.listener!(chain)
  expect(useWalletStore.getState().transactions[0]).toMatchObject({
    operationId: 'operation',
    operationState: 'included',
    execution: 'partial',
    status: 'pending',
  })
})
