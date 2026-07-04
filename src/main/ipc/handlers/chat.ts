/**
 * IPC handlers for the experimental group chat (ton://chat).
 *
 * Flow: resolve groupchat.ton -> anchor ADNL -> connect -> join the room overlay
 * (all via the existing WsBridgeClient / local bridge). Incoming messages arrive as
 * `overlay.message` events and are forwarded to the renderer as `chat:message`.
 *
 * Requires the bridge `adnl`/`overlay`/`dht` namespaces (enabled by config-writer).
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { GROUPCHAT_DOMAIN, GROUPCHAT_OVERLAY_ID } from '../../../shared/groupchat'
import { secureHandle, emitToRenderer, toError, log } from './shared'
import type { ServiceRegistry } from '../../services'

interface ChatSession {
  peerId: string
  unsub: () => void
  keepalive: NodeJS.Timeout
}

let session: ChatSession | null = null
// Serialize concurrent connects (React StrictMode / double-mount) so we never
// open two anchor connections for one client.
let connectInFlight: Promise<{ connected: boolean }> | null = null

const hexToB64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64')

export function registerChatHandlers(registry: ServiceRegistry): void {
  const { walletManager } = registry

  secureHandle(IPC_CHANNELS.CHAT_CONNECT, async () => {
    if (session) return { connected: true }
    if (connectInFlight) return connectInFlight

    connectInFlight = (async () => {
      const bridge = walletManager.getBridgeClient()
      if (!bridge) throw new Error('Bridge not connected — connect the proxy first')

      const dom = await bridge.resolveDomain(GROUPCHAT_DOMAIN)
      if (!dom.site_adnl) throw new Error(`${GROUPCHAT_DOMAIN} has no ADNL site record yet`)

      const peerId = await bridge.overlayConnectAndJoin(hexToB64(dom.site_adnl), GROUPCHAT_OVERLAY_ID)

      const unsub = bridge.onOverlayMessage((data) => {
        log.info(`chat: overlay.message event: ${JSON.stringify(data).slice(0, 160)}`)
        if (data.overlay_id !== GROUPCHAT_OVERLAY_ID) return
        try {
          const json = Buffer.from(data.message, 'base64').toString('utf-8')
          const m = JSON.parse(json) as { nick?: unknown; text?: unknown; ts?: unknown }
          emitToRenderer(IPC_CHANNELS.CHAT_MESSAGE, {
            nick: String(m.nick ?? '?').slice(0, 32),
            text: String(m.text ?? ''),
            ts: Number(m.ts ?? Date.now()),
          })
        } catch (err) {
          log.warn(`chat: ignoring bad overlay payload: ${toError(err).message}`)
        }
      })

      // Keepalive: ping the anchor so the NAT mapping stays open and the anchor
      // can push relayed messages even when this client is idle.
      const keepalive = setInterval(() => {
        bridge.adnlPing(peerId).catch(() => {})
      }, 10_000)

      session = { peerId, unsub, keepalive }
      log.info('chat: connected to groupchat overlay')
      return { connected: true }
    })()

    try {
      return await connectInFlight
    } finally {
      connectInFlight = null
    }
  })

  secureHandle(IPC_CHANNELS.CHAT_SEND, async (nick: string, text: string) => {
    const bridge = walletManager.getBridgeClient()
    if (!bridge || !session) throw new Error('Chat not connected')
    const payload = JSON.stringify({
      nick: String(nick || '?').slice(0, 32),
      text: String(text).slice(0, 4000),
      ts: Date.now(),
    })
    await bridge.overlaySend(GROUPCHAT_OVERLAY_ID, Buffer.from(payload, 'utf-8').toString('base64'))
    return { sent: true }
  })

  secureHandle(IPC_CHANNELS.CHAT_DISCONNECT, async () => {
    const bridge = walletManager.getBridgeClient()
    if (session) {
      clearInterval(session.keepalive)
      session.unsub()
      if (bridge) await bridge.overlayLeaveAndDisconnect(GROUPCHAT_OVERLAY_ID, session.peerId)
      session = null
      log.info('chat: disconnected')
    }
    return { disconnected: true }
  })
}
