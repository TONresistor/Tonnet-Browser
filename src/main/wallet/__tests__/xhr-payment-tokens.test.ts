import { describe, expect, it } from 'vitest'
import { XhrPaymentTokenStore } from '../xhr-payment-tokens'

const WALLET_A = { publicKey: 'aa'.repeat(32), addressRaw: `0:${'11'.repeat(32)}`, revision: 1 }
const WALLET_B = { publicKey: 'bb'.repeat(32), addressRaw: `0:${'22'.repeat(32)}`, revision: 2 }

describe('XhrPaymentTokenStore', () => {
  it('scopes tokens to both WebContents and exact URL', () => {
    const store = new XhrPaymentTokenStore(() => 100)
    store.register(7, 'https://shop.ton/item', 'signed', 1_000, WALLET_A)
    expect(store.consume(8, 'https://shop.ton/item', WALLET_A)).toBeNull()
    expect(store.consume(7, 'https://shop.ton/other', WALLET_A)).toBeNull()
    expect(store.consume(7, 'https://shop.ton/item', WALLET_A)).toBe('signed')
    expect(store.consume(7, 'https://shop.ton/item', WALLET_A)).toBeNull()
  })

  it('honors bounded uses and expiry', () => {
    let now = 100
    const store = new XhrPaymentTokenStore(() => now)
    store.register(1, 'https://shop.ton', 'signed', 50, WALLET_A, 2)
    expect(store.consume(1, 'https://shop.ton', WALLET_A)).toBe('signed')
    now = 151
    expect(store.consume(1, 'https://shop.ton', WALLET_A)).toBeNull()
  })

  it('can revoke a token after a failed payment path', () => {
    const store = new XhrPaymentTokenStore(() => 0)
    store.register(1, 'https://shop.ton', 'secret', 100, WALLET_A)
    store.revoke(1, 'https://shop.ton')
    expect(store.consume(1, 'https://shop.ton', WALLET_A)).toBeNull()
  })

  it('revokes a signed token when the active wallet identity changes', () => {
    const store = new XhrPaymentTokenStore(() => 0)
    store.register(1, 'https://shop.ton', 'secret', 100, WALLET_A)
    expect(store.consume(1, 'https://shop.ton', WALLET_B)).toBeNull()
    expect(store.consume(1, 'https://shop.ton', WALLET_A)).toBeNull()
  })
})
