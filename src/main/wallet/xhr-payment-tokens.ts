interface PaymentToken {
  token: string
  expiresAt: number
  remainingUses: number
}

/** Bounded-use signed X-PAYMENT capability store scoped to WebContents and URL. */
export class XhrPaymentTokenStore {
  private readonly tokens = new Map<string, PaymentToken>()

  constructor(private readonly now: () => number = Date.now) {}

  register(webContentsId: number, url: string, token: string, ttlMs: number, uses = 1): void {
    this.tokens.set(this.key(webContentsId, url), {
      token,
      expiresAt: this.now() + Math.max(0, ttlMs),
      remainingUses: Math.max(1, uses),
    })
  }

  consume(webContentsId: number, url: string): string | null {
    const key = this.key(webContentsId, url)
    const entry = this.tokens.get(key)
    if (!entry) return null
    if (this.now() > entry.expiresAt) {
      this.tokens.delete(key)
      return null
    }
    entry.remainingUses--
    if (entry.remainingUses <= 0) this.tokens.delete(key)
    return entry.token
  }

  revoke(webContentsId: number, url: string): void {
    this.tokens.delete(this.key(webContentsId, url))
  }

  clear(): void {
    this.tokens.clear()
  }

  private key(webContentsId: number, url: string): string {
    return `${webContentsId}|${url}`
  }
}
