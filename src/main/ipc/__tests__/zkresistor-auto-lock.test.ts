import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beginCell } from '@ton/core'
import { afterEach, expect, it, vi } from 'vitest'
import type { ServiceRegistry } from '../../services'
import type { ISecureStorage } from '../../ports/secure-storage'
import { WalletKeyStorage } from '../../wallet/key-storage'
import { registerZkResistorHandlers } from '../handlers/zkresistor'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => Promise<unknown>>(),
  approval: vi.fn<() => Promise<boolean>>(),
  poolAddress: `0:${'11'.repeat(32)}`,
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/test-wallet' }, safeStorage: {} }))
vi.mock('../../settings', () => ({ getSetting: () => ({ zkResistorEnabled: true }) }))
vi.mock('../../zkresistor/resources', () => ({
  getZkResistorResources: () => ({ status: () => ({ status: 'ready' }) }),
}))
vi.mock('../../zkresistor/catalog-service', () => ({
  ZkResistorCatalogService: class {
    async load() {
      return { pools: [{ address: mocks.poolAddress, denomination: '1' }] }
    }
  },
}))
vi.mock('../../zkresistor/transaction', () => ({
  validateZkResistorTransaction: () => ({ body: beginCell().endCell() }),
}))
vi.mock('../../wallet/wallet-approval', () => ({ requestZkResistorApproval: mocks.approval }))
vi.mock('../contract-handler', () => ({
  secureContractHandle: (contract: { channel: string }, handler: (...args: never[]) => Promise<unknown>) => {
    mocks.handlers.set(contract.channel, handler)
  },
  ipcFailure: (code: string): never => {
    throw new Error(code)
  },
}))

const storage: ISecureStorage = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value),
  decrypt: (value) => value.toString(),
  getBackendName: () => 'test-backend',
}
let directory: string
let keys: WalletKeyStorage

afterEach(async () => {
  keys?.destroy()
  vi.useRealTimers()
  if (directory) await rm(directory, { recursive: true, force: true })
})

it.each([
  ['deposit', 'success'],
  ['withdraw', 'success'],
  ['deposit', 'cancel'],
  ['withdraw', 'cancel'],
  ['deposit', 'signing-error'],
  ['withdraw', 'signing-error'],
] as const)(
  'protects a long ZKResistor %s confirmation without renderer heartbeats and resumes locking after %s',
  async (operation, outcome) => {
    directory = await mkdtemp(join(tmpdir(), 'zkr-auto-lock-'))
    await writeFile(
      join(directory, 'wallet-key.dat'),
      Buffer.concat([Buffer.from('SENC'), Buffer.from(JSON.stringify({ type: 'seed', seed: '12'.repeat(32) }))])
    )
    keys = new WalletKeyStorage(storage, directory)
    vi.useFakeTimers()
    const keypair = await keys.load()
    const onLock = vi.fn()
    keys.setOnLock(onLock)
    keys.setPageOpen(true)
    let approve!: (value: boolean) => void
    mocks.approval.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve
        })
    )
    let finishSigning!: () => void
    const signing = vi.fn(async () => {
      expect(keypair.secretKey.some((byte) => byte !== 0)).toBe(true)
      await new Promise<void>((resolve) => {
        finishSigning = resolve
      })
      if (outcome === 'signing-error') throw new Error('network failure')
      return 'signed-boc'
    })
    const registry = {
      walletManager: {
        getState: () => ({ isCreated: true, backupVerified: true, addressRaw: mocks.poolAddress }),
        getIdentitySnapshot: () => ({}),
        withAutoLockPaused: keys.withAutoLockPaused.bind(keys),
        preflightContractMessage: async () => ({ estimatedFee: '1', walletBalance: '10' }),
        signTonConnectTransaction: signing,
      },
      tonBridgeProviders: { zkResistor: { getBridge: () => ({}) } },
      overlayManager: {},
    } as unknown as ServiceRegistry
    registerZkResistorHandlers(registry)
    const pending = mocks.handlers.get('zkresistor:send')!({
      operation,
      poolAddress: mocks.poolAddress,
      value: '1',
      payload: '',
    } as never).catch((error: Error) => error.message)
    await vi.waitFor(() => expect(mocks.approval).toHaveBeenCalled())
    keys.setPageOpen(false)
    vi.advanceTimersByTime(10 * 60_000)
    expect(onLock).not.toHaveBeenCalled()
    approve(outcome !== 'cancel')
    if (outcome !== 'cancel') {
      await vi.waitFor(() => expect(signing).toHaveBeenCalled())
      vi.advanceTimersByTime(10 * 60_000)
      expect(onLock).not.toHaveBeenCalled()
      finishSigning()
    }
    expect(await pending).toEqual(
      outcome === 'success' ? { boc: 'signed-boc' } : outcome === 'cancel' ? 'USER_CANCELLED' : 'SIGNING_FAILED'
    )
    vi.advanceTimersByTime(300_000 - 1)
    expect(onLock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledOnce()
    expect(keypair.secretKey.every((byte) => byte === 0)).toBe(true)
  }
)
