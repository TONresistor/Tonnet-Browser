/**
 * Unit tests for runner-independent current Cocoon withdraw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../contracts/bridge-provider', () => ({
  openBridgeContract: vi.fn(),
}))

vi.mock('../contracts', () => ({
  sendFromCocoonWallet: vi.fn(),
  buildCocoonWalletInit: vi.fn(() => ({ code: {}, data: {} })),
}))

vi.mock('../wallet', () => ({
  loadCocoonWallet: vi.fn(),
}))

vi.mock('../unstake', () => ({
  getStakeInfo: vi.fn(),
}))

const cacheStore = {
  load: vi.fn(),
  setPendingWithdraw: vi.fn().mockResolvedValue(undefined),
}
vi.mock('../stake-cache', () => ({
  getStakeCacheStore: () => cacheStore,
}))

import { driveCurrentWithdrawStep } from '../current-withdraw'
import { openBridgeContract } from '../contracts/bridge-provider'
import { sendFromCocoonWallet } from '../contracts'
import { loadCocoonWallet } from '../wallet'
import { getStakeInfo } from '../unstake'
import type { CocoonManager } from '../manager'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'

const OWNER_ADDR = 'EQCRmGZ3mistR-W0wJ8eb2OfYh9ZM78o6I656kITu8W8Sx1L'
const NODE_ADDR = 'EQAgAIQvjaMw_t1fbEWmmj46bKk1FAHtd6-F_zYtXVlTq9mv'
const CLIENT_ADDR = 'UQBtLdpcZKPlh_H_8dJud6x_pmZ_bwYIACgwYk60GCcfPJ_j'
const NATIVE_ADDR = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

function makeManager(state: 'stopped' | 'starting' = 'stopped'): CocoonManager {
  return {
    getState: vi.fn(() => (state === 'starting' ? { kind: 'starting', phase: 'staking' } : { kind: 'stopped' })),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as CocoonManager
}

function makeBridge(balance: string | string[]): WsBridgeClient {
  const getBalance = vi.fn()
  if (Array.isArray(balance)) {
    for (const value of balance) getBalance.mockResolvedValueOnce(value)
    getBalance.mockResolvedValue(balance[balance.length - 1] ?? '0')
  } else {
    getBalance.mockResolvedValue(balance)
  }
  return {
    getBalance,
  } as unknown as WsBridgeClient
}

function mockClientState(state: 0 | 1 | 2, unlockTs = 0): void {
  vi.mocked(openBridgeContract).mockReturnValue({
    getData: vi.fn().mockResolvedValue({
      state,
      unlockTs,
    }),
  } as unknown as ReturnType<typeof openBridgeContract>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadCocoonWallet).mockResolvedValue({
    ownerAddress: OWNER_ADDR,
    nodeAddress: NODE_ADDR,
    nodeSecretBase64: Buffer.alloc(32, 1).toString('base64'),
    nodePublicKeyHex: 'bd665d18f2f6702ea2414ad7df4ab09372bfb32bac4ba525dd12e4fc92c1a897',
    ownerMnemonic: Array.from({ length: 24 }, (_, i) => `word${i}`),
    createdAt: 0,
    setupCompletedAt: 0,
  })
  vi.mocked(getStakeInfo).mockResolvedValue(null)
  cacheStore.load.mockResolvedValue({
    clientSCAddress: CLIENT_ADDR,
    cachedAt: Date.now(),
  })
  cacheStore.setPendingWithdraw.mockResolvedValue(undefined)
  vi.mocked(sendFromCocoonWallet).mockResolvedValue({ bocHash: 'refund-boc', seqno: 1 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('driveCurrentWithdrawStep', () => {
  it('stops a starting runner, tops up an empty node wallet, and sends refund directly', async () => {
    mockClientState(0)
    const manager = makeManager('starting')
    const topUp = vi.fn().mockResolvedValue(undefined)

    const result = await driveCurrentWithdrawStep({
      manager,
      bridge: makeBridge(['0', '2400000000']),
      nativeAddress: NATIVE_ADDR,
      topUpNodeWallet: topUp,
    })

    expect(manager.stop).toHaveBeenCalledTimes(1)
    expect(topUp).toHaveBeenCalledWith(NODE_ADDR, 2_400_000_000n)
    expect(cacheStore.setPendingWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: expect.any(Number) })
    )
    expect(cacheStore.setPendingWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: expect.any(Number),
        lastActionAt: expect.any(Number),
        lastBocHash: 'refund-boc',
      })
    )
    expect(sendFromCocoonWallet).toHaveBeenCalledWith(
      expect.anything(),
      NODE_ADDR,
      expect.any(Buffer),
      expect.anything(),
      200_000_000n,
      expect.anything(),
      expect.objectContaining({ init: expect.anything() })
    )
    expect(result).toMatchObject({
      status: 'requested',
      clientSCAddress: CLIENT_ADDR,
      bocHash: 'refund-boc',
      toppedUp: '2400000000',
    })
  })

  it('records pending and waits when the client is still in cooldown', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600
    mockClientState(1, future)

    const result = await driveCurrentWithdrawStep({
      manager: makeManager('stopped'),
      bridge: makeBridge('0'),
      nativeAddress: NATIVE_ADDR,
      topUpNodeWallet: vi.fn(),
    })

    expect(sendFromCocoonWallet).not.toHaveBeenCalled()
    expect(cacheStore.setPendingWithdraw).toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'cooldown',
      clientSCAddress: CLIENT_ADDR,
      unlockTs: future,
    })
  })

  it('claims directly when cooldown has elapsed', async () => {
    const past = Math.floor(Date.now() / 1000) - 60
    mockClientState(1, past)

    const result = await driveCurrentWithdrawStep({
      manager: makeManager('stopped'),
      bridge: makeBridge('2400000000'),
      nativeAddress: NATIVE_ADDR,
      topUpNodeWallet: vi.fn(),
    })

    expect(sendFromCocoonWallet).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('claimed')
  })

  it('does not top up dust when node wallet has the contract-required gas margin', async () => {
    mockClientState(0)
    const topUp = vi.fn().mockResolvedValue(undefined)

    const result = await driveCurrentWithdrawStep({
      manager: makeManager('stopped'),
      bridge: makeBridge('2399999999'),
      nativeAddress: NATIVE_ADDR,
      topUpNodeWallet: topUp,
    })

    expect(topUp).not.toHaveBeenCalled()
    expect(sendFromCocoonWallet).toHaveBeenCalledTimes(1)
    expect(result.toppedUp).toBeUndefined()
  })

  it('does not rebroadcast while a direct request is awaiting confirmation', async () => {
    mockClientState(0)
    cacheStore.load.mockResolvedValue({
      clientSCAddress: CLIENT_ADDR,
      cachedAt: Date.now(),
      pendingWithdraw: {
        startedAt: Date.now() - 10_000,
        lastActionAt: Date.now() - 5_000,
        lastBocHash: 'previous-boc',
      },
    })

    const result = await driveCurrentWithdrawStep({
      manager: makeManager('stopped'),
      bridge: makeBridge('500000000'),
      nativeAddress: NATIVE_ADDR,
      topUpNodeWallet: vi.fn(),
    })

    expect(sendFromCocoonWallet).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'awaiting-confirmation',
      clientSCAddress: CLIENT_ADDR,
      bocHash: 'previous-boc',
    })
  })
})
