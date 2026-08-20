/**
 * Pure unit tests for the StakeView selector. No React, no IPC.
 */

import { describe, it, expect } from 'vitest'
import { deriveStakeView, MIN_STAKE_NANO, MIN_OWNER_TO_STAKE_NANO } from '../stake-actions'
import type { CocoonStakeInfo } from '@shared/cocoon-types'

const ADDR = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

function snapshot(status: CocoonStakeInfo['status'], overrides: Partial<CocoonStakeInfo> = {}): CocoonStakeInfo {
  return {
    status,
    proxySCAddress: ADDR,
    clientSCAddress: ADDR,
    runnerState: status === 'active' ? 0 : status === 'closed' ? 2 : 1,
    onchainState: status === 'active' ? 0 : status === 'closed' ? 2 : 1,
    balance: '0',
    stake: '20000000000',
    unlockTs: 0,
    tokensUsed: '0',
    tokensPayed: '0',
    cocoonWalletBalance: '0',
    runnerStatus: 'ready',
    ...overrides,
  }
}

const NOW_SEC = 1_700_000_000

describe('deriveStakeView — withdrawing branches', () => {
  it('marks a legacy or different-wallet intent as requiring explicit rebind', () => {
    const legacy = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: snapshot('active'),
      pendingWithdraw: { startedAt: 1 },
      nativeWalletIdentity: { publicKey: 'aa', addressRaw: '0:aa' },
      nowSec: NOW_SEC,
    })
    expect(legacy.kind === 'withdrawing' && legacy.needsRebind).toBe(true)

    const mismatch = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: snapshot('active'),
      pendingWithdraw: { startedAt: 1, nativeWalletPublicKey: 'bb', nativeWalletAddress: '0:bb' },
      nativeWalletIdentity: { publicKey: 'aa', addressRaw: '0:aa' },
      nowSec: NOW_SEC,
    })
    expect(mismatch.kind === 'withdrawing' && mismatch.needsRebind).toBe(true)
  })

  it('returns withdrawing/cooldown when pending + cooldown status', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: snapshot('cooldown', { unlockTs: NOW_SEC + 3600 }),
      pendingWithdraw: { startedAt: 1 },
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('withdrawing')
    if (view.kind === 'withdrawing') {
      expect(view.stage).toBe('cooldown')
      expect(view.secondsRemaining).toBe(3600)
    }
  })

  it('returns withdrawing/requesting when pending + closing without unlockTs', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: snapshot('closing', { unlockTs: 0 }),
      pendingWithdraw: { startedAt: 1 },
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('withdrawing')
    if (view.kind === 'withdrawing') {
      expect(view.stage).toBe('requesting')
    }
  })

  it('returns withdrawing/confirming when a refund tx was already broadcast but stake is still active', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: snapshot('active'),
      pendingWithdraw: { startedAt: 1, lastActionAt: Date.now(), lastBocHash: 'boc' },
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('withdrawing')
    if (view.kind === 'withdrawing') {
      expect(view.stage).toBe('confirming')
    }
  })

  it('returns withdrawing/claiming when pending + refundable', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: snapshot('refundable'),
      pendingWithdraw: { startedAt: 1 },
      nowSec: NOW_SEC,
    })
    if (view.kind === 'withdrawing') {
      expect(view.stage).toBe('claiming')
    } else {
      throw new Error('expected withdrawing')
    }
  })

  it('returns withdrawing/cashingOut when pending + closed', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 20_000_000_000n,
      stakeInfo: snapshot('closed'),
      pendingWithdraw: { startedAt: 1 },
      nowSec: NOW_SEC,
    })
    if (view.kind === 'withdrawing') {
      expect(view.stage).toBe('cashingOut')
    } else {
      throw new Error('expected withdrawing')
    }
  })

  it('returns withdrawing/finalizing when pending but stakeInfo lost', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: null,
      pendingWithdraw: { startedAt: 1 },
      nowSec: NOW_SEC,
    })
    if (view.kind === 'withdrawing') {
      expect(view.stage).toBe('finalizing')
    } else {
      throw new Error('expected withdrawing')
    }
  })
})

describe('deriveStakeView — active', () => {
  it('returns active when stake.status=active and no pending', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 1_000_000_000n,
      stakeInfo: snapshot('active', { stake: '20000000000' }),
      pendingWithdraw: null,
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('active')
    if (view.kind === 'active') {
      expect(view.stake).toBe(20_000_000_000n)
    }
  })
})

describe('deriveStakeView — no stake', () => {
  it('returns readyToStart when cocoon ≥ min stake', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: MIN_STAKE_NANO,
      stakeInfo: null,
      pendingWithdraw: null,
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('readyToStart')
    if (view.kind === 'readyToStart') {
      expect(view.canCashout).toBe(true)
    }
  })

  it('returns readyToFundAndStake when cocoon low but main wallet can fund', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: MIN_OWNER_TO_STAKE_NANO,
      cocoonBalance: 100_000_000n, // below MIN_STAKE
      stakeInfo: null,
      pendingWithdraw: null,
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('readyToFundAndStake')
  })

  it('returns fundOwnerFirst with canCashout=true when cocoon ≥ dust', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 100_000_000n, // 0.1 TON, ≥ cocoon dust
      stakeInfo: null,
      pendingWithdraw: null,
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('fundOwnerFirst')
    if (view.kind === 'fundOwnerFirst') {
      expect(view.canCashout).toBe(true)
    }
  })

  it('returns fundOwnerFirst with canCashout=true when only owner has residual', () => {
    // The scenario the user hit: 2 TON stuck in legacy owner V4R2, cocoon empty.
    // Cashout drains BOTH wallets, so the button must be visible.
    const view = deriveStakeView({
      ownerBalance: 2_000_000_000n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: null,
      pendingWithdraw: null,
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('fundOwnerFirst')
    if (view.kind === 'fundOwnerFirst') {
      expect(view.canCashout).toBe(true)
    }
  })

  it('returns fundOwnerFirst with canCashout=false when both wallets below their reserves', () => {
    const view = deriveStakeView({
      ownerBalance: 400_000_000n, // 0.4 TON, below 0.5 owner reserve
      nativeBalance: 0n,
      cocoonBalance: 50_000_000n, // 0.05 TON, below 0.1 cocoon dust
      stakeInfo: null,
      pendingWithdraw: null,
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('fundOwnerFirst')
    if (view.kind === 'fundOwnerFirst') {
      expect(view.canCashout).toBe(false)
    }
  })

  it('returns readyToStart even when stake.status=closed (treat as no stake)', () => {
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: MIN_STAKE_NANO,
      stakeInfo: snapshot('closed'),
      pendingWithdraw: null,
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('readyToStart')
  })
})

describe('deriveStakeView — pending wins over status', () => {
  it('shows requesting when pending but stake is still active', () => {
    // Refund request is being sent/retried and has not landed on-chain yet.
    const view = deriveStakeView({
      ownerBalance: 0n,
      nativeBalance: 0n,
      cocoonBalance: 0n,
      stakeInfo: snapshot('active'),
      pendingWithdraw: { startedAt: 1 },
      nowSec: NOW_SEC,
    })
    expect(view.kind).toBe('withdrawing')
    if (view.kind === 'withdrawing') {
      expect(view.stage).toBe('requesting')
    }
  })
})
