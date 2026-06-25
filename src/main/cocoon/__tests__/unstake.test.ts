/**
 * Unit tests for cocoon/unstake.ts.
 *
 * Mocks:
 *  - runner-api    — controls fetchJsonStats / runnerClose without real HTTP.
 *  - bridge-provider — short-circuits the on-chain CocoonClient.getData read.
 *  - wallet / contracts — avoid real crypto.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../runner-api', () => ({
  fetchJsonStats: vi.fn(),
  requestRefund: vi.fn(),
}))

vi.mock('../contracts/bridge-provider', () => ({
  openBridgeContract: vi.fn(),
}))

vi.mock('../wallet', () => ({
  loadCocoonWallet: vi.fn(),
  getNodeSecretBuffer: vi.fn(),
}))

vi.mock('../contracts', () => ({
  sendFromCocoonWallet: vi.fn(),
  sendFromOwnerWallet: vi.fn(),
  buildCocoonWalletInit: vi.fn(() => ({ code: {}, data: {} })),
}))

// Avoid `electron.app.getPath()` at module load — replace the cache store with
// in-memory stubs whose load/save can be stubbed per test.
const cacheStore = {
  load: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(undefined),
  saveStakeAddresses: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
}
vi.mock('../stake-cache', () => ({
  getStakeCacheStore: () => cacheStore,
}))

import { getStakeInfo, unstake, cashout } from '../unstake'
import { fetchJsonStats, requestRefund as runnerClose } from '../runner-api'
import { openBridgeContract } from '../contracts/bridge-provider'
import { loadCocoonWallet, getNodeSecretBuffer } from '../wallet'
import { sendFromCocoonWallet, sendFromOwnerWallet } from '../contracts'
import type { CocoonManager } from '../manager'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'

const VALID_ADDR = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'
const OWNER_ADDR = 'EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N'
const NATIVE_ADDR = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

function makeManager(state: 'stopped' | 'starting' | 'ready' | 'crashed', httpPort = 10000): CocoonManager {
  return {
    getState: vi.fn(() => {
      if (state === 'ready') return { kind: 'ready', httpPort }
      if (state === 'starting') return { kind: 'starting', phase: 'client-runner' }
      if (state === 'crashed') return { kind: 'crashed', error: 'boom' }
      return { kind: 'stopped' }
    }),
    getHttpPort: vi.fn(() => httpPort),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as CocoonManager
}

function makeBridge(balanceByAddr: Record<string, string> = {}): WsBridgeClient {
  return {
    getBalance: vi.fn(async (addr: string) => balanceByAddr[addr] ?? '0'),
  } as unknown as WsBridgeClient
}

const MOCK_STATS_REGISTERED = {
  status: { wallet_balance: 1_000_000_000, enabled: true },
  localconf: { root_address: VALID_ADDR, owner_address: VALID_ADDR },
  proxy_connections: [{ address: '127.0.0.1:1234', is_ready: true, proxy_sc_address: VALID_ADDR }],
  proxies: [
    {
      proxy_sc_address: VALID_ADDR,
      proxy_public_key: 'aa'.repeat(32),
      sc_address: VALID_ADDR,
      state: 0 as const,
      tokens_used_proxy_committed_to_blockchain: 0,
      tokens_used_proxy_committed_to_db: 0,
      tokens_used_proxy_max: 0,
      tokens_charged: 100,
      tokens_payed: 200,
    },
  ],
}

function mockOpenedClient(data: {
  state: number
  balance: bigint
  stake: bigint
  unlockTs: number
  tokensUsed: bigint
}): void {
  vi.mocked(openBridgeContract).mockReturnValue({
    getData: vi.fn().mockResolvedValue({
      ownerAddress: VALID_ADDR,
      proxyAddress: VALID_ADDR,
      proxyPublicKey: 0n,
      state: data.state,
      balance: data.balance,
      stake: data.stake,
      tokensUsed: data.tokensUsed,
      unlockTs: data.unlockTs,
      secretHash: 0n,
    }),
  } as unknown as ReturnType<typeof openBridgeContract>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadCocoonWallet).mockResolvedValue({
    ownerMnemonic: ['x'],
    nodeSecretBase64: 'AAAA',
    nodePublicKeyHex: 'aa',
    ownerAddress: OWNER_ADDR,
    nodeAddress: VALID_ADDR,
    createdAt: 0,
    setupCompletedAt: 0,
  })
  cacheStore.load.mockResolvedValue(null)
  cacheStore.save.mockResolvedValue(undefined)
  cacheStore.saveStakeAddresses.mockResolvedValue(undefined)
  cacheStore.clear.mockResolvedValue(undefined)
})

// ── getStakeInfo ────────────────────────────────────────────────────────────

describe('getStakeInfo', () => {
  it('returns null when runner is stopped and no cache exists', async () => {
    const manager = makeManager('stopped')
    const bridge = makeBridge()
    const result = await getStakeInfo(manager, bridge)
    expect(result).toBeNull()
    expect(fetchJsonStats).not.toHaveBeenCalled()
  })

  it('returns null when runner is ready but no proxy is registered (and no cache)', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge()
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({
      ...MOCK_STATS_REGISTERED,
      proxies: [],
    })
    const result = await getStakeInfo(manager, bridge)
    expect(result).toBeNull()
  })

  it('falls back to cache when /jsonstats throws', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge({ [VALID_ADDR]: '500000000' })
    vi.mocked(fetchJsonStats).mockRejectedValueOnce(new Error('ECONNREFUSED'))
    cacheStore.load.mockResolvedValueOnce({
      proxySCAddress: VALID_ADDR,
      clientSCAddress: VALID_ADDR,
      ownerAddress: VALID_ADDR,
      cachedAt: Date.now(),
    })
    mockOpenedClient({ state: 0, balance: 19_500_000_000n, stake: 20_000_000_000n, unlockTs: 0, tokensUsed: 100n })
    const result = await getStakeInfo(manager, bridge)
    expect(result).not.toBeNull()
    expect(result!.runnerStatus).toBe('ready')
    expect(result!.balance).toBe('19500000000')
  })

  it('reads from cache + on-chain when runner is stopped', async () => {
    const manager = makeManager('stopped')
    const bridge = makeBridge({ [VALID_ADDR]: '300000000' })
    cacheStore.load.mockResolvedValueOnce({
      proxySCAddress: VALID_ADDR,
      clientSCAddress: VALID_ADDR,
      ownerAddress: VALID_ADDR,
      cachedAt: Date.now(),
    })
    mockOpenedClient({
      state: 1,
      balance: 20_000_000_000n,
      stake: 20_000_000_000n,
      unlockTs: Math.floor(Date.now() / 1000) + 3600,
      tokensUsed: 100n,
    })
    const result = await getStakeInfo(manager, bridge)
    expect(result).not.toBeNull()
    expect(result!.runnerStatus).toBe('stopped')
    expect(result!.status).toBe('cooldown')
    expect(fetchJsonStats).not.toHaveBeenCalled()
  })

  it('persists the proxy + client addresses on a successful live read', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge({ [VALID_ADDR]: '500000000' })
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({ ...MOCK_STATS_REGISTERED })
    mockOpenedClient({ state: 0, balance: 19_500_000_000n, stake: 20_000_000_000n, unlockTs: 0, tokensUsed: 100n })
    await getStakeInfo(manager, bridge)
    expect(cacheStore.saveStakeAddresses).toHaveBeenCalledWith(
      expect.objectContaining({
        proxySCAddress: VALID_ADDR,
        clientSCAddress: VALID_ADDR,
        ownerAddress: OWNER_ADDR,
      })
    )
  })

  it('derives status=active when client SC state=normal', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge({ [VALID_ADDR]: '500000000' })
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({ ...MOCK_STATS_REGISTERED })
    mockOpenedClient({ state: 0, balance: 19_500_000_000n, stake: 20_000_000_000n, unlockTs: 0, tokensUsed: 100n })

    const result = await getStakeInfo(manager, bridge)
    expect(result).not.toBeNull()
    expect(result!.status).toBe('active')
    expect(result!.runnerStatus).toBe('ready')
    expect(result!.balance).toBe('19500000000')
    expect(result!.stake).toBe('20000000000')
    expect(result!.cocoonWalletBalance).toBe('500000000')
  })

  it('derives status=cooldown when state=closing and unlockTs in future', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge()
    const future = Math.floor(Date.now() / 1000) + 86400 // +24h
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({
      ...MOCK_STATS_REGISTERED,
      proxies: [{ ...MOCK_STATS_REGISTERED.proxies[0], state: 1 }],
    })
    mockOpenedClient({ state: 1, balance: 20_000_000_000n, stake: 20_000_000_000n, unlockTs: future, tokensUsed: 100n })

    const result = await getStakeInfo(manager, bridge)
    expect(result!.status).toBe('cooldown')
    expect(result!.unlockTs).toBe(future)
  })

  it('derives status=refundable when state=closing and unlockTs is past', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge()
    const past = Math.floor(Date.now() / 1000) - 60
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({
      ...MOCK_STATS_REGISTERED,
      proxies: [{ ...MOCK_STATS_REGISTERED.proxies[0], state: 1 }],
    })
    mockOpenedClient({ state: 1, balance: 20_000_000_000n, stake: 20_000_000_000n, unlockTs: past, tokensUsed: 100n })

    const result = await getStakeInfo(manager, bridge)
    expect(result!.status).toBe('refundable')
  })

  it('derives status=closed when state=closed', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge()
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({
      ...MOCK_STATS_REGISTERED,
      proxies: [{ ...MOCK_STATS_REGISTERED.proxies[0], state: 2 }],
    })
    mockOpenedClient({ state: 2, balance: 0n, stake: 20_000_000_000n, unlockTs: 0, tokensUsed: 200n })

    const result = await getStakeInfo(manager, bridge)
    expect(result!.status).toBe('closed')
  })

  it('returns a partial pending snapshot when on-chain getData fails', async () => {
    const manager = makeManager('ready')
    const bridge = makeBridge({ [VALID_ADDR]: '0' })
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({ ...MOCK_STATS_REGISTERED })
    vi.mocked(openBridgeContract).mockReturnValue({
      getData: vi.fn().mockRejectedValue(new Error('SC not deployed')),
    } as unknown as ReturnType<typeof openBridgeContract>)

    const result = await getStakeInfo(manager, bridge)
    expect(result).not.toBeNull()
    expect(result!.onchainState).toBeNull()
    expect(result!.balance).toBe('0')
    expect(result!.stake).toBe('0')
  })
})

// ── unstake ─────────────────────────────────────────────────────────────────

describe('unstake', () => {
  it('throws when manager is not ready', async () => {
    const manager = makeManager('stopped')
    await expect(unstake(manager)).rejects.toThrow(/must be running/)
    expect(runnerClose).not.toHaveBeenCalled()
  })

  it('throws when no proxy is registered', async () => {
    const manager = makeManager('ready')
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({ ...MOCK_STATS_REGISTERED, proxies: [] })
    await expect(unstake(manager)).rejects.toThrow(/no proxy/i)
  })

  it('calls runner /close with the proxy address', async () => {
    const manager = makeManager('ready', 12345)
    vi.mocked(fetchJsonStats).mockResolvedValueOnce({ ...MOCK_STATS_REGISTERED })
    vi.mocked(runnerClose).mockResolvedValueOnce(undefined)

    await unstake(manager)
    expect(runnerClose).toHaveBeenCalledWith(12345, VALID_ADDR)
  })
})

// ── cashout ─────────────────────────────────────────────────────────────────

describe('cashout', () => {
  it('throws when no wallet is initialized', async () => {
    vi.mocked(loadCocoonWallet).mockResolvedValueOnce(null)
    const manager = makeManager('stopped')
    const bridge = makeBridge()
    await expect(cashout(manager, bridge, NATIVE_ADDR)).rejects.toThrow(/not initialized/)
  })

  it('throws when both wallets are below the drain floor', async () => {
    const manager = makeManager('stopped')
    // node 0.04 TON < 0.05 floor, owner 0.04 TON < 0.05 floor → both skipped
    const bridge = makeBridge({ [VALID_ADDR]: '40000000', [OWNER_ADDR]: '40000000' })
    await expect(cashout(manager, bridge, NATIVE_ADDR)).rejects.toThrow(/Nothing to cashout/)
  })

  it('stops the runner and drains the full node balance to the destination', async () => {
    const manager = makeManager('ready')
    // node has 5 TON, owner empty → only node is swept (full amount via mode 128+32)
    const bridge = makeBridge({ [VALID_ADDR]: '5000000000', [OWNER_ADDR]: '0' })
    vi.mocked(getNodeSecretBuffer).mockResolvedValueOnce(Buffer.alloc(32))
    vi.mocked(sendFromCocoonWallet).mockResolvedValueOnce({ bocHash: 'abc', seqno: 7 })

    const result = await cashout(manager, bridge, NATIVE_ADDR)

    expect(manager.stop).toHaveBeenCalled()
    expect(sendFromCocoonWallet).toHaveBeenCalled()
    expect(sendFromOwnerWallet).not.toHaveBeenCalled()
    // Drain-all: receipt records the full pre-fee balance.
    expect(result.totalSent).toBe('5000000000')
    expect(result.txs).toHaveLength(1)
    expect(result.txs[0]?.source).toBe('node')
    expect(result.txs[0]?.bocHash).toBe('abc')
    expect(result.txs[0]?.sentAmount).toBe('5000000000')
    // drainAll option must be set so the sweep self-destructs the SC.
    expect(sendFromCocoonWallet).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      0n,
      undefined,
      expect.objectContaining({ drainAll: true })
    )
  })

  it('drains both wallets sequentially when both have funds', async () => {
    const manager = makeManager('stopped')
    // node 5 TON + owner 2 TON, both fully drained via mode 128+32.
    const bridge = makeBridge({ [VALID_ADDR]: '5000000000', [OWNER_ADDR]: '2000000000' })
    vi.mocked(getNodeSecretBuffer).mockResolvedValueOnce(Buffer.alloc(32))
    vi.mocked(sendFromCocoonWallet).mockResolvedValueOnce({ bocHash: 'node-tx', seqno: 7 })
    vi.mocked(sendFromOwnerWallet).mockResolvedValueOnce({ bocHash: 'owner-tx', seqno: 3 })

    const result = await cashout(manager, bridge, NATIVE_ADDR)

    expect(sendFromCocoonWallet).toHaveBeenCalled()
    expect(sendFromOwnerWallet).toHaveBeenCalled()
    expect(result.totalSent).toBe('7000000000') // 5 + 2 = 7 TON, no reserve kept
    expect(result.txs).toHaveLength(2)
    expect(result.txs[0]?.source).toBe('node')
    expect(result.txs[0]?.sentAmount).toBe('5000000000')
    expect(result.txs[1]?.source).toBe('owner')
    expect(result.txs[1]?.sentAmount).toBe('2000000000')
    expect(sendFromOwnerWallet).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      0n,
      undefined,
      expect.objectContaining({ drainAll: true })
    )
  })

  it('does not stop the runner if it is already stopped', async () => {
    const manager = makeManager('stopped')
    const bridge = makeBridge({ [VALID_ADDR]: '5000000000', [OWNER_ADDR]: '0' })
    vi.mocked(getNodeSecretBuffer).mockResolvedValueOnce(Buffer.alloc(32))
    vi.mocked(sendFromCocoonWallet).mockResolvedValueOnce({ bocHash: 'abc', seqno: 0 })

    await cashout(manager, bridge, NATIVE_ADDR)
    expect(manager.stop).not.toHaveBeenCalled()
  })
})
