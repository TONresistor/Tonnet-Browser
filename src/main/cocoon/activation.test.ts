import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadCocoonWallet,
  generateCocoonWallet,
  getStakeInfo,
  cashout,
  loadStakeCache,
  retireCurrentCocoonWallet,
  startCocoonManager,
} = vi.hoisted(() => ({
  loadCocoonWallet: vi.fn(),
  generateCocoonWallet: vi.fn(),
  getStakeInfo: vi.fn(),
  cashout: vi.fn(),
  loadStakeCache: vi.fn(),
  retireCurrentCocoonWallet: vi.fn(),
  startCocoonManager: vi.fn(),
}))

vi.mock('./wallet', () => ({ loadCocoonWallet, generateCocoonWallet }))
vi.mock('./unstake', () => ({ getStakeInfo, cashout }))
vi.mock('./stake-cache', () => ({ getStakeCacheStore: () => ({ load: loadStakeCache }) }))
vi.mock('./retire-wallet', () => ({ retireCurrentCocoonWallet }))
vi.mock('./lifecycle', () => ({ startCocoonManager }))

import { flowStake, type CocoonActivationPorts } from './activation'

const NATIVE_IDENTITY = { publicKey: '11'.repeat(32), addressRaw: '0:' + '22'.repeat(32), revision: 1 }

function createPorts(overrides: Partial<CocoonActivationPorts> = {}): CocoonActivationPorts {
  return {
    cocoonManager: { getHttpPort: vi.fn(() => 10_000) } as unknown as CocoonActivationPorts['cocoonManager'],
    getBridge: vi.fn(() => ({ getBalance: vi.fn(() => Promise.resolve('0')) }) as never),
    getNativeIdentity: vi.fn(() => NATIVE_IDENTITY),
    getNativeBalance: vi.fn(() => Promise.resolve('30000000000')),
    sendNative: vi.fn(() => Promise.resolve()),
    persistence: {
      stakeCache: { load: loadStakeCache },
      consumedArchive: {},
      recoveryQueue: {},
    } as never,
    ...overrides,
  }
}

describe('Cocoon activation ports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadCocoonWallet.mockResolvedValue(null)
    generateCocoonWallet.mockResolvedValue({ nodeAddress: 'UQ-node' })
    getStakeInfo.mockResolvedValue(null)
    loadStakeCache.mockResolvedValue(null)
    startCocoonManager.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails before reading domain state when the bridge port is unavailable', async () => {
    const ports = createPorts({ getBridge: () => null })
    await expect(flowStake(ports)).rejects.toThrow('Bridge not connected')
    expect(loadCocoonWallet).not.toHaveBeenCalled()
  })

  it('uses the idempotent active-stake path without rotating or spending', async () => {
    loadCocoonWallet.mockResolvedValue({ nodeAddress: 'UQ-node' })
    getStakeInfo.mockResolvedValue({ status: 'active' })
    const ports = createPorts()

    await expect(flowStake(ports)).resolves.toEqual({ httpPort: 10_000 })

    expect(startCocoonManager).toHaveBeenCalledWith(ports.cocoonManager)
    expect(ports.sendNative).not.toHaveBeenCalled()
    expect(generateCocoonWallet).not.toHaveBeenCalled()
  })

  it('funds a fresh node through the narrow native-wallet port', async () => {
    vi.useFakeTimers()
    const ports = createPorts()

    const activation = flowStake(ports)
    await vi.runAllTimersAsync()
    await expect(activation).resolves.toEqual({ httpPort: 10_000 })

    expect(generateCocoonWallet).toHaveBeenCalledOnce()
    expect(ports.getNativeBalance).toHaveBeenCalledWith(NATIVE_IDENTITY)
    expect(ports.sendNative).toHaveBeenCalledWith('UQ-node', '20000000000', NATIVE_IDENTITY)
    expect(startCocoonManager).toHaveBeenCalledWith(ports.cocoonManager)
  })

  it('keeps the activation funding bound to the identity captured at entry', async () => {
    vi.useFakeTimers()
    const getNativeIdentity = vi.fn(() => NATIVE_IDENTITY)
    const ports = createPorts({ getNativeIdentity })

    const activation = flowStake(ports)
    await vi.runAllTimersAsync()
    await activation

    expect(getNativeIdentity).toHaveBeenCalledOnce()
    expect(ports.getNativeBalance).toHaveBeenCalledWith(NATIVE_IDENTITY)
    expect(ports.sendNative).toHaveBeenCalledWith('UQ-node', '20000000000', NATIVE_IDENTITY)
  })

  it('rejects insufficient native balance without generating a transfer', async () => {
    const ports = createPorts({ getNativeBalance: vi.fn(() => Promise.resolve('20000000000')) })

    await expect(flowStake(ports)).rejects.toThrow('Top up your TON wallet')
    expect(ports.sendNative).not.toHaveBeenCalled()
    expect(startCocoonManager).not.toHaveBeenCalled()
  })

  it.each(['0', '20000000000'])(
    'retires a closed cycle with an old funding reference and balance %s',
    async (balance) => {
      vi.useFakeTimers()
      loadCocoonWallet.mockResolvedValue({ nodeAddress: 'old-node' })
      getStakeInfo.mockResolvedValue({ status: 'closed' })
      loadStakeCache.mockResolvedValue({
        clientSCAddress: 'closed-client',
        fundingOperations: {
          'activation:old-node': {
            operationId: 'old-funding',
            amount: '20000000000',
            sourceAddress: NATIVE_IDENTITY.addressRaw,
          },
        },
      })
      const ports = createPorts({ getBridge: () => ({ getBalance: vi.fn(async () => balance) }) as never })
      const outcome = flowStake(ports).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      await vi.runAllTimersAsync()
      expect(await outcome).toEqual({ value: { httpPort: 10_000 } })
      expect(retireCurrentCocoonWallet).toHaveBeenCalledOnce()
      expect(generateCocoonWallet).toHaveBeenCalledOnce()
      expect(ports.sendNative).toHaveBeenCalledOnce()
      expect(ports.sendNative).toHaveBeenCalledWith('UQ-node', '20000000000', NATIVE_IDENTITY)
    }
  )

  it('resumes an interrupted funding step before a client contract exists', async () => {
    vi.useFakeTimers()
    loadCocoonWallet.mockResolvedValue({ nodeAddress: 'old-node' })
    loadStakeCache.mockResolvedValue({
      fundingOperations: {
        'activation:old-node': {
          operationId: 'pending-funding',
          amount: '20000000000',
          sourceAddress: NATIVE_IDENTITY.addressRaw,
        },
      },
    })
    const getBalance = vi.fn().mockResolvedValue('0')
    const ports = createPorts({ getBridge: () => ({ getBalance }) as never })
    const activation = flowStake(ports)
    await vi.runAllTimersAsync()
    await expect(activation).resolves.toEqual({ httpPort: 10_000 })
    expect(ports.sendNative).toHaveBeenCalledWith('old-node', '20000000000', NATIVE_IDENTITY)
    expect(retireCurrentCocoonWallet).not.toHaveBeenCalled()
    expect(generateCocoonWallet).not.toHaveBeenCalled()
  })

  it.each(['0', '5000000000'])(
    'resumes a confirmed funding step with missing client metadata and residual balance %s',
    async (balance) => {
      vi.useFakeTimers()
      loadCocoonWallet.mockResolvedValue({ nodeAddress: 'old-node' })
      loadStakeCache.mockResolvedValue({
        fundingOperations: {
          'activation:old-node': {
            operationId: 'confirmed-funding',
            amount: '20000000000',
            sourceAddress: NATIVE_IDENTITY.addressRaw,
          },
        },
      })
      const ports = createPorts({ getBridge: () => ({ getBalance: vi.fn(async () => balance) }) as never })
      const activation = flowStake(ports).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      )
      await vi.runAllTimersAsync()
      expect(await activation).toEqual({ value: { httpPort: 10_000 } })
      expect(ports.sendNative).toHaveBeenCalledExactlyOnceWith('old-node', '20000000000', NATIVE_IDENTITY)
      expect(startCocoonManager).toHaveBeenCalledWith(ports.cocoonManager)
      expect(ports.getNativeBalance).not.toHaveBeenCalled()
      expect(retireCurrentCocoonWallet).not.toHaveBeenCalled()
      expect(generateCocoonWallet).not.toHaveBeenCalled()
    }
  )

  it('does not restart or rotate while the previous funding is unconfirmed', async () => {
    vi.useFakeTimers()
    loadCocoonWallet.mockResolvedValue({ nodeAddress: 'old-node' })
    loadStakeCache.mockResolvedValue({
      fundingOperations: {
        'activation:old-node': {
          operationId: 'pending-funding',
          amount: '20000000000',
          sourceAddress: NATIVE_IDENTITY.addressRaw,
        },
      },
    })
    let rejectFunding!: (error: Error) => void
    const funding = new Promise<void>((_, reject) => {
      rejectFunding = reject
    })
    const ports = createPorts({ sendNative: vi.fn(() => funding) })
    const activation = expect(flowStake(ports)).rejects.toThrow('Cocoon funding is pending confirmation')
    await vi.runAllTimersAsync()
    expect(ports.sendNative).toHaveBeenCalledExactlyOnceWith('old-node', '20000000000', NATIVE_IDENTITY)
    expect(startCocoonManager).not.toHaveBeenCalled()
    rejectFunding(new Error('Cocoon funding is pending confirmation'))
    await activation
    expect(startCocoonManager).not.toHaveBeenCalled()
    expect(retireCurrentCocoonWallet).not.toHaveBeenCalled()
    expect(generateCocoonWallet).not.toHaveBeenCalled()
  })

  it.each(['closing', 'cooldown', 'refundable', 'unknown'] as const)(
    'does not reuse old funding while the known client is %s',
    async (status) => {
      loadCocoonWallet.mockResolvedValue({ nodeAddress: 'old-node' })
      getStakeInfo.mockResolvedValue(status === 'unknown' ? null : { status })
      loadStakeCache.mockResolvedValue({
        clientSCAddress: 'known-client',
        fundingOperations: {
          'activation:old-node': {
            operationId: 'old-funding',
            amount: '20000000000',
            sourceAddress: NATIVE_IDENTITY.addressRaw,
          },
        },
      })
      const ports = createPorts({ getBridge: () => ({ getBalance: vi.fn(async () => '20000000000') }) as never })
      await expect(flowStake(ports)).rejects.toThrow('Finish withdrawal/recovery first')
      expect(ports.sendNative).not.toHaveBeenCalled()
      expect(startCocoonManager).not.toHaveBeenCalled()
      expect(retireCurrentCocoonWallet).not.toHaveBeenCalled()
    }
  )
})
