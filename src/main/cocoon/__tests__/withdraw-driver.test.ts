/**
 * Unit tests for cocoon/withdraw-driver.ts.
 *
 * Mocks all of unstake/current-withdraw/stake-cache so we drive the state machine in
 * memory without any electron / network dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('../unstake', () => ({
  getStakeInfo: vi.fn(),
  cashout: vi.fn(),
}))

vi.mock('../current-withdraw', () => ({
  driveCurrentWithdrawStep: vi.fn().mockResolvedValue({
    status: 'requested',
    clientSCAddress: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
    bocHash: 'refund-hash',
  }),
}))

vi.mock('../retire-wallet', () => ({
  retireCurrentCocoonWallet: vi.fn().mockResolvedValue(true),
}))

const cacheStore = {
  load: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  setPendingWithdraw: vi.fn().mockResolvedValue(undefined),
  clearPendingWithdraw: vi.fn().mockResolvedValue(undefined),
  getPendingWithdraw: vi.fn(),
}
vi.mock('../stake-cache', () => ({
  getStakeCacheStore: () => cacheStore,
}))

import { WithdrawDriver, startFullWithdraw } from '../withdraw-driver'
import { driveCurrentWithdrawStep } from '../current-withdraw'
import { getStakeInfo, cashout } from '../unstake'
import { retireCurrentCocoonWallet } from '../retire-wallet'
import type { CocoonManager } from '../manager'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'
import type { CocoonStakeInfo, CocoonStakeStatus } from '../../../shared/cocoon-types'

const ADDR = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

function makeManager(state: 'stopped' | 'ready' = 'ready'): CocoonManager {
  const emitter = new EventEmitter()
  const m: Partial<CocoonManager> = {
    getState: vi.fn(() =>
      state === 'ready' ? ({ kind: 'ready', httpPort: 10000 } as const) : ({ kind: 'stopped' } as const)
    ),
    getHttpPort: vi.fn(() => 10000),
    on: emitter.on.bind(emitter) as CocoonManager['on'],
    once: emitter.once.bind(emitter) as CocoonManager['once'],
    emit: emitter.emit.bind(emitter) as CocoonManager['emit'],
  }
  return m as CocoonManager
}

function makeBridge(): WsBridgeClient {
  return {} as WsBridgeClient
}

function snapshot(status: CocoonStakeStatus, cocoonWalletBalance = '0'): CocoonStakeInfo {
  return {
    status,
    proxySCAddress: ADDR,
    clientSCAddress: ADDR,
    runnerState: status === 'active' ? 0 : status === 'closed' ? 2 : 1,
    onchainState: status === 'active' ? 0 : status === 'closed' ? 2 : 1,
    balance: '0',
    stake: '0',
    unlockTs: 0,
    tokensUsed: '0',
    tokensPayed: '0',
    cocoonWalletBalance,
    runnerStatus: 'ready',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WithdrawDriver.tick (no pending intent)', () => {
  it('returns early when no pending flag is set', async () => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0 })
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    expect(getStakeInfo).not.toHaveBeenCalled()
  })

  it('returns early when bridge is offline', async () => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0, pendingWithdraw: { startedAt: 1 } })
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => null,
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    expect(getStakeInfo).not.toHaveBeenCalled()
  })
})

describe('WithdrawDriver.tick (cooldown sub-states)', () => {
  beforeEach(() => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0, pendingWithdraw: { startedAt: 1 } })
  })

  it('waits during status=closing', async () => {
    vi.mocked(getStakeInfo).mockResolvedValue(snapshot('closing'))
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    const events: unknown[] = []
    driver.on('event', (e) => events.push(e))
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(driveCurrentWithdrawStep).not.toHaveBeenCalled()
    expect(cashout).not.toHaveBeenCalled()
    expect(cacheStore.clearPendingWithdraw).not.toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'progress', status: 'closing' })
  })

  it('waits during status=cooldown', async () => {
    vi.mocked(getStakeInfo).mockResolvedValue(snapshot('cooldown'))
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(driveCurrentWithdrawStep).not.toHaveBeenCalled()
    expect(cashout).not.toHaveBeenCalled()
  })
})

describe('WithdrawDriver.tick (refundable)', () => {
  beforeEach(() => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0, pendingWithdraw: { startedAt: 1 } })
    vi.mocked(getStakeInfo).mockResolvedValue(snapshot('refundable'))
  })

  it('claims refund directly without requiring the runner', async () => {
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(driveCurrentWithdrawStep).toHaveBeenCalledTimes(1)
  })

  it('also claims directly if the runner is stopped', async () => {
    const manager = makeManager('stopped')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(driveCurrentWithdrawStep).toHaveBeenCalledTimes(1)
  })
})

describe('WithdrawDriver.tick (closed → cashout)', () => {
  beforeEach(() => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0, pendingWithdraw: { startedAt: 1 } })
  })

  it('cashes out residual and retires the consumed wallet', async () => {
    vi.mocked(getStakeInfo).mockResolvedValue(snapshot('closed', '20000000000'))
    vi.mocked(cashout).mockResolvedValue({
      totalSent: '19900000000',
      txs: [{ source: 'node', bocHash: 'h', sentAmount: '19900000000' }],
    })

    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    const events: unknown[] = []
    driver.on('event', (e) => events.push(e))
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(cashout).toHaveBeenCalledTimes(1)
    expect(retireCurrentCocoonWallet).toHaveBeenCalledWith('withdraw-completed')
    expect(events).toContainEqual({ type: 'cashout-done', sentAmount: '19900000000', bocHash: 'h' })
    expect(events).toContainEqual({ type: 'completed' })
  })

  it('retires the consumed wallet when cashout reports nothing to drain (terminal)', async () => {
    vi.mocked(getStakeInfo).mockResolvedValue(snapshot('closed', '50000000'))
    vi.mocked(cashout).mockRejectedValue(
      new Error('Nothing to cashout — all cocoon-controlled balances are below gas reserves')
    )
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(cashout).toHaveBeenCalledTimes(1)
    expect(retireCurrentCocoonWallet).toHaveBeenCalledWith('withdraw-completed')
  })
})

describe('WithdrawDriver.tick (defensive states)', () => {
  beforeEach(() => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0, pendingWithdraw: { startedAt: 1 } })
  })

  it('keeps pending intent and retries refund request while stake is still active', async () => {
    vi.mocked(getStakeInfo).mockResolvedValue(snapshot('active'))
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(driveCurrentWithdrawStep).toHaveBeenCalledTimes(1)
    expect(cacheStore.clearPendingWithdraw).not.toHaveBeenCalled()
  })

  it('clears flag if stake snapshot is null entirely', async () => {
    vi.mocked(getStakeInfo).mockResolvedValue(null)
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(cacheStore.clearPendingWithdraw).toHaveBeenCalledTimes(1)
  })

  it('emits recoverable error and does not crash on getStakeInfo throw', async () => {
    vi.mocked(getStakeInfo).mockRejectedValue(new Error('bridge timeout'))
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )
    const events: unknown[] = []
    driver.on('event', (e) => events.push(e))
    driver.triggerTick()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(events).toContainEqual({
      type: 'error',
      message: 'bridge timeout',
      recoverable: true,
    })
    expect(cacheStore.clearPendingWithdraw).not.toHaveBeenCalled()
  })
})

describe('startFullWithdraw', () => {
  it('sets the persistent flag and runs the first direct withdraw step', async () => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0, pendingWithdraw: { startedAt: 1 } })
    vi.mocked(getStakeInfo).mockResolvedValue(snapshot('active'))
    const manager = makeManager('stopped')
    const driver = new WithdrawDriver(
      manager,
      () => makeBridge(),
      () => ADDR
    )

    await startFullWithdraw(driver, manager)

    expect(cacheStore.setPendingWithdraw).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: expect.any(Number) })
    )
    expect(driveCurrentWithdrawStep).toHaveBeenCalledTimes(1)
  })

  it('surfaces immediate bridge errors to the IPC caller', async () => {
    cacheStore.load.mockResolvedValue({ cachedAt: 0, pendingWithdraw: { startedAt: 1 } })
    const manager = makeManager('ready')
    const driver = new WithdrawDriver(
      manager,
      () => null,
      () => ADDR
    )

    await expect(startFullWithdraw(driver, manager)).rejects.toThrow(/Bridge not connected/)
  })
})
