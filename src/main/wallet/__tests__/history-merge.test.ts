import { describe, it, expect } from 'vitest'
import { mergeHistory, historyKey, sameHistory } from '../history-merge'
import type { WalletTransaction } from '../../../shared/types'

function tx(p: Partial<WalletTransaction>): WalletTransaction {
  return {
    id: 'id',
    type: 'send',
    amount: '1000',
    address: 'EQabc',
    timestamp: 1_000_000,
    status: 'confirmed',
    ...p,
  } as WalletTransaction
}

const LIMIT = 500

describe('mergeHistory', () => {
  it('dedups a confirmed x402 local tx against its on-chain counterpart and carries the label', () => {
    const local = tx({
      id: 'u1',
      type: 'x402',
      x402Domain: 'shop.ton',
      x402Url: 'https://shop.ton/a',
      status: 'confirmed',
    })
    const onChain = tx({ id: 'x', hash: 'HASH1', timestamp: 1_000_500 }) // no label, different key

    const merged = mergeHistory([local], [onChain], LIMIT)

    expect(merged).toHaveLength(1)
    expect(historyKey(merged[0])).toBe('h:HASH1')
    expect(merged[0].type).toBe('x402')
    expect(merged[0].x402Domain).toBe('shop.ton')
    expect(merged[0].x402Url).toBe('https://shop.ton/a')
  })

  it('drops a pending local tx superseded by an on-chain tx', () => {
    const local = tx({ id: 'p1', status: 'pending' })
    const onChain = tx({ id: 'x', hash: 'HASH2', timestamp: 1_000_100 })

    const merged = mergeHistory([local], [onChain], LIMIT)
    expect(merged).toHaveLength(1)
    expect(historyKey(merged[0])).toBe('h:HASH2')
  })

  it('keeps a local tx that has no on-chain match', () => {
    const local = tx({ id: 'keep', status: 'pending', amount: '999' })
    const onChain = tx({ id: 'x', hash: 'HASH3', amount: '5', timestamp: 5_000_000 })

    const merged = mergeHistory([local], [onChain], LIMIT)
    expect(merged).toHaveLength(2)
  })

  it('carries an x402 label forward on an exact-key re-fetch', () => {
    const cached = tx({ id: 'x', hash: 'HASH4', type: 'x402', x402Domain: 'd.ton' })
    const refetched = tx({ id: 'x', hash: 'HASH4', type: 'send' })

    const merged = mergeHistory([cached], [refetched], LIMIT)
    expect(merged).toHaveLength(1)
    expect(merged[0].type).toBe('x402')
    expect(merged[0].x402Domain).toBe('d.ton')
  })

  it('sorts newest-first and caps to the limit', () => {
    const cached = Array.from({ length: 5 }, (_, i) => tx({ id: `c${i}`, hash: `H${i}`, timestamp: i }))
    const merged = mergeHistory(cached, [], 3)
    expect(merged).toHaveLength(3)
    expect(merged[0].timestamp).toBe(4)
  })

  it('reports equal histories when object key order differs', () => {
    const a = tx({ id: 'same', hash: 'HASH5', comment: 'memo' })
    const b = {
      comment: 'memo',
      hash: 'HASH5',
      status: 'confirmed',
      timestamp: 1_000_000,
      address: 'EQabc',
      amount: '1000',
      type: 'send',
      id: 'same',
    } as WalletTransaction

    expect(sameHistory([a], [b])).toBe(true)
  })

  it('reports different histories when transaction content changes', () => {
    expect(sameHistory([tx({ id: 'a', status: 'pending' })], [tx({ id: 'a', status: 'confirmed' })])).toBe(false)
  })
})
