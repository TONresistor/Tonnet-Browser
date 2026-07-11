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

export class BridgePermissionInterceptor {
  private ws: WebSocket | null = null
  private wsConnecting = false
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingRpc = new Map<string, PendingRpc>()
  private pendingPermissionByKey = new Map<string, Promise<boolean>>()
  private activeSenders = new Set<Electron.WebContents>()
  private subscribedSenders = new Set<Electron.WebContents>()
  private senderDomains = new Map<Electron.WebContents, string>()
  private wsPort: number = DEFAULT_SETTINGS.wsPort
  private bridgePermissionStore: BridgePermissionStore
  private overlayManager: OverlayManager
  private readonly reconnectLogs = new RepetitionAggregator(log)
  private hasConnected = false

  constructor(bridgePermissionStore: BridgePermissionStore, overlayManager: OverlayManager) {
    this.bridgePermissionStore = bridgePermissionStore
    this.overlayManager = overlayManager
  }

  init(): void {
    const network = getSetting('network')
    this.wsPort = network.wsPort
    this.bridgePermissionStore.init()
    this.bridgePermissionStore.clearSessionGrants()
    this.connectToBridge()
  }

  async handleRequest(
    domain: string,
    data: string,
    sendResponse: (data: string) => void,
    sender?: Electron.WebContents
  ): Promise<void> {
    if (sender) {
      this.senderDomains.set(sender, domain)
      if (!this.activeSenders.has(sender)) {
        this.activeSenders.add(sender)
        sender.once('destroyed', () => {
          const lastDomain = this.senderDomains.get(sender)
          this.activeSenders.delete(sender)
          this.subscribedSenders.delete(sender)
          this.senderDomains.delete(sender)
          if (lastDomain) {
            const otherHasDomain = [...this.senderDomains.values()].includes(lastDomain)
            if (!otherHasDomain) {
              for (const scope of ['blockchain', 'p2p', 'write'] as BridgeScope[]) {
                if (this.bridgePermissionStore.getPermission(lastDomain, scope) === 'session') {
                  this.bridgePermissionStore.revokePermission(lastDomain, scope)
                }
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

    if (sender && method.startsWith('subscribe.')) {
      this.subscribedSenders.add(sender)
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
            this.bridgePermissionStore.setPermission(domain, scope, remember ? 'granted' : 'session')
            resolve(true)
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

  private connectToBridge(): void {
    if (this.wsConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return
    this.wsConnecting = true

    // Re-read the configured port on every (re)connect so a settings change is
    // picked up instead of reconnecting to a stale cached port.
    this.wsPort = getSetting('network').wsPort
    const url = `ws://127.0.0.1:${this.wsPort}`
    const ws = new WebSocket(url)

    ws.on('open', () => {
      this.reconnectLogs.recovered('connection', 'bridge.connection.restored', 'bridge connection restored')
      this.hasConnected = true
      this.ws = ws
      this.wsConnecting = false
    })

    ws.on('message', (raw: WebSocket.Data) => {
      const data = raw.toString()
      try {
        const parsed = JSON.parse(data) as { id?: string | number; method?: string }
        if (parsed.id !== undefined) {
          const rpcId = String(parsed.id)
          const pending = this.pendingRpc.get(rpcId)
          if (pending) {
            clearTimeout(pending.timer)
            this.pendingRpc.delete(rpcId)
            // Translate internal id back to original
            const response = JSON.stringify({ ...parsed, id: pending.originalId })
            pending.resolve(response)
            return
          }
        }

        // If no pending RPC match, this is a push notification -- forward to subscribed senders only
        if (parsed.method && !parsed.id) {
          for (const sender of this.subscribedSenders) {
            if (!sender.isDestroyed()) {
              sender.send('bridge:message', data)
            }
          }
          return
        }
      } catch {
        /* ignore non-JSON */
      }
    })

    ws.on('close', () => {
      this.ws = null
      this.wsConnecting = false
      if (this.destroyed) return
      this.reconnectTimer = setTimeout(() => this.connectToBridge(), RECONNECT_DELAY_MS)
    })

    ws.on('error', (err) => {
      if (this.hasConnected) {
        this.reconnectLogs.record('connection', 'bridge.connection.failed', 'bridge unavailable · reconnecting', {
          error: err,
        })
      } else {
        log.debug('Bridge not ready yet:', err.message)
      }
      this.wsConnecting = false
    })
  }

  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    for (const [, pending] of this.pendingRpc) {
      clearTimeout(pending.timer)
    }
    this.pendingRpc.clear()
    this.senderDomains.clear()

    this.ws?.close()
    this.ws = null
  }
}

// Singleton removed: use ServiceRegistry from services.ts
