import { describe, expect, it } from 'vitest'
import {
  PaymentNotificationSchema,
  WALLET_EVENT_CONTRACTS,
  walletCreateContract,
  walletGetStateContract,
  walletImportContract,
  walletUnlockContract,
  walletExportMnemonicContract,
  walletChangePasswordContract,
  walletCreateBackupChallengeContract,
  walletMarkBackupVerifiedContract,
  walletPayForXhrContract,
  walletSendContract,
  WalletStateSchema,
  WalletTransactionSchema,
} from '../wallet'

describe('wallet IPC contract', () => {
  const state = {
    isCreated: true,
    address: 'UQ-friendly',
    addressRaw: '0:raw',
    publicKey: 'ab'.repeat(32),
    balance: '1000000000',
  }

  it('validates the complete wallet state returned to the renderer', () => {
    expect(WalletStateSchema.parse(state)).toEqual(state)
    expect(walletGetStateContract.output.parse(state)).toEqual(state)
  })

  it('rejects non-decimal balances and missing required state', () => {
    expect(() => WalletStateSchema.parse({ ...state, balance: '-1' })).toThrow()
    expect(() => WalletStateSchema.parse({ ...state, publicKey: undefined })).toThrow()
  })

  it('derives all migrated wallet push channels from validated event contracts', () => {
    expect(WALLET_EVENT_CONTRACTS.map(({ channel }) => channel)).toEqual([
      'wallet:balance-updated',
      'wallet:state-changed',
      'wallet:new-transaction',
      'wallet:payment-req',
      'wallet:payment-made',
      'wallet:payment-failed',
    ])
    expect(WALLET_EVENT_CONTRACTS[0].payload.parse(['42'])).toEqual(['42'])
    expect(() => WALLET_EVENT_CONTRACTS[0].payload.parse(['-1'])).toThrow()
    expect(() => WalletTransactionSchema.parse({ id: 'tx' })).toThrow()
  })

  it('accepts exactly 24 mnemonic words only on explicit secret flows', () => {
    const mnemonic = Array.from({ length: 24 }, (_, index) => `word${index}`)
    expect(walletCreateContract.input.parse([undefined])).toEqual([undefined])
    expect(walletCreateContract.input.parse(['correct horse battery staple'])).toBeDefined()
    expect(() => walletCreateContract.input.parse(['short'])).toThrow()
    expect(walletCreateContract.output.parse({ ...state, mnemonic }).mnemonic).toEqual(mnemonic)
    expect(walletCreateContract.output.parse({ ...state, mnemonic: mnemonic.slice(0, 12) }).mnemonic).toHaveLength(12)
    expect(() => walletCreateContract.output.parse({ ...state, mnemonic: mnemonic.slice(1) })).toThrow()
    expect(walletCreateContract.redaction).toBe('secret')
    expect(walletImportContract.input.parse([mnemonic, 'correct horse battery staple', 'v4R2', 'ton'])).toBeDefined()
    expect(() => walletImportContract.input.parse([mnemonic, 'correct horse battery staple', 'v4R1', 'ton'])).toThrow()
  })

  it('enforces the wallet comment limit in UTF-8 bytes rather than characters', () => {
    expect(walletSendContract.input.parse(['UQ-recipient', '1', 'a'.repeat(123)])).toBeDefined()
    expect(() => walletSendContract.input.parse(['UQ-recipient', '1', '😀'.repeat(65)])).toThrow()
  })

  it('restricts XHR payment requests to an owning tonsite session', () => {
    expect(walletPayForXhrContract.caller).toBe('tonsite')
    expect(walletPayForXhrContract.authorization).toBe('owning-tonsite-session')
    expect(walletPayForXhrContract.rateLimit).toEqual({
      kind: 'fixed-window',
      maxRequests: 5,
      windowMs: 1_000,
      key: 'sender',
    })
    expect(() => walletPayForXhrContract.input.parse([{ url: 'file:///etc/passwd' }])).toThrow()
  })

  it('rate-limits password-authenticated operations in the main process', () => {
    for (const contract of [
      walletUnlockContract,
      walletExportMnemonicContract,
      walletChangePasswordContract,
      walletCreateBackupChallengeContract,
      walletMarkBackupVerifiedContract,
    ]) {
      expect(contract.rateLimit).toEqual({ kind: 'fixed-window', maxRequests: 5, windowMs: 60_000, key: 'sender' })
      expect(contract.redaction).toBe('secret')
    }
  })

  it('validates payment notifications before renderer delivery', () => {
    const notification = {
      id: 'payment-1',
      domain: 'example.com',
      url: 'https://example.com/resource',
      amount: '100000000',
      payTo: '0:' + 'ab'.repeat(32),
      status: 'pending' as const,
    }
    expect(PaymentNotificationSchema.parse(notification)).toEqual(notification)
    expect(() => PaymentNotificationSchema.parse({ ...notification, amount: '-1' })).toThrow()
  })
})
