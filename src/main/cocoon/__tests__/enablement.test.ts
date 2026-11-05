import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CocoonManager } from '../manager'
import { autostartCocoonIfEnabled } from '../autostart'
import { startCocoonManager } from '../lifecycle'
import { flowStake, type CocoonActivationPorts } from '../activation'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
  ready: vi.fn(async () => {}),
  directory: vi.fn(),
  getSetting: vi.fn(() => ({ enabled: true, autostart: true })),
  loadWallet: vi.fn(async () => ({
    setupCompletedAt: 1,
    ownerAddress: 'test-owner',
    nodeAddress: 'test-node',
    nodeSecretBase64: 'test-key',
  })),
}))
vi.mock('../../settings', () => ({ getSetting: mocks.getSetting }))
vi.mock('../wallet', () => ({ loadCocoonWallet: mocks.loadWallet }))
vi.mock('../unstake', () => ({ getStakeInfo: async () => null, cashout: vi.fn() }))
vi.mock('../retire-wallet', () => ({ retireCurrentCocoonWallet: vi.fn() }))
vi.mock('../platform', () => ({ checkCocoonAvailability: () => ({ available: true }) }))
vi.mock('../paths', () => ({
  getCocoonBinaryPath: () => 'test-runner',
  getTonConfigPath: () => 'test-config',
  getClientConfigTemplatePath: () => 'test-template',
}))
vi.mock('fs/promises', () => ({
  mkdtemp: mocks.directory,
  chmod: async () => {},
  readFile: async () => '{}',
  writeFile: async () => {},
  copyFile: mocks.copyFile,
  rm: async () => {},
}))
vi.mock('../../native-process/supervisor', () => ({
  NativeProcessSupervisor: class {
    start = mocks.start
    stop = mocks.stop
    waitForReady = mocks.ready
  },
}))
const config = { ownerAddress: 'test-owner', nodeWalletKeyBase64: 'test-key', rootContractAddress: 'test-root' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.directory.mockImplementation(async () => `/tmp/test-cocoon-${crypto.randomUUID()}`)
  mocks.getSetting.mockReturnValue({ enabled: true, autostart: true })
})
afterEach(() => vi.useRealTimers())
it('skips autostart when disabled even if autostart was enabled before', async () => {
  mocks.getSetting.mockReturnValue({ enabled: false, autostart: true })
  await autostartCocoonIfEnabled(new CocoonManager(false))
  expect(mocks.loadWallet).not.toHaveBeenCalled()
  expect(mocks.start).not.toHaveBeenCalled()
})
it('stops a running service and blocks starts until re-enabled', async () => {
  const manager = new CocoonManager()
  await manager.start(config)
  expect(manager.getState().kind).toBe('ready')
  await manager.setEnabled(false)
  expect(manager.getState().kind).toBe('stopped')
  expect(mocks.stop).toHaveBeenCalledOnce()
  await expect(manager.start(config)).rejects.toThrow('disabled')
  expect(mocks.start).toHaveBeenCalledOnce()
  await manager.setEnabled(true)
  expect(mocks.start).toHaveBeenCalledOnce()
  await manager.start(config)
  expect(mocks.start).toHaveBeenCalledTimes(2)
})
it.each(['disable', 'stop'] as const)(
  'does not spawn a runner after %s while startup files are being prepared',
  async (action) => {
    let finish!: () => void
    mocks.copyFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const manager = new CocoonManager()
    const starting = manager.start(config)
    const failure = expect(starting).rejects.toThrow(action === 'disable' ? 'disabled' : 'cancelled')
    await vi.waitFor(() => expect(mocks.copyFile).toHaveBeenCalled())
    if (action === 'disable') await manager.setEnabled(false)
    else await manager.stop()
    finish()
    await failure
    expect(mocks.start).not.toHaveBeenCalled()
    expect(manager.getState().kind).toBe('stopped')
  }
)

it.each(['balance', 'propagation'] as const)(
  'cancels a pending activation at %s and allows a later explicit start',
  async (boundary) => {
    vi.useFakeTimers()
    const manager = new CocoonManager()
    const identity = { publicKey: '11'.repeat(32), addressRaw: '0:' + '22'.repeat(32), revision: 1 }
    let finishBalance!: (value: string) => void
    const balance = new Promise<string>((resolve) => {
      finishBalance = resolve
    })
    const getBalance = vi.fn(async () => '5000000000')
    if (boundary === 'balance') getBalance.mockReturnValueOnce(balance)
    const ports: CocoonActivationPorts = {
      cocoonManager: manager,
      getBridge: () => ({ getBalance }) as never,
      getNativeIdentity: () => identity,
      getNativeBalance: async () => '30000000000',
      sendNative: vi.fn(async () => {}),
      persistence: {
        stakeCache: {
          load: async () => ({
            fundingOperations: {
              'activation:test-node': {
                operationId: 'funding',
                amount: '20000000000',
                sourceAddress: identity.addressRaw,
              },
            },
          }),
        },
      } as never,
    }
    const failure = expect(flowStake(ports)).rejects.toThrow('cancelled')
    await vi.advanceTimersByTimeAsync(0)
    expect(getBalance).toHaveBeenCalledOnce()
    await manager.stop()
    finishBalance('5000000000')
    await vi.advanceTimersByTimeAsync(1500)
    await failure
    expect(mocks.start).not.toHaveBeenCalled()
    expect(ports.sendNative).toHaveBeenCalledTimes(boundary === 'balance' ? 0 : 1)
    expect(manager.getState().kind).toBe('stopped')

    const restarting = flowStake(ports)
    await vi.runAllTimersAsync()
    await expect(restarting).resolves.toEqual({ httpPort: 10000 })
    expect(mocks.start).toHaveBeenCalledOnce()
    await manager.stop()
  }
)

it('ignores a late readiness response after stop without disturbing a newer start', async () => {
  let finish!: () => void
  mocks.ready.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const manager = new CocoonManager()
  const failure = expect(manager.start(config)).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce())
  await manager.stop()
  await manager.start(config)
  finish()
  await failure
  expect(manager.getState().kind).toBe('ready')
  expect(mocks.start).toHaveBeenCalledTimes(2)
  expect(mocks.stop).toHaveBeenCalledOnce()
  await manager.stop()
})

it('does not spawn when a state observer stops the pending start', async () => {
  const manager = new CocoonManager()
  let stopping: Promise<void> | undefined
  manager.on('state-change', (state) => {
    if (state.kind === 'starting' && state.phase === 'client-runner') stopping = manager.stop()
  })
  await expect(manager.start(config)).rejects.toThrow('cancelled')
  await stopping
  expect(mocks.start).not.toHaveBeenCalled()
  expect(manager.getState().kind).toBe('stopped')
})

it.each([false, true])(
  'preserves an internal readiness retry unless an external stop cancels it: %s',
  async (cancel) => {
    vi.useFakeTimers()
    mocks.ready.mockRejectedValueOnce(new Error('Process readiness timed out after 180000ms'))
    const manager = new CocoonManager()
    const starting = startCocoonManager(manager).then(
      () => ({ ready: true }),
      (error: unknown) => ({ error })
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(manager.getState().kind).toBe('stopped')
    if (cancel) await manager.stop()
    await vi.advanceTimersByTimeAsync(1500)
    if (cancel) {
      expect(await starting).toMatchObject({
        error: expect.objectContaining({ message: expect.stringContaining('cancelled') }),
      })
      expect(mocks.start).toHaveBeenCalledOnce()
    } else {
      expect(await starting).toEqual({ ready: true })
      expect(mocks.start).toHaveBeenCalledTimes(2)
      expect(manager.getState().kind).toBe('ready')
    }
    await manager.stop()
  }
)
