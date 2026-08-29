import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ISecureStorage } from '../../ports/secure-storage'

const bridgeState = vi.hoisted(() => {
  const instances: Array<{
    port: number
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }> = []
  const failures = new Map<number, number>()
  class Client {
    connect: ReturnType<typeof vi.fn>
    disconnect = vi.fn()

    constructor(readonly port: number) {
      this.connect = vi.fn(async () => {
        const remaining = failures.get(port) ?? 0
        if (remaining > 0) {
          failures.set(port, remaining - 1)
          throw new Error('bridge unavailable')
        }
      })
      instances.push(this)
    }
  }
  return { Client, failures, instances }
})

vi.mock('../../ton-bridge/ws-bridge-client', () => ({ WsBridgeClient: bridgeState.Client }))
vi.mock('../../settings', () => ({ getSetting: vi.fn(() => ({ wsPort: 8081 })) }))
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }))
vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    status: vi.fn(),
  }),
}))

import { WalletManager } from '../manager'

class MemoryStorage implements ISecureStorage {
  isAvailable(): boolean {
    return true
  }

  encrypt(plaintext: string): Buffer {
    return Buffer.from(plaintext)
  }

  decrypt(encrypted: Buffer): string {
    return encrypted.toString()
  }

  getBackendName(): string {
    return 'memory'
  }
}

interface WalletBridgeState {
  wsBridge: {
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  } | null
  wsBridgePort: number | null
}

function prepareManager() {
  const manager = new WalletManager(new MemoryStorage())
  const previous = { connect: vi.fn(async () => {}), disconnect: vi.fn() }
  const state = manager as unknown as WalletBridgeState
  state.wsBridge = previous
  state.wsBridgePort = 8081
  return { manager, previous, state }
}

describe('WalletManager.applyBridgePort', () => {
  beforeEach(() => {
    bridgeState.instances.length = 0
    bridgeState.failures.clear()
  })

  afterEach(() => vi.useRealTimers())

  it('connects the replacement before disconnecting the current bridge', async () => {
    const { manager, previous, state } = prepareManager()

    await manager.applyBridgePort(9091)

    const replacement = bridgeState.instances[0]
    expect(replacement.port).toBe(9091)
    expect(replacement.connect).toHaveBeenCalledOnce()
    expect(previous.disconnect).toHaveBeenCalledOnce()
    expect(replacement.connect.mock.invocationCallOrder[0]).toBeLessThan(
      previous.disconnect.mock.invocationCallOrder[0]
    )
    expect(state.wsBridge).toBe(replacement)
    expect(state.wsBridgePort).toBe(9091)
  })

  it('keeps the current bridge when the replacement never becomes ready', async () => {
    vi.useFakeTimers()
    bridgeState.failures.set(9091, 20)
    const { manager, previous, state } = prepareManager()

    const applying = manager.applyBridgePort(9091)
    const rejection = expect(applying).rejects.toThrow('bridge unavailable')
    await vi.advanceTimersByTimeAsync(2_000)
    await rejection

    const replacement = bridgeState.instances[0]
    expect(replacement.connect).toHaveBeenCalledTimes(20)
    expect(replacement.disconnect).toHaveBeenCalledOnce()
    expect(previous.disconnect).not.toHaveBeenCalled()
    expect(state.wsBridge).toBe(previous)
    expect(state.wsBridgePort).toBe(8081)
  })

  it('retries the current bridge without creating a duplicate client', async () => {
    vi.useFakeTimers()
    const { manager, previous } = prepareManager()
    previous.connect.mockRejectedValueOnce(new Error('starting')).mockResolvedValueOnce(undefined)

    const applying = manager.applyBridgePort(8081)
    await vi.advanceTimersByTimeAsync(100)
    await applying

    expect(previous.connect).toHaveBeenCalledTimes(2)
    expect(bridgeState.instances).toHaveLength(0)
    expect(previous.disconnect).not.toHaveBeenCalled()
  })
})
