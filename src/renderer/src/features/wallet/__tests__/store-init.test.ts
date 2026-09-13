import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  getSettings: vi.fn(),
}))

vi.mock('../client', () => ({
  walletClient: {
    ...mocks,
    isAvailable: () => false,
    onBalanceUpdated: () => () => {},
    onNewTransaction: () => () => {},
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
