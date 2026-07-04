/**
 * IPC handlers for the decentralized group chat (ton://chat).
 *
 * The browser ships NO default room and no privileged community — it's a neutral
 * public good. The user always names the room to join. The room name is turned
 * into an overlay id locally (see ../../chat/room), the room's member nodes are
 * discovered from the DHT, and we connect to one of them via the local bridge,
 * join the overlay, and relay incoming `overlay.message` events to the renderer
 * as `chat:message`.
 *
 * Node resolution, in order:
 *   1. node   — an explicit bootstrap node id supplied by the user (connects by
 *      ADNL id, skipping discovery; useful for a fresh room not yet propagated).
 *   2. DHT    — dht.findValue on the overlay id → `overlay.nodes` record → node
 *      pubkeys → ADNL ids. Works for any room once its record has propagated.
 * Candidates are tried in turn until one connects + joins.
 *
 * Requires the bridge `adnl`/`overlay`/`dht` namespaces (enabled by config-writer).
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { normalizeRoom, normalizeNodeId, overlayIdB64ForRoom, parseOverlayNodes } from '../../chat/room'
import { secureHandle, emitToRenderer, toError, log } from './shared'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'
import type { ServiceRegistry } from '../../services'

type Via = 'node' | 'dht'

interface ChatSession {
  room: string
  overlayId: string // base64
  via: Via
  bootstrap?: string // the explicit node id used, if any
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
async function resolveCandidates(
  bridge: WsBridgeClient,
  room: string,
  overlayId: string,
  bootstrap?: string
): Promise<Candidate[]> {
  const seen = new Set<string>()
  const out: Candidate[] = []
  const add = (adnl: string, via: Via): void => {
    if (adnl && !seen.has(adnl)) {
      seen.add(adnl)
      out.push({ adnl, via })
    }
  }

  // 1. Explicit bootstrap node — most reliable: connects by ADNL id and skips the
  //    overlay-nodes DHT lookup, which can be slow to propagate for a fresh room.
  if (bootstrap) add(bootstrap, 'node')

  // 2. DHT discovery — the general path. Skipped when a bootstrap node was given.
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
async function connectRoom(
  bridge: WsBridgeClient,
  room: string,
  bootstrap?: string
): Promise<{ room: string; via: Via }> {
  const overlayId = overlayIdB64ForRoom(room)
  const candidates = await resolveCandidates(bridge, room, overlayId, bootstrap)
  if (candidates.length === 0) {
    throw new Error(
      `No nodes found for room "${room}". Its nodes may be offline, or the room is new and not yet ` +
        `discoverable on the network — paste a known node id to connect directly.`
    )
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

      session = { room, overlayId, via: cand.via, bootstrap, peerId, unsub, keepalive }

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

  secureHandle(IPC_CHANNELS.CHAT_CONNECT, async (roomArg?: string, nodeArg?: string) => {
    const room = normalizeRoom(roomArg) // no default room — the user always names it
    const bootstrap = normalizeNodeId(nodeArg)

    // Chain onto any in-flight connect so mounts/switches never race.
    const run = connectChain
      .catch(() => {})
      .then(async () => {
        const bridge = walletManager.getBridgeClient()
        if (!bridge) throw new Error('Bridge not connected — connect the proxy first')

        // Reuse the session only when nothing about the target changed.
        if (session?.room === room && session.bootstrap === bootstrap) {
          return { connected: true, room, via: session.via }
        }
        if (session) await teardownSession(bridge) // switching rooms / node

        const { via } = await connectRoom(bridge, room, bootstrap)
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
