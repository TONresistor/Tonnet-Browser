import { describe, expect, it } from 'vitest'
import {
  AccountBalanceResultSchema,
  BridgeAccountStateSchema,
  BridgeTransactionSchema,
  DnsResolveResultSchema,
  JsonRpcInboundSchema,
  OverlayMessageEventSchema,
  SendAndWatchResultSchema,
  SeqnoResultSchema,
} from '../bridge-codecs'

describe('bridge boundary codecs', () => {
  it('accepts response and event envelopes', () => {
    expect(JsonRpcInboundSchema.parse({ jsonrpc: '2.0', id: '1', result: {} })).toMatchObject({ id: '1' })
    expect(JsonRpcInboundSchema.parse({ event: 'transaction', data: {} })).toMatchObject({ event: 'transaction' })
  })

  it('rejects uncorrelatable and malformed error envelopes', () => {
    expect(() => JsonRpcInboundSchema.parse({ result: {} })).toThrow()
    expect(() => JsonRpcInboundSchema.parse({ id: '1', error: { code: 'nope' } })).toThrow()
  })

  it('normalizes seqno while keeping balances decimal-only', () => {
    expect(SeqnoResultSchema.parse({ seqno: '12' })).toEqual({ seqno: 12 })
    expect(AccountBalanceResultSchema.parse({ balance: '1000' })).toEqual({ balance: '1000' })
    expect(() => AccountBalanceResultSchema.parse({ balance: '-1' })).toThrow()
  })

  it('requires complete send-and-watch correlation fields', () => {
    expect(SendAndWatchResultSchema.parse({ subscription_id: 'sub', msg_hash: 'hash' })).toEqual({
      subscription_id: 'sub',
      msg_hash: 'hash',
    })
    expect(() => SendAndWatchResultSchema.parse({ subscription_id: 'sub' })).toThrow()
  })

  it('validates critical account, transaction and overlay push events', () => {
    expect(
      BridgeAccountStateSchema.parse({
        balance: '100',
        last_transaction_lt: '1',
        last_transaction_hash: 'hash',
        seqno: 2,
      })
    ).toMatchObject({ balance: '100', seqno: 2 })
    expect(() => BridgeAccountStateSchema.parse({ balance: -1 })).toThrow()
    expect(
      BridgeTransactionSchema.parse({
        hash: 'hash',
        lt: '1',
        now: 1,
        in_msg: { source: '', destination: '', value: '2' },
      })
    ).toMatchObject({ hash: 'hash' })
    expect(() => OverlayMessageEventSchema.parse({ overlay_id: 'id', message: 12 })).toThrow()
  })

  it('normalizes only validated DNS response fields while preserving extensions', () => {
    expect(DnsResolveResultSchema.parse({ wallet: '0:abc', extension: 1 })).toMatchObject({
      wallet: '0:abc',
      extension: 1,
    })
    expect(() => DnsResolveResultSchema.parse({ text_records: { key: 4 } })).toThrow()
  })
})
