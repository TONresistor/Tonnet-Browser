/**
 * WebSocket bridge client.
 * Communicates with the TON blockchain via the tonutils-proxy-ws bridge
 * over a local JSON-RPC 2.0 WebSocket connection.
 */

import WebSocket from 'ws'
import { createLogger } from '../../shared/logger'

const log = createLogger('wallet:ws-bridge')

const REQUEST_TIMEOUT_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 54_000
const PONG_TIMEOUT_MS = 60_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface SubscriptionEntry {
  method: string
  params: Record<string, any>
  event: string
  callback: (data: any) => void
}

export class WsBridgeClient {
  private wsPort: number
  private ws: WebSocket | null = null
  private nextId = 0
  private pending = new Map<string, PendingRequest>()
  private subscriptions = new Map<string, SubscriptionEntry>()
  private eventListeners = new Map<string, Set<(data: any) => void>>()
  private requestQueue: Array<{
    message: string
    resolve: (v: any) => void
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
  private cachedBalance: string | null = null
  private cachedSeqno: number | null = null

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
    for (const [id, entry] of this.pending) {
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
      const result = await this.request('lite.getAccountState', { address })
      const balance = result.balance ?? '0'
      this.cachedBalance = balance
      return balance
    } catch (err) {
      if (this.cachedBalance !== null) {
        log.warn('getBalance failed, returning cached value')
        return this.cachedBalance
      }
      throw err
    }
  }

  async getSeqno(address: string): Promise<number> {
    try {
      const result = await this.request('wallet.getSeqno', { address })
      const seqno = typeof result.seqno === 'number' ? result.seqno : Number(result.seqno)
      this.cachedSeqno = seqno
      return seqno
    } catch (err) {
      if (this.cachedSeqno !== null) {
        log.warn('getSeqno failed, returning cached value')
        return this.cachedSeqno
      }
      throw err
    }
  }

  async broadcast(boc: Buffer): Promise<void> {
    const b64 = boc.toString('base64')
    await this.request('lite.sendMessage', { boc: b64 })
    log.info('Transaction broadcast successful')
  }

  async getTransactions(address: string, limit: number = 20, lastLt?: string, lastHash?: string): Promise<any[]> {
    const params: Record<string, any> = { address, limit }
    if (lastLt && lastHash) {
      params.last_lt = lastLt
      params.last_hash = lastHash
    }
    const result = await this.request('lite.getTransactions', params)
    return result.transactions ?? []
  }

  // --- DNS ---

  async resolveDomain(domain: string): Promise<{
    wallet?: string
    site_adnl?: string
    has_storage?: boolean
    owner?: string
    nft_address?: string
    collection?: string
    editor?: string
    initialized?: boolean
    expiring_at?: number
    text_records?: Record<string, string>
  }> {
    return await this.request('dns.resolve', { domain })
  }

  // --- NFT ---

  async getNftData(address: string): Promise<{
    initialized?: boolean
    index?: string
    collection?: string
    owner?: string
    content?: { type: string; uri?: string; name?: string; description?: string; image?: string; image_data?: string }
  }> {
    return await this.request('nft.getData', { address })
  }

  async getNftCollectionData(
    address: string
  ): Promise<{ next_item_index: string; owner?: string; content_uri?: string }> {
    return await this.request('nft.getCollectionData', { address })
  }

  async getNftAddressByIndex(collection: string, index: string): Promise<string | null> {
    const result = await this.request('nft.getAddressByIndex', { collection, index })
    return result.address ?? null
  }

  // --- Subscriptions ---

  subscribeAccountState(address: string, callback: (state: any) => void): () => void {
    return this.subscribe('subscribe.accountState', { address }, 'account_state', callback)
  }

  subscribeTransactions(address: string, callback: (tx: any) => void): () => void {
    return this.subscribe('subscribe.transactions', { address, last_lt: '0' }, 'transaction', callback)
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
        .then((result) => {
          const subId = result.subscription_id as string
          const msgHash = result.msg_hash as string

          const onConfirmed = (data: any) => {
            if (data.msg_hash === msgHash) {
              cleanup()
              resolve(data.transaction?.hash ?? msgHash)
            }
          }
          const onTimeout = (data: any) => {
            if (data.msg_hash === msgHash) {
              cleanup()
              reject(new Error(`Transaction timed out: ${data.reason ?? 'unknown'}`))
            }
          }

          const cleanup = () => {
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

  // --- Generic ---

  async runMethod(address: string, method: string, params?: any[]): Promise<any> {
    return await this.request('lite.runMethod', { address, method, params: params ?? [] })
  }

  // --- Internal: JSON-RPC transport ---

  private request(method: string, params: Record<string, any>): Promise<any> {
    const id = String(++this.nextId)
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })

    if (!this.connected) {
      return new Promise((resolve, reject) => {
        this.requestQueue.push({ message, resolve, reject, method })
      })
    }

    return this.sendRequest(id, message, method)
  }

  private sendRequest(id: string, message: string, method: string): Promise<any> {
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
    let msg: any
    try {
      msg = JSON.parse(raw.toString())
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

  private subscribe(
    method: string,
    params: Record<string, any>,
    eventName: string,
    callback: (data: any) => void
  ): () => void {
    let subId: string | null = null
    let unsubscribed = false

    this.request(method, params)
      .then((result) => {
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

  private addEventListener(event: string, callback: (data: any) => void): void {
    let set = this.eventListeners.get(event)
    if (!set) {
      set = new Set()
      this.eventListeners.set(event, set)
    }
    set.add(callback)
  }

  private removeEventListener(event: string, callback: (data: any) => void): void {
    const set = this.eventListeners.get(event)
    if (set) {
      set.delete(callback)
      if (set.size === 0) this.eventListeners.delete(event)
    }
  }

  private dispatchEvent(event: string, data: any): void {
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

      const onOpenOnce = () => {
        cleanup()
        this.ws = ws
        this.connected = true
        this.connecting = false
        this.reconnectAttempt = 0
        this.setupListeners(ws)
        this.startHeartbeat()
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
    for (const [id, entry] of this.pending) {
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
