import { describe, expect, it, vi } from 'vitest'
import type { BridgeProvider } from '../../ports/bridge-provider'
import type { ISecureStorage } from '../../ports/secure-storage'
import type { WalletBridgePort } from '../bridge-port'
import { WalletManager } from '../manager'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/test') } }))

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

function subscriptionBridge() {
  const disposeAccount = vi.fn()
  const disposeTransactions = vi.fn()
  const bridge = {
    getBalance: vi.fn(() => Promise.resolve('0')),
    getSeqno: vi.fn(() => Promise.resolve(0)),
    subscribeAccountState: vi.fn(() => disposeAccount),
    subscribeTransactions: vi.fn(() => disposeTransactions),
  } as unknown as WalletBridgePort
  return { bridge, disposeAccount, disposeTransactions }
}

describe('WalletManager bridge provider', () => {
  it('moves wallet subscriptions to a replacement bridge', () => {
    let current: WalletBridgePort | null = null
    let changed: (bridge: WalletBridgePort | null) => void = () => {}
    const provider: BridgeProvider<WalletBridgePort> = {
      getBridge: () => current,
      onBridgeChanged: (listener) => {
        changed = listener
        return () => {
          changed = () => {}
        }
      },
    }
    const manager = new WalletManager(new MemoryStorage(), provider)
    ;(
      manager as unknown as { walletContract: { address: { toString(): string; toRawString(): string } } }
    ).walletContract = {
      address: { toString: () => 'UQWallet', toRawString: () => '0:wallet' },
    }
    ;(manager as unknown as { initialized: boolean }).initialized = true
    const first = subscriptionBridge()
    const second = subscriptionBridge()

    current = first.bridge
    changed(first.bridge)
    current = second.bridge
    changed(second.bridge)

    expect(first.bridge.subscribeAccountState).toHaveBeenCalledOnce()
    expect(first.bridge.subscribeTransactions).toHaveBeenCalledOnce()
    expect(first.disposeAccount).toHaveBeenCalledOnce()
    expect(first.disposeTransactions).toHaveBeenCalledOnce()
    expect(second.bridge.subscribeAccountState).toHaveBeenCalledOnce()
    expect(second.bridge.subscribeTransactions).toHaveBeenCalledOnce()
  })
})
