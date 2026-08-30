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
})
