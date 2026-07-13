import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import { getSetting } from '../settings'
import { RECONNECT_DELAY_MS, RPC_TIMEOUT_MS } from './constants'
import { BridgePermissionStore, methodToScope, SCOPE_DESCRIPTIONS } from './permission-store'
import { getMainWindow } from '../windows/main'
import { OverlayManager } from '../windows/overlay-manager'
import type { BridgeScope } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { createLogger, RepetitionAggregator } from '../../shared/logger'
const log = createLogger('bridge-interceptor')

// JSON-RPC 2.0 error codes used when rejecting bridge requests.
const RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  UNKNOWN_METHOD: -32601,
  BRIDGE_UNAVAILABLE: -32000,
  PERMISSION_DENIED: -32003,
} as const

/** Build a JSON-RPC 2.0 error response string. */
function rpcError(id: string | number | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
}

interface PendingRpc {
  resolve: (response: string) => void
  originalId: string | number | null
  timer: ReturnType<typeof setTimeout>
}

interface SenderBridgeConnection {
  ws: WebSocket | null
  connectFlight: Promise<void> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  generation: number
  pendingRpc: Map<string, PendingRpc>
}

export class BridgePermissionInterceptor {
  private ws: WebSocket | null = null
  private initialized = false
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectionGeneration = 0
  private rebindFlight: { port: number; promise: Promise<void> } | null = null
  private pendingRpc = new Map<string, PendingRpc>()
  private pendingPermissionByKey = new Map<string, Promise<boolean>>()
  private activeSenders = new Set<Electron.WebContents>()
  private senderConnections = new Map<Electron.WebContents, SenderBridgeConnection>()
  private senderDomains = new Map<Electron.WebContents, string>()
  private wsPort: number = DEFAULT_SETTINGS.wsPort
  private pendingWsPort: number | null = null
  private bridgePermissionStore: BridgePermissionStore
  private overlayManager: OverlayManager
  private readonly reconnectLogs = new RepetitionAggregator(log)
  private hasConnected = false

  constructor(bridgePermissionStore: BridgePermissionStore, overlayManager: OverlayManager) {
    this.bridgePermissionStore = bridgePermissionStore
    this.overlayManager = overlayManager
  }

  init(): void {
    if (this.initialized || this.destroyed) return
    this.initialized = true
    this.wsPort = this.pendingWsPort ?? getSetting('network').wsPort
    this.pendingWsPort = null
    this.bridgePermissionStore.init()
    this.bridgePermissionStore.clearSessionGrants()
    void this.connectToBridge(this.connectionGeneration).catch(() => {})
  }

  async handleRequest(
    domain: string,
    data: string,
    sendResponse: (data: string) => void,
    sender?: Electron.WebContents
  ): Promise<void> {
    if (sender) {
      const previousDomain = this.senderDomains.get(sender)
      if (previousDomain && previousDomain !== domain) {
        this.disposeSenderConnection(sender)
      }
      this.senderDomains.set(sender, domain)
      if (previousDomain && previousDomain !== domain && ![...this.senderDomains.values()].includes(previousDomain)) {
        for (const scope of ['blockchain', 'p2p', 'write'] as BridgeScope[]) {
          this.bridgePermissionStore.revokeSessionPermission(previousDomain, scope)
        }
      }
      if (!this.activeSenders.has(sender)) {
        this.activeSenders.add(sender)
        sender.once('destroyed', () => {
          const lastDomain = this.senderDomains.get(sender)
          this.activeSenders.delete(sender)
          this.disposeSenderConnection(sender)
          this.senderDomains.delete(sender)
          if (lastDomain) {
            const otherHasDomain = [...this.senderDomains.values()].includes(lastDomain)
            if (!otherHasDomain) {
              for (const scope of ['blockchain', 'p2p', 'write'] as BridgeScope[]) {
                this.bridgePermissionStore.revokeSessionPermission(lastDomain, scope)
              }
            }
          }
        })
      }
    }

    let parsed: { id?: string | number; method?: string; [key: string]: unknown }
    try {
      parsed = JSON.parse(data)
    } catch {
      sendResponse(rpcError(null, RPC_ERRORS.PARSE, 'Parse error'))
      return
    }

    const { id, method } = parsed
    if (!method) {
      sendResponse(rpcError(id ?? null, RPC_ERRORS.INVALID_REQUEST, 'Invalid request'))
      return
    }

    const scope = methodToScope(method)
    if (!scope) {
      sendResponse(rpcError(id ?? null, RPC_ERRORS.UNKNOWN_METHOD, 'Unknown method'))
      return
    }

    const decision = this.bridgePermissionStore.getPermission(domain, scope)

    if (decision === 'denied') {
      sendResponse(
        rpcError(
          id ?? null,
          RPC_ERRORS.PERMISSION_DENIED,
          `Permission denied: ${domain} cannot ${SCOPE_DESCRIPTIONS[scope]}`
        )
      )
      return
    }

    if (decision === 'unknown') {
      const defaultPolicy = this.bridgePermissionStore.getDefaultPolicy()
      if (defaultPolicy === 'deny') {
        sendResponse(rpcError(id ?? null, RPC_ERRORS.PERMISSION_DENIED, 'Bridge access denied by default policy'))
        return
      }

      const granted = await this.requestPermission(domain, scope, method)
      if (!granted) {
        sendResponse(rpcError(id ?? null, RPC_ERRORS.PERMISSION_DENIED, 'Permission denied by user'))
        return
      }
    }

    if (sender) {
      await this.forwardToSender(sender, parsed, sendResponse)
      return
    }

    this.forwardToBridge(parsed, sendResponse)
  }

  private requestPermission(domain: string, scope: BridgeScope, method: string): Promise<boolean> {
    const key = `${domain}:${scope}`
    const existing = this.pendingPermissionByKey.get(key)
    if (existing) return existing

    const promise = new Promise<boolean>((resolve) => {
      const win = getMainWindow()
      if (!win) {
        resolve(false)
        return
      }

      const bounds = win.getContentBounds()
      const menuW = 400
      const menuH = 240
      const x = Math.round(bounds.width / 2 - menuW / 2)
      const y = Math.round(bounds.height / 3)

      this.overlayManager.show(
        `bridge-permission-${key}`,
        { x, y, width: menuW, height: menuH },
        {
          type: 'form',
          title: `Bridge Permission: ${domain}`,
          fields: [
            { id: '_info', label: `This site wants to ${SCOPE_DESCRIPTIONS[scope]}`, value: method, readonly: true },
          ],
          actions: [
            { id: 'deny', label: 'Deny' },
            { id: 'allow', label: 'Allow', primary: true },
            { id: 'always-allow', label: 'Always Allow' },
          ],
        },
        (actionType) => {
          this.overlayManager.hide(`bridge-permission-${key}`)
          if (actionType === 'deny' || actionType === 'dismiss') {
            resolve(false)
          } else {
            const remember = actionType === 'always-allow'
            void this.bridgePermissionStore.setPermission(domain, scope, remember ? 'granted' : 'session').then(
              () => resolve(true),
              (error) => {
                log.error('Failed to persist bridge permission:', error)
                resolve(false)
              }
            )
          }
        }
      )
    })

    this.pendingPermissionByKey.set(key, promise)
    promise.finally(() => this.pendingPermissionByKey.delete(key))
    return promise
  }

  private forwardToBridge(
    parsed: { id?: string | number; [key: string]: unknown },
    sendResponse: (data: string) => void
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      sendResponse(rpcError(parsed.id ?? null, RPC_ERRORS.BRIDGE_UNAVAILABLE, 'Bridge not connected'))
      return
    }

    const internalId = randomUUID()
    const originalId = parsed.id ?? null
    const rewritten = JSON.stringify({ ...parsed, id: internalId })

    const timer = setTimeout(() => {
      this.pendingRpc.delete(internalId)
      sendResponse(rpcError(originalId, RPC_ERRORS.BRIDGE_UNAVAILABLE, 'Bridge timeout'))
    }, RPC_TIMEOUT_MS)

    this.pendingRpc.set(internalId, { resolve: sendResponse, originalId, timer })
    this.ws.send(rewritten)
  }

  private async forwardToSender(
    sender: Electron.WebContents,
    parsed: { id?: string | number; [key: string]: unknown },
    sendResponse: (data: string) => void
  ): Promise<void> {
    let connection = this.senderConnections.get(sender)
    if (!connection) {
      connection = {
        ws: null,
        connectFlight: null,
        reconnectTimer: null,
        generation: this.connectionGeneration,
        pendingRpc: new Map(),
      }
      this.senderConnections.set(sender, connection)
    }

    try {
      await this.ensureSenderConnected(sender, connection)
    } catch {
      sendResponse(rpcError(parsed.id ?? null, RPC_ERRORS.BRIDGE_UNAVAILABLE, 'Bridge not connected'))
      return
    }

    const ws = connection.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      sendResponse(rpcError(parsed.id ?? null, RPC_ERRORS.BRIDGE_UNAVAILABLE, 'Bridge not connected'))
      return
    }

    const internalId = randomUUID()
    const originalId = parsed.id ?? null
    const rewritten = JSON.stringify({ ...parsed, id: internalId })
    const timer = setTimeout(() => {
      connection.pendingRpc.delete(internalId)
      sendResponse(rpcError(originalId, RPC_ERRORS.BRIDGE_UNAVAILABLE, 'Bridge timeout'))
    }, RPC_TIMEOUT_MS)

    connection.pendingRpc.set(internalId, { resolve: sendResponse, originalId, timer })
    ws.send(rewritten)
  }

  private ensureSenderConnected(sender: Electron.WebContents, connection: SenderBridgeConnection): Promise<void> {
    if (connection.ws?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (connection.connectFlight) return connection.connectFlight
    const generation = connection.generation
    const flight = this.connectSender(sender, connection, generation).finally(() => {
      if (connection.connectFlight === flight) connection.connectFlight = null
    })
    connection.connectFlight = flight
    return flight
  }

  private connectSender(
    sender: Electron.WebContents,
    connection: SenderBridgeConnection,
    generation: number
  ): Promise<void> {
    if (this.destroyed || sender.isDestroyed()) return Promise.reject(new Error('Bridge sender unavailable'))
    const ws = new WebSocket(`ws://127.0.0.1:${this.wsPort}`)
    connection.ws = ws
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let connectTimer: ReturnType<typeof setTimeout> | null = null
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        if (connectTimer) clearTimeout(connectTimer)
        if (error) reject(error)
        else resolve()
      }
      connectTimer = setTimeout(() => {
        finish(new Error('Bridge connection timeout'))
        ws.terminate()
      }, RPC_TIMEOUT_MS)
      ws.once('open', () => {
        if (
          this.destroyed ||
          sender.isDestroyed() ||
          this.senderConnections.get(sender) !== connection ||
          connection.generation !== generation
        ) {
          ws.close()
          finish(new Error('Bridge connection superseded'))
          return
        }
        connection.ws = ws
        finish()
      })
      ws.on('message', (raw: WebSocket.Data) => {
        if (connection.ws !== ws) return
        this.handleSenderMessage(sender, connection, raw.toString())
      })
      ws.once('close', () => {
        const isCurrent = connection.ws === ws
        if (isCurrent) {
          connection.ws = null
          this.failPending(connection.pendingRpc)
        }
        finish(new Error('Bridge connection closed'))
        if (isCurrent) this.scheduleSenderReconnect(sender, connection, generation)
      })
      ws.on('error', (error) => {
        finish(error)
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.terminate()
      })
    })
  }

  private handleSenderMessage(sender: Electron.WebContents, connection: SenderBridgeConnection, data: string): void {
    let parsed: { id?: string | number; event?: string }
    try {
      parsed = JSON.parse(data) as { id?: string | number; event?: string }
    } catch {
      return
    }

    if (parsed.id !== undefined) {
      const pending = connection.pendingRpc.get(String(parsed.id))
      if (!pending) return
      clearTimeout(pending.timer)
      connection.pendingRpc.delete(String(parsed.id))
      pending.resolve(JSON.stringify({ ...parsed, id: pending.originalId }))
      return
    }

    if (parsed.event && !sender.isDestroyed()) {
      try {
        sender.send('bridge:message', data)
      } catch {
        this.disposeSenderConnection(sender)
      }
    }
  }

  private scheduleSenderReconnect(
    sender: Electron.WebContents,
    connection: SenderBridgeConnection,
    generation: number
  ): void {
    if (
      this.destroyed ||
      sender.isDestroyed() ||
      this.senderConnections.get(sender) !== connection ||
      connection.generation !== generation ||
      connection.reconnectTimer
    )
      return
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null
      void this.ensureSenderConnected(sender, connection).catch(() =>
        this.scheduleSenderReconnect(sender, connection, generation)
      )
    }, RECONNECT_DELAY_MS)
  }

  private failPending(pendingRpc: Map<string, PendingRpc>): void {
    for (const [, pending] of pendingRpc) {
      clearTimeout(pending.timer)
      try {
        pending.resolve(rpcError(pending.originalId, RPC_ERRORS.BRIDGE_UNAVAILABLE, 'Bridge disconnected'))
      } catch {
        continue
      }
    }
    pendingRpc.clear()
  }

  private disposeSenderConnection(sender: Electron.WebContents): void {
    const connection = this.senderConnections.get(sender)
    if (!connection) return
    this.senderConnections.delete(sender)
    connection.generation += 1
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer)
    connection.reconnectTimer = null
    this.failPending(connection.pendingRpc)
    const ws = connection.ws
    connection.ws = null
    if (ws) ws.close()
  }

  applyBridgePort(wsPort: number): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Bridge interceptor destroyed'))
    if (!this.initialized) {
      this.pendingWsPort = wsPort
      this.wsPort = wsPort
      return Promise.resolve()
    }
    if (this.rebindFlight?.port === wsPort) return this.rebindFlight.promise
    const promise = this.rebind(wsPort).finally(() => {
      if (this.rebindFlight?.promise === promise) this.rebindFlight = null
    })
    this.rebindFlight = { port: wsPort, promise }
    return promise
  }

  private async rebind(wsPort: number): Promise<void> {
    const generation = ++this.connectionGeneration
    const senders = [...this.senderConnections.keys()]
    for (const sender of senders) this.disposeSenderConnection(sender)
    this.wsPort = wsPort
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const previous = this.ws
    this.ws = null
    if (previous) {
      previous.removeAllListeners()
      previous.close()
    }
    let lastError: unknown
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await this.connectToBridge(generation)
        for (const sender of senders) {
          if (sender.isDestroyed() || !this.activeSenders.has(sender)) continue
          const connection: SenderBridgeConnection = {
            ws: null,
            connectFlight: null,
            reconnectTimer: null,
            generation,
            pendingRpc: new Map(),
          }
          this.senderConnections.set(sender, connection)
          void this.ensureSenderConnected(sender, connection).catch(() => {})
        }
        return
      } catch (error) {
        lastError = error
        if (generation !== this.connectionGeneration || this.destroyed) throw error
        if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw lastError
  }

  private connectToBridge(generation: number): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Bridge interceptor destroyed'))
    const url = `ws://127.0.0.1:${this.wsPort}`
    const ws = new WebSocket(url)
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let connectTimer: ReturnType<typeof setTimeout> | null = null
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (connectTimer) clearTimeout(connectTimer)
        if (error) reject(error)
        else resolve()
      }
      connectTimer = setTimeout(() => {
        finish(new Error('Bridge connection timeout'))
        ws.terminate()
      }, RPC_TIMEOUT_MS)
      ws.once('open', () => {
        if (generation !== this.connectionGeneration || this.destroyed) {
          ws.close()
          finish(new Error('Bridge connection superseded'))
          return
        }
        this.reconnectLogs.recovered('connection', 'bridge.connection.restored', 'bridge connection restored')
        this.hasConnected = true
        this.ws = ws
        finish()
      })
      ws.on('message', (raw: WebSocket.Data) => {
        const data = raw.toString()
        let parsed: { id?: string | number }
        try {
          parsed = JSON.parse(data) as { id?: string | number }
        } catch {
          return
        }
        if (parsed.id !== undefined) {
          const rpcId = String(parsed.id)
          const pending = this.pendingRpc.get(rpcId)
          if (pending) {
            clearTimeout(pending.timer)
            this.pendingRpc.delete(rpcId)
            const response = JSON.stringify({ ...parsed, id: pending.originalId })
            pending.resolve(response)
            return
          }
        }
      })
      ws.once('close', () => {
        if (this.ws === ws) this.ws = null
        finish(new Error('Bridge connection closed'))
        this.scheduleReconnect(generation)
      })
      ws.on('error', (error) => {
        if (this.hasConnected) {
          this.reconnectLogs.record('connection', 'bridge.connection.failed', 'bridge unavailable · reconnecting', {
            error,
          })
        } else {
          log.debug('Bridge not ready yet:', error.message)
        }
        finish(error)
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) ws.terminate()
      })
    })
  }

  private scheduleReconnect(generation: number): void {
    if (
      this.destroyed ||
      generation !== this.connectionGeneration ||
      this.reconnectTimer ||
      this.rebindFlight?.port === this.wsPort
    )
      return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connectToBridge(generation).catch(() => this.scheduleReconnect(generation))
    }, RECONNECT_DELAY_MS)
  }

  destroy(): void {
    this.destroyed = true
    this.connectionGeneration += 1
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    for (const [, pending] of this.pendingRpc) {
      clearTimeout(pending.timer)
    }
    this.pendingRpc.clear()
    for (const sender of [...this.senderConnections.keys()]) this.disposeSenderConnection(sender)
    this.activeSenders.clear()
    this.senderDomains.clear()

    this.ws?.close()
    this.ws = null
  }
}

// Singleton removed: use ServiceRegistry from services.ts
