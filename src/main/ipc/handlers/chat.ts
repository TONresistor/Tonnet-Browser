/**
 * IPC handlers for the decentralized group chat (ton://chat).
 *
 * Join ANY room by name. The room name is turned into an overlay id locally
 * (see ../../chat/room), the room's member nodes are discovered from the DHT,
 * and we connect to one of them via the local bridge, join the overlay, and
 * relay incoming `overlay.message` events to the renderer as `chat:message`.
 *
 * Node resolution, in order:
 *   1. DNS — only for the default room, which has a well-known `.ton` anchor
 *      (fast + reliable; the anchor also seeds the mesh).
 *   2. DHT — dht.findValue on the overlay id → `overlay.nodes` record → node
 *      pubkeys → ADNL ids. Works for every room, incl. mesh rooms with no DNS.
 * Candidates are tried in turn until one connects + joins.
 *
 * Requires the bridge `adnl`/`overlay`/`dht` namespaces (enabled by config-writer).
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { GROUPCHAT_DOMAIN, GROUPCHAT_ROOM } from '../../../shared/groupchat'
import { normalizeRoom, overlayIdB64ForRoom, parseOverlayNodes } from '../../chat/room'
import { secureHandle, emitToRenderer, toError, log } from './shared'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'
import type { ServiceRegistry } from '../../services'

type Via = 'dns' | 'dht'

interface ChatSession {
  room: string
  overlayId: string // base64
  via: Via
  peerId: string
  unsub: () => void
  keepalive: NodeJS.Timeout
}

interface Candidate {
  adnl: string // base64 ADNL id for adnl.connectByADNL
  via: Via
}

let session: ChatSession | null = null
// Serialize connects so a React StrictMode double-mount (or a fast room switch)
// never opens two sessions at once. Each connect chains after the previous one.
let connectChain: Promise<unknown> = Promise.resolve()

const hexToB64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64')

async function teardownSession(bridge: WsBridgeClient | null): Promise<void> {
  if (!session) return
  const s = session
  session = null
  clearInterval(s.keepalive)
  s.unsub()
  if (bridge) await bridge.overlayLeaveAndDisconnect(s.overlayId, s.peerId).catch(() => {})
  log.info(`chat: left room ${s.room}`)
}

/** Resolve the candidate nodes to bootstrap into, de-duplicated by ADNL id. */
async function resolveCandidates(bridge: WsBridgeClient, room: string, overlayId: string): Promise<Candidate[]> {
  const seen = new Set<string>()
  const out: Candidate[] = []
  const add = (adnl: string, via: Via): void => {
    if (adnl && !seen.has(adnl)) {
      seen.add(adnl)
      out.push({ adnl, via })
    }
  }

  // 1. DNS anchor — only the default room has a well-known domain.
  if (room === GROUPCHAT_ROOM) {
    try {
      const dom = await bridge.resolveDomain(GROUPCHAT_DOMAIN)
      if (dom.site_adnl) add(hexToB64(dom.site_adnl), 'dns')
    } catch (err) {
      log.warn(`chat: DNS resolve of ${GROUPCHAT_DOMAIN} failed: ${toError(err).message}`)
    }
  }

  // 2. DHT discovery — the general path (any room). Skipped when DNS already gave
  //    us a node, so the default room connects instantly instead of waiting on a
  //    slow DHT lookup; other rooms always take this path.
  if (out.length === 0) {
    try {
      const rec = await bridge.dhtFindValue(overlayId, 'nodes', 0)
      if (rec?.data) {
        for (const node of parseOverlayNodes(Buffer.from(rec.data, 'base64'))) {
          add(node.adnlId.toString('base64'), 'dht')
        }
      }
    } catch (err) {
      log.warn(`chat: DHT node discovery for ${room} failed: ${toError(err).message}`)
    }
  }

  return out
}

/** Open a session for `room`, trying each candidate node until one works. */
async function connectRoom(bridge: WsBridgeClient, room: string): Promise<{ room: string; via: Via }> {
  const overlayId = overlayIdB64ForRoom(room)
  const candidates = await resolveCandidates(bridge, room, overlayId)
  if (candidates.length === 0) {
    throw new Error(`No nodes found for room "${room}". The room may be empty, or its nodes are offline.`)
  }

  let lastErr: Error | null = null
  for (const cand of candidates) {
    try {
      const peerId = await bridge.overlayConnectAndJoin(cand.adnl, overlayId)

      const unsub = bridge.onOverlayMessage((data) => {
        if (data.overlay_id !== overlayId) return // ignore other rooms sharing this bridge
        try {
          const m = JSON.parse(Buffer.from(data.message, 'base64').toString('utf-8')) as {
            type?: unknown
            nick?: unknown
            text?: unknown
            ts?: unknown
          }
          // Control frames (hello/presence/…) keep us in the relay set but aren't chat lines.
          if (m.type && m.type !== 'msg') return
          emitToRenderer(IPC_CHANNELS.CHAT_MESSAGE, {
            room,
            nick: String(m.nick ?? '?').slice(0, 32),
            text: String(m.text ?? ''),
            ts: Number(m.ts ?? Date.now()),
          })
        } catch (err) {
          log.warn(`chat: ignoring bad overlay payload: ${toError(err).message}`)
        }
      })

      // Keepalive: hold the NAT mapping open so the node can push relayed messages while idle.
      const keepalive = setInterval(() => {
        bridge.adnlPing(peerId).catch(() => {})
      }, 10_000)

      session = { room, overlayId, via: cand.via, peerId, unsub, keepalive }

      // Announce ourselves so the node registers us as a member and starts relaying
      // to us right away — a silent client would never enter the relay set.
      bridge
        .overlaySend(
          overlayId,
          Buffer.from(JSON.stringify({ type: 'hello', ts: Date.now() }), 'utf-8').toString('base64')
        )
        .catch((err) => log.warn(`chat: hello failed (will register on first send): ${toError(err).message}`))

      log.info(`chat: joined room ${room} via ${cand.via} (${candidates.length} candidate node(s))`)
      return { room, via: cand.via }
    } catch (err) {
      lastErr = toError(err)
      log.warn(`chat: candidate ${cand.adnl.slice(0, 12)}… (${cand.via}) failed: ${lastErr.message}`)
    }
  }
  throw lastErr ?? new Error(`Could not connect to any node for room "${room}"`)
}

export function registerChatHandlers(registry: ServiceRegistry): void {
  const { walletManager } = registry

  secureHandle(IPC_CHANNELS.CHAT_CONNECT, async (roomArg?: string) => {
    const room = normalizeRoom(roomArg || GROUPCHAT_ROOM)

    // Chain onto any in-flight connect so mounts/switches never race.
    const run = connectChain
      .catch(() => {})
      .then(async () => {
        const bridge = walletManager.getBridgeClient()
        if (!bridge) throw new Error('Bridge not connected — connect the proxy first')

        if (session?.room === room) return { connected: true, room, via: session.via }
        if (session) await teardownSession(bridge) // switching rooms

        const { via } = await connectRoom(bridge, room)
        return { connected: true, room, via }
      })
    connectChain = run
    return run
  })

  secureHandle(IPC_CHANNELS.CHAT_SEND, async (nick: string, text: string) => {
    const bridge = walletManager.getBridgeClient()
    if (!bridge || !session) throw new Error('Chat not connected')
    const payload = JSON.stringify({
      type: 'msg',
      nick: String(nick || '?').slice(0, 32),
      text: String(text).slice(0, 4000),
      ts: Date.now(),
    })
    await bridge.overlaySend(session.overlayId, Buffer.from(payload, 'utf-8').toString('base64'))
    return { sent: true }
  })

  secureHandle(IPC_CHANNELS.CHAT_DISCONNECT, async () => {
    await teardownSession(walletManager.getBridgeClient())
    return { disconnected: true }
  })
}
