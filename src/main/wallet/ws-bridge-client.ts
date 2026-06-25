/**
 * WebSocket bridge client.
 * Communicates with the TON blockchain via the tonutils-bridge binary
 * over a local JSON-RPC 2.0 WebSocket connection.
 */

import WebSocket from 'ws'
import { createLogger } from '../../shared/logger'
import type { DnsResolveResult } from '../../shared/types'

const log = createLogger('wallet:ws-bridge')

/**
 * True when a bridge get-method error indicates the contract is not yet deployed
 * (uninitialized). The bridge surfaces this as a "not initialized" message or
 * exit code -256; callers treat it as "seqno 0, init will deploy".
 */
export function isContractNotDeployedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.includes('not initialized') || msg.includes('-256')
}

const REQUEST_TIMEOUT_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 54_000
const PONG_TIMEOUT_MS = 60_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const READINESS_PROBE_MAX_ATTEMPTS = 15
const READINESS_PROBE_BASE_MS = 300

// --- Bridge-specific types ---

/** Account state from lite.getAccountState */
export interface BridgeAccountState {
  balance: string
  last_transaction_lt: string
  last_transaction_hash: string
  seqno: number
}

/** Transaction from lite.getTransactions. Fields mirror the Go bridge serializeTransaction output. */
export interface BridgeTransaction {
  hash: string
  lt: string
  /** Unix timestamp in seconds from the block's header (tx.Now in the Go serializer). */
  now: number
  total_fees?: string
  in_msg?: { source: string; destination: string; value: string; body?: string }
  out_msgs?: Array<{ source: string; destination: string; value: string; body?: string }>
}

/** Value paired with the address it was fetched for, so switching wallets invalidates the cache. */
interface AddressScoped<T> {
  address: string
  value: T
}

/** Result from lite.sendAndWatch */
interface SendAndWatchResult {
  subscription_id: string
  msg_hash: string
}

/** Result from a subscription request */
interface SubscriptionResult {
  subscription_id: string
}

/** Event data for tx_confirmed push events */
interface TxConfirmedEvent {
  msg_hash: string
  transaction?: { hash: string }
}

/** Event data for tx_timeout push events */
interface TxTimeoutEvent {
  msg_hash: string
  reason?: string
}

/** JSON-RPC 2.0 message from the bridge (response or push event) */
interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number
  result?: unknown
  error?: { code: number; message: string }
  event?: string
  data?: unknown
}

type RpcParams = Record<string, unknown>
type EventCallback = (data: unknown) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface SubscriptionEntry {
  method: string
  params: RpcParams
  event: string
  callback: EventCallback
}

export class WsBridgeClient {
  private wsPort: number
  private ws: WebSocket | null = null
  private nextId = 0
  private pending = new Map<string, PendingRequest>()
  private subscriptions = new Map<string, SubscriptionEntry>()
  private eventListeners = new Map<string, Set<EventCallback>>()
  private requestQueue: Array<{
    message: string
    resolve: (v: unknown) => void
    reject: (e: Error) => void
    method: string
  }> = []
  private connected = false
  private connecting = false
  private destroyed = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private cachedBalance: AddressScoped<string> | null = null
  private cachedSeqno: AddressScoped<number> | null = null
  private balanceDegraded = false
  private seqnoDegraded = false

  constructor(wsPort: number) {
    this.wsPort = wsPort
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return
    this.destroyed = false
    await this.doConnect()
  }

  disconnect(): void {
    this.destroyed = true
    this.clearTimers()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // Reject all pending requests
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Client disconnected'))
    }
    this.pending.clear()
    // Drain request queue
    for (const queued of this.requestQueue) {
      queued.reject(new Error('Client disconnected'))
    }
    this.requestQueue = []
    this.subscriptions.clear()
    this.eventListeners.clear()
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.connecting = false
  }

  isConnected(): boolean {
    return this.connected
  }

  // --- Wallet operations ---

  async getBalance(address: string): Promise<string> {
    try {
      const result = await this.request<BridgeAccountState>('lite.getAccountState', { address })
      const balance = result.balance ?? '0'
      this.cachedBalance = { address, value: balance }
      this.balanceDegraded = false
      return balance
    } catch (err) {
      if (this.cachedBalance && this.cachedBalance.address === address) {
        if (this.balanceDegraded) {
          log.debug('getBalance still failing, returning cached value')
        } else {
          log.warn('getBalance failed, returning cached value')
          this.balanceDegraded = true
        }
        return this.cachedBalance.value
      }
      throw err
    }
  }

  async getSeqno(address: string): Promise<number> {
    try {
      const result = await this.request<{ seqno: number | string }>('wallet.getSeqno', { address })
      const seqno = typeof result.seqno === 'number' ? result.seqno : Number(result.seqno)
      this.cachedSeqno = { address, value: seqno }
      this.seqnoDegraded = false
      return seqno
    } catch (err) {
      if (this.cachedSeqno && this.cachedSeqno.address === address) {
        if (this.seqnoDegraded) {
          log.debug('getSeqno still failing, returning cached value')
        } else {
          log.warn('getSeqno failed, returning cached value')
          this.seqnoDegraded = true
        }
        return this.cachedSeqno.value
      }
      throw err
    }
  }

  async broadcast(boc: Buffer): Promise<void> {
    const b64 = boc.toString('base64')
    await this.request('lite.sendMessage', { boc: b64 })
    log.info('Transaction broadcast successful')
  }

  async getTransactions(
    address: string,
    limit: number = 20,
    lastLt?: string,
    lastHash?: string
  ): Promise<BridgeTransaction[]> {
    const params: RpcParams = { address, limit }
    if (lastLt && lastHash) {
      params.last_lt = lastLt
      params.last_hash = lastHash
    }
    const result = await this.request<{ transactions?: BridgeTransaction[] }>('lite.getTransactions', params)
    return result.transactions ?? []
  }

  // --- Subscriptions ---

  subscribeAccountState(address: string, callback: (state: BridgeAccountState) => void): () => void {
    return this.subscribe('subscribe.accountState', { address }, 'account_state', callback as EventCallback)
  }

  subscribeTransactions(address: string, callback: (tx: BridgeTransaction) => void): () => void {
    return this.subscribe('subscribe.transactions', { address, last_lt: '0' }, 'transaction', callback as EventCallback)
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.delete(subscriptionId)
    try {
      await this.request('subscribe.unsubscribe', { subscription_id: subscriptionId })
    } catch (err) {
      log.warn('Unsubscribe failed:', err)
    }
  }

  // --- Payment flow ---

  async sendAndWatch(boc: Buffer): Promise<string> {
    const b64 = boc.toString('base64')
    return new Promise<string>((resolve, reject) => {
      this.request('lite.sendAndWatch', { boc: b64 })
        .then((raw) => {
          const result = raw as SendAndWatchResult
          const subId = result.subscription_id
          const msgHash = result.msg_hash

          const onConfirmed = (data: unknown) => {
            const event = data as TxConfirmedEvent
            if (event.msg_hash === msgHash) {
              cleanup()
              resolve(event.transaction?.hash ?? msgHash)
            }
          }
          const onTimeout = (data: unknown) => {
            const event = data as TxTimeoutEvent
            if (event.msg_hash === msgHash) {
              cleanup()
              reject(new Error(`Transaction timed out: ${event.reason ?? 'unknown'}`))
            }
          }

          const confirmTimer = setTimeout(() => {
            cleanup()
            reject(new Error('Transaction confirmation timeout (120s)'))
          }, 120_000)

          const cleanup = () => {
            clearTimeout(confirmTimer)
            this.removeEventListener('tx_confirmed', onConfirmed)
            this.removeEventListener('tx_timeout', onTimeout)
            this.subscriptions.delete(subId)
          }

          this.addEventListener('tx_confirmed', onConfirmed)
          this.addEventListener('tx_timeout', onTimeout)
          // Track subscription for cleanup on disconnect
          this.subscriptions.set(subId, {
            method: 'lite.sendAndWatch',
            params: { boc: b64 },
            event: 'tx_confirmed',
            callback: onConfirmed,
          })
        })
        .catch(reject)
    })
  }

  // --- DNS ---

  async resolveDomain(domain: string): Promise<DnsResolveResult> {
    const raw = await this.request<Record<string, unknown>>('dns.resolve', { domain })

    // Normalize to the full DnsResolveResult shape so we capture all records the bridge/contract provides.
    // The bridge returns mapped fields from dnsresolve (wallet, site, storage, text, next, + NFT metadata).
    // We defensively fill new fields (storage_bag_id, next_resolver) if the bridge already sends them
    // under common keys (e.g. storage_bag_id, dns_storage_bag_id, next_resolver, etc.).
    const normalized: DnsResolveResult = {
      wallet: (raw.wallet as string) ?? null,
      site_adnl: (raw.site_adnl as string) ?? (raw.site as string) ?? null,
      has_storage: Boolean(raw.has_storage ?? raw.storage ?? false),
      storage_bag_id:
        (raw.storage_bag_id as string) ?? (raw.dns_storage_bag_id as string) ?? (raw.bag_id as string) ?? null,
      next_resolver: (raw.next_resolver as string) ?? (raw.dns_next_resolver as string) ?? (raw.next as string) ?? null,
      owner: (raw.owner as string) ?? null,
      nft_address: (raw.nft_address as string) ?? null,
      collection: (raw.collection as string) ?? null,
      editor: (raw.editor as string) ?? null,
      initialized: raw.initialized !== false,
      expiring_at: (raw.expiring_at as number) ?? null,
      text_records: (raw.text_records as Record<string, string>) ?? undefined,
      // preserve any extra fields the bridge may return
      ...raw,
    }

    return normalized
  }

  // --- Generic ---

  async runMethod(address: string, method: string, params?: unknown[]): Promise<unknown> {
    return await this.request('lite.runMethod', { address, method, params: params ?? [] })
  }

  // --- Internal: JSON-RPC transport ---

  private request<T = unknown>(method: string, params: RpcParams, guard?: (value: unknown) => value is T): Promise<T> {
    const id = String(++this.nextId)
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })

    const raw = this.connected
      ? this.sendRequest(id, message, method)
      : new Promise<unknown>((resolve, reject) => {
          this.requestQueue.push({ message, resolve, reject, method })
        })

    return raw.then((value) => {
      if (guard && !guard(value)) {
        throw new Error(`Unexpected response shape for ${method}`)
      }
      return value as T
    })
  }

  private sendRequest(id: string, message: string, method: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, REQUEST_TIMEOUT_MS)

      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(message, (err) => {
        if (err) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new Error(`WebSocket send failed: ${err.message}`))
        }
      })
    })
  }

  private handleMessage(raw: WebSocket.Data): void {
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(raw.toString()) as JsonRpcMessage
    } catch {
      log.warn('Received non-JSON message from bridge')
      return
    }

    // Push event (no id, has event field)
    if (msg.event) {
      this.dispatchEvent(msg.event, msg.data)
      return
    }

    // RPC response (has id)
    if (msg.id !== undefined) {
      const entry = this.pending.get(String(msg.id))
      if (!entry) return
      this.pending.delete(String(msg.id))
      clearTimeout(entry.timer)

      if (msg.error) {
        entry.reject(new Error(msg.error.message ?? `RPC error ${msg.error.code}`))
      } else {
        entry.resolve(msg.result)
      }
    }
  }

  // --- Internal: subscriptions ---

  private subscribe(method: string, params: RpcParams, eventName: string, callback: EventCallback): () => void {
    let subId: string | null = null
    let unsubscribed = false

    this.request(method, params)
      .then((raw) => {
        const result = raw as SubscriptionResult
        if (unsubscribed) {
          // User already called unsubscribe before server responded
          if (result.subscription_id) {
            this.request('subscribe.unsubscribe', { subscription_id: result.subscription_id }).catch(() => {})
          }
          return
        }
        subId = result.subscription_id
        this.subscriptions.set(subId!, { method, params, event: eventName, callback })
        this.addEventListener(eventName, callback)
      })
      .catch((err) => {
        log.error(`Subscription ${method} failed:`, err)
      })

    return () => {
      unsubscribed = true
      if (subId) {
        this.removeEventListener(eventName, callback)
        this.unsubscribe(subId).catch(() => {})
      }
    }
  }

  private addEventListener(event: string, callback: EventCallback): void {
    let set = this.eventListeners.get(event)
    if (!set) {
      set = new Set()
      this.eventListeners.set(event, set)
    }
    set.add(callback)
  }

  private removeEventListener(event: string, callback: EventCallback): void {
    const set = this.eventListeners.get(event)
    if (set) {
      set.delete(callback)
      if (set.size === 0) this.eventListeners.delete(event)
    }
  }

  private dispatchEvent(event: string, data: unknown): void {
    const set = this.eventListeners.get(event)
    if (!set) return
    for (const cb of set) {
      try {
        cb(data)
      } catch (err) {
        log.error(`Event handler error (${event}):`, err)
      }
    }
  }

  // --- Internal: connection management ---

  private doConnect(): Promise<void> {
    this.connecting = true
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.wsPort}`
      const ws = new WebSocket(url)

      const onOpenOnce = async () => {
        cleanup()
        this.ws = ws
        this.connecting = false
        this.reconnectAttempt = 0
        this.setupListeners(ws)
        this.startHeartbeat()

        // Probe the liteserver pool before marking the connection as ready.
        // The bridge WS may accept connections before its liteserver pool
        // has completed ADNL handshakes, causing "context deadline exceeded"
        // on the first real requests. Polling getMasterchainInfo verifies
        // end-to-end readiness.
        await this.waitForPoolReady()

        this.connected = true
        this.drainQueue()
        log.info(`Connected to bridge on port ${this.wsPort}`)
        resolve()
      }

      const onErrorOnce = (err: Error) => {
        cleanup()
        this.connecting = false
        log.error('Bridge connection failed:', err.message)
        reject(err)
      }

      const onCloseOnce = () => {
        cleanup()
        this.connecting = false
        reject(new Error('Connection closed before open'))
      }

      const cleanup = () => {
        ws.removeListener('open', onOpenOnce)
        ws.removeListener('error', onErrorOnce)
        ws.removeListener('close', onCloseOnce)
      }

      ws.once('open', onOpenOnce)
      ws.once('error', onErrorOnce)
      ws.once('close', onCloseOnce)
    })
  }

  /**
   * Poll lite.getMasterchainInfo until the bridge liteserver pool responds.
   * Uses exponential backoff (300ms, 600ms, 1.2s, ...) up to ~15 attempts.
   * If the pool never warms up, proceed anyway and let callers handle errors.
   */
  private async waitForPoolReady(): Promise<void> {
    for (let i = 0; i < READINESS_PROBE_MAX_ATTEMPTS; i++) {
      try {
        const id = String(++this.nextId)
        const msg = JSON.stringify({ jsonrpc: '2.0', id, method: 'lite.getMasterchainInfo', params: {} })
        await this.sendRequest(id, msg, 'lite.getMasterchainInfo')
        log.info(`Bridge liteserver pool ready (probe ${i + 1})`)
        return
      } catch {
        const delay = Math.min(READINESS_PROBE_BASE_MS * Math.pow(2, i), 5_000)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    log.warn('Bridge liteserver pool did not respond to readiness probes, proceeding anyway')
  }

  private setupListeners(ws: WebSocket): void {
    ws.on('message', (data) => this.handleMessage(data))
    ws.on('pong', () => this.onPong())

    ws.on('close', (code, reason) => {
      log.warn(`Bridge connection closed: ${code} ${reason}`)
      this.onDisconnect()
    })

    ws.on('error', (err) => {
      log.error('Bridge WebSocket error:', err.message)
    })
  }

  private onDisconnect(): void {
    this.connected = false
    this.clearTimers()
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws = null
    }
    // Reject pending requests
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Connection lost'))
    }
    this.pending.clear()

    if (!this.destroyed) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt), RECONNECT_MAX_MS)
    this.reconnectAttempt++
    log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.doConnect()
        // Re-subscribe active subscriptions after reconnect
        this.resubscribeAll()
      } catch {
        if (!this.destroyed) {
          this.scheduleReconnect()
        }
      }
    }, delay)
  }

  private resubscribeAll(): void {
    const entries = Array.from(this.subscriptions.values())
    this.subscriptions.clear()
    this.eventListeners.clear()
    if (entries.length === 0) return

    log.info(`Re-subscribing ${entries.length} subscriptions after reconnect`)
    for (const entry of entries) {
      // sendAndWatch subscriptions cannot be re-established (the BOC was already sent)
      if (entry.method === 'lite.sendAndWatch') continue
      this.subscribe(entry.method, entry.params, entry.event, entry.callback)
    }
  }

  private drainQueue(): void {
    const queue = this.requestQueue
    this.requestQueue = []
    for (const { message, resolve, reject, method } of queue) {
      // Re-parse the id from the queued message
      try {
        const parsed = JSON.parse(message)
        this.sendRequest(parsed.id, message, method).then(resolve, reject)
      } catch {
        reject(new Error('Failed to replay queued request'))
      }
    }
  }

  // --- Internal: heartbeat ---

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      this.ws.ping()
      this.pongTimer = setTimeout(() => {
        log.warn('Pong timeout, reconnecting')
        if (this.ws) {
          this.ws.terminate()
        }
      }, PONG_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private onPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }
}
