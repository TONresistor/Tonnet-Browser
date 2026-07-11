import { describe, expect, it } from 'vitest'
import { XhrPaymentTokenStore } from '../xhr-payment-tokens'

describe('XhrPaymentTokenStore', () => {
  it('scopes tokens to both WebContents and exact URL', () => {
    const store = new XhrPaymentTokenStore(() => 100)
    store.register(7, 'https://shop.ton/item', 'signed', 1_000)
    expect(store.consume(8, 'https://shop.ton/item')).toBeNull()
    expect(store.consume(7, 'https://shop.ton/other')).toBeNull()
    expect(store.consume(7, 'https://shop.ton/item')).toBe('signed')
    expect(store.consume(7, 'https://shop.ton/item')).toBeNull()
  })

  it('honors bounded uses and expiry', () => {
    let now = 100
    const store = new XhrPaymentTokenStore(() => now)
    store.register(1, 'https://shop.ton', 'signed', 50, 2)
    expect(store.consume(1, 'https://shop.ton')).toBe('signed')
    now = 151
    expect(store.consume(1, 'https://shop.ton')).toBeNull()
  })

  it('can revoke a token after a failed payment path', () => {
    const store = new XhrPaymentTokenStore(() => 0)
    store.register(1, 'https://shop.ton', 'secret', 100)
    store.revoke(1, 'https://shop.ton')
    expect(store.consume(1, 'https://shop.ton')).toBeNull()
  })
})
