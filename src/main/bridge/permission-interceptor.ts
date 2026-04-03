import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import { getSetting } from '../settings'
import { bridgePermissionStore, methodToScope, SCOPE_DESCRIPTIONS } from './permission-store'
import { getMainWindow } from '../windows/main'
import { overlayManager } from '../windows/overlay-manager'
import type { BridgeScope } from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('bridge-interceptor')

interface PendingRpc {
  resolve: (response: string) => void
  originalId: string | number | null
  timer: ReturnType<typeof setTimeout>
}

class BridgePermissionInterceptor {
  private ws: WebSocket | null = null
  private wsConnecting = false
  private pendingRpc = new Map<string, PendingRpc>()
  private pendingPermissionByKey = new Map<string, Promise<boolean>>()
  private activeSenders = new Set<Electron.WebContents>()
  private subscribedSenders = new Set<Electron.WebContents>()
  private wsPort = 8081

  init(): void {
    const network = getSetting('network')
    this.wsPort = network.wsPort
    bridgePermissionStore.init()
    bridgePermissionStore.clearSessionGrants()
    this.connectToBridge()
  }

  async handleRequest(
    domain: string,
    data: string,
    sendResponse: (data: string) => void,
    sender?: Electron.WebContents
  ): Promise<void> {
    if (sender && !this.activeSenders.has(sender)) {
      this.activeSenders.add(sender)
      sender.once('destroyed', () => {
        this.activeSenders.delete(sender)
        this.subscribedSenders.delete(sender)
      })
    }

    let parsed: { id?: string | number; method?: string; [key: string]: unknown }
    try {
      parsed = JSON.parse(data)
    } catch {
      sendResponse(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
      return
    }

    const { id, method } = parsed
    if (!method) {
      sendResponse(
        JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid request' } })
      )
      return
    }

    const scope = methodToScope(method)
    if (!scope) {
      sendResponse(
        JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Unknown method' } })
      )
      return
    }

    const decision = bridgePermissionStore.getPermission(domain, scope)

    if (decision === 'denied') {
      sendResponse(
        JSON.stringify({
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: -32003, message: `Permission denied: ${domain} cannot ${SCOPE_DESCRIPTIONS[scope]}` },
        })
      )
      return
    }

    if (decision === 'unknown') {
      const defaultPolicy = bridgePermissionStore.getDefaultPolicy()
      if (defaultPolicy === 'deny') {
        sendResponse(
          JSON.stringify({
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32003, message: 'Bridge access denied by default policy' },
          })
        )
        return
      }

      const granted = await this.requestPermission(domain, scope, method)
      if (!granted) {
        sendResponse(
          JSON.stringify({
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32003, message: 'Permission denied by user' },
          })
        )
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

      overlayManager.show(
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
          overlayManager.hide(`bridge-permission-${key}`)
          if (actionType === 'deny' || actionType === 'dismiss') {
            resolve(false)
          } else {
            const remember = actionType === 'always-allow'
            bridgePermissionStore.setPermission(domain, scope, remember ? 'granted' : 'session')
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
      sendResponse(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id ?? null,
          error: { code: -32000, message: 'Bridge not connected' },
        })
      )
      return
    }

    const internalId = randomUUID()
    const originalId = parsed.id ?? null
    const rewritten = JSON.stringify({ ...parsed, id: internalId })

    const timer = setTimeout(() => {
      this.pendingRpc.delete(internalId)
      sendResponse(
        JSON.stringify({ jsonrpc: '2.0', id: originalId, error: { code: -32000, message: 'Bridge timeout' } })
      )
    }, 60_000)

    this.pendingRpc.set(internalId, { resolve: sendResponse, originalId, timer })
    this.ws.send(rewritten)
  }

  private connectToBridge(): void {
    if (this.wsConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return
    this.wsConnecting = true

    const url = `ws://127.0.0.1:${this.wsPort}`
    const ws = new WebSocket(url)

    ws.on('open', () => {
      log.info('Connected to bridge')
      this.ws = ws
      this.wsConnecting = false
    })

    ws.on('message', (raw: WebSocket.Data) => {
      const data = raw.toString()
      try {
        const parsed = JSON.parse(data)
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
      log.info('Bridge connection closed, reconnecting in 2s...')
      this.ws = null
      this.wsConnecting = false
      setTimeout(() => this.connectToBridge(), 2000)
    })

    ws.on('error', (err) => {
      log.error('Bridge connection error:', err.message)
      this.wsConnecting = false
    })
  }

  destroy(): void {
    for (const [, pending] of this.pendingRpc) {
      clearTimeout(pending.timer)
    }
    this.pendingRpc.clear()

    this.ws?.close()
    this.ws = null
  }
}

export const bridgeInterceptor = new BridgePermissionInterceptor()
