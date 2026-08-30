/**
 * Unit tests for cocoon/setup.ts.
 *
 * Mocks:
 *  - loadCocoonWallet (wallet.ts) — controls whether a wallet exists on disk.
 *  - sendFromOwnerWallet (contracts.ts) — avoids real crypto / bridge calls.
 *  - WsBridgeClient — created inline with vi.fn() stubs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../wallet', () => ({
  loadCocoonWallet: vi.fn(),
}))

vi.mock('../contracts', () => ({
  sendFromOwnerWallet: vi.fn(),
}))

// Import AFTER mocks are declared
import { getOwnerBalance, getCocoonWalletBalance, fundCocoonFromOwner } from '../setup'
import { loadCocoonWallet } from '../wallet'
import { sendFromOwnerWallet } from '../contracts'
import type { WsBridgeClient } from '../../ton-bridge/ws-bridge-client'

// ── Helpers ──────────────────────────────────────────────────────────────────

// Use real-format TON addresses (base64url with checksum).
// These are the well-known Cocoon root contract address reused as fixtures.
const VALID_TON_ADDRESS = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

const MOCK_WALLET_DATA = {
  ownerMnemonic: ['word1', 'word2', 'word3'],
  nodeSecretBase64: 'AAAA',
  nodePublicKeyHex: 'aabbccdd',
  ownerAddress: VALID_TON_ADDRESS,
  nodeAddress: VALID_TON_ADDRESS,
  createdAt: 1_700_000_000_000,
}

function makeBridge(balance = '2000000000'): WsBridgeClient {
  return {
    getBalance: vi.fn(() => Promise.resolve(balance)),
  } as unknown as WsBridgeClient
}

// ── getOwnerBalance ───────────────────────────────────────────────────────────

describe('getOwnerBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the bridge balance as bigint', async () => {
    vi.mocked(loadCocoonWallet).mockResolvedValue(MOCK_WALLET_DATA)
    const bridge = makeBridge('3000000000')

    const result = await getOwnerBalance(bridge)

    expect(result).toBe(3_000_000_000n)
    expect(bridge.getBalance).toHaveBeenCalledWith(MOCK_WALLET_DATA.ownerAddress)
  })

  it('throws when no wallet exists', async () => {
    vi.mocked(loadCocoonWallet).mockResolvedValue(null)
    await expect(getOwnerBalance(makeBridge())).rejects.toThrow('Cocoon wallet not initialized')
  })
})

// ── getCocoonWalletBalance ───────────────────────────────────────────────────

describe('getCocoonWalletBalance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the cocoon node wallet balance via the bridge', async () => {
    vi.mocked(loadCocoonWallet).mockResolvedValue(MOCK_WALLET_DATA)
    const bridge = makeBridge('19500000000') // 19.5 TON

    const result = await getCocoonWalletBalance(bridge)

    expect(result).toBe(19_500_000_000n)
    // Critical: queries the NODE address (cocoon_wallet SC), NOT the owner.
    expect(bridge.getBalance).toHaveBeenCalledWith(MOCK_WALLET_DATA.nodeAddress)
  })

  it('returns 0n when cocoon node wallet has no balance yet (pre-funding)', async () => {
    vi.mocked(loadCocoonWallet).mockResolvedValue(MOCK_WALLET_DATA)
    const bridge = makeBridge('0')

    const result = await getCocoonWalletBalance(bridge)

    expect(result).toBe(0n)
  })

  it('throws when no wallet exists', async () => {
    vi.mocked(loadCocoonWallet).mockResolvedValue(null)
    await expect(getCocoonWalletBalance(makeBridge())).rejects.toThrow('Cocoon wallet not initialized')
  })
})

// ── fundCocoonFromOwner ───────────────────────────────────────────────────────

const RESERVE = 500_000_000n

describe('fundCocoonFromOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadCocoonWallet).mockResolvedValue(MOCK_WALLET_DATA)
    vi.mocked(sendFromOwnerWallet).mockResolvedValue({ bocHash: 'deadbeef', seqno: 7 })
  })

  describe("amount = 'max'", () => {
    it('sends balance minus gas reserve', async () => {
      const balance = '2000000000' // 2 TON
      const bridge = makeBridge(balance)

      const result = await fundCocoonFromOwner(bridge, 'max')

      const expected = BigInt(balance) - RESERVE // 1.5 TON
      expect(result.sentAmount).toBe(expected)
      expect(result.bocHash).toBe('deadbeef')
      expect(result.seqno).toBe(7)
      expect(sendFromOwnerWallet).toHaveBeenCalledWith(
        bridge,
        MOCK_WALLET_DATA.ownerMnemonic,
        expect.anything(), // Address.parse(nodeAddress)
        expected
      )
    })

    it('throws when balance equals the gas reserve exactly', async () => {
      const bridge = makeBridge(RESERVE.toString()) // exactly 0.5 TON
      await expect(fundCocoonFromOwner(bridge, 'max')).rejects.toThrow('too low to fund cocoon')
    })

    it('throws when balance is below the gas reserve', async () => {
      const bridge = makeBridge('100000000') // 0.1 TON
      await expect(fundCocoonFromOwner(bridge, 'max')).rejects.toThrow('too low to fund cocoon')
    })
  })

  describe('explicit amount', () => {
    it('sends the specified amount when it fits within available balance', async () => {
      const bridge = makeBridge('2000000000') // 2 TON; available = 1.5 TON
      const send = 300_000_000n // 0.3 TON

      const result = await fundCocoonFromOwner(bridge, send)

      expect(result.sentAmount).toBe(send)
      expect(sendFromOwnerWallet).toHaveBeenCalledWith(bridge, MOCK_WALLET_DATA.ownerMnemonic, expect.anything(), send)
    })

    it('throws when explicit amount exceeds available balance minus reserve', async () => {
      // balance = 0.6 TON, reserve = 0.5 TON, available = 0.1 TON
      const bridge = makeBridge('600000000')
      await expect(fundCocoonFromOwner(bridge, 200_000_000n)).rejects.toThrow('exceeds balance minus gas reserve')
    })

    it('throws for zero amount', async () => {
      const bridge = makeBridge('2000000000')
      await expect(fundCocoonFromOwner(bridge, 0n)).rejects.toThrow('Amount must be positive')
    })

    it('throws for negative amount', async () => {
      const bridge = makeBridge('2000000000')
      await expect(fundCocoonFromOwner(bridge, -1n)).rejects.toThrow('Amount must be positive')
    })
  })

  it('throws when no wallet exists', async () => {
    vi.mocked(loadCocoonWallet).mockResolvedValue(null)
    await expect(fundCocoonFromOwner(makeBridge(), 'max')).rejects.toThrow('Cocoon wallet not initialized')
  })
})
